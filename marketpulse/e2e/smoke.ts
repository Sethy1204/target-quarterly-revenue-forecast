/**
 * End-to-end smoke test: mock provider → MarketPulse server → browser UI → auto refresh → alert.
 * Requires `npm run build` first and Playwright with Chromium available:
 *   npm i -D playwright && npx playwright install chromium
 * Run: npm run test:e2e
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startMockUpstream } from './mockUpstream';

// Loaded via require so a globally installed Playwright also works.
const { chromium } = createRequire(import.meta.url)('playwright') as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chromium: any;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'e2e', 'screenshots');
mkdirSync(shots, { recursive: true });
const MOCK_PORT = 9911;
const APP_PORT = 8799;
const results: string[] = [];
const check = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  results.push(`✓ ${msg}`);
};

const { server: mock, state } = await startMockUpstream(MOCK_PORT);
const app = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: root,
  env: {
    ...process.env, NODE_ENV: 'production', PORT: String(APP_PORT), MARKETPULSE_MODE: 'live',
    TWELVEDATA_API_KEY: 'e2e-test-key', FINNHUB_API_KEY: 'e2e-test-key',
    TWELVEDATA_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/td`, FINNHUB_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/fh`,
    TWELVEDATA_CREDITS_PER_MINUTE: '0', TWELVEDATA_CREDITS_PER_DAY: '0',
    MIN_QUOTE_REFRESH_SECONDS: '5', CLOSED_MARKET_REFRESH_SECONDS: '5', NEWS_REFRESH_SECONDS: '5',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
app.stdout.on('data', (d) => (log += d));
app.stderr.on('data', (d) => (log += d));

const browser = await chromium.launch();
try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${APP_PORT}/api/health`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Vancouver' });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (m: { type(): string; text(): string }) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${APP_PORT}/`);

  // 1. Quotes render with explicit currency/exchange labels.
  const telus = page.locator('article', { has: page.getByRole('heading', { name: 'TELUS', exact: true }) });
  await telus.locator('.price').waitFor({ timeout: 15000 });
  check((await telus.locator('.ticker').innerText()) === 'T', 'TELUS card defaults to TSX ticker T');
  check((await telus.locator('.price').innerText()).includes('CAD'), 'TELUS price labelled CAD');
  check((await telus.locator('.badge.fresh-end-of-day').count()) === 1, 'TSX quote labelled End-of-day (declared plan timing)');
  await telus.getByRole('tab', { name: /NYSE: TU/ }).click();
  await telus.locator('.price', { hasText: 'USD' }).waitFor({ timeout: 10000 });
  check((await telus.locator('.ticker').innerText()) === 'TU', 'TELUS NYSE tab shows TU in USD');
  const msft = page.locator('article', { has: page.getByRole('heading', { name: 'Microsoft' }) });
  check((await msft.locator('.price').innerText()).includes('USD'), 'Microsoft price labelled USD');
  check(/Delayed|Last close|Stale/.test(await msft.locator('.ticker-line').innerText()), 'US quote not labelled real-time under default (delayed) declaration');
  const goog = page.locator('article', { has: page.getByRole('heading', { name: 'Alphabet (Google)' }) });
  await goog.getByRole('tab', { name: /GOOG USD · Class C/ }).click();
  await goog.locator('.ticker', { hasText: /^GOOG$/ }).waitFor();
  await page.waitForFunction(() => {
    const a = [...document.querySelectorAll('article')].find((x) => x.querySelector('h3')?.textContent === 'Alphabet (Google)');
    return a && a.querySelector('.price');
  });
  const volText = await goog.locator('.stats div', { hasText: 'Volume' }).locator('dd').innerText();
  check(volText === '—', 'Missing volume shown as "—" (not 0)');
  check((await page.locator('.refresh-info').innerText()).includes('EST') || (await page.locator('.refresh-info').innerText()).includes('EDT'), 'Times displayed in America/Toronto (EST/EDT) despite browser in Vancouver');

  // 2. Chart + comparison.
  await page.locator('.chart svg path').first().waitFor({ timeout: 10000 });
  check((await page.locator('.chart svg path').count()) === 1, 'Single price chart renders');
  for (const r of ['1D', '5D', '6M', 'YTD', '1Y']) {
    await page.locator('.chart-panel').getByRole('tab', { name: r, exact: true }).click();
    await page.locator('.chart svg path').first().waitFor({ timeout: 10000 });
  }
  check(true, 'Chart ranges 1D/5D/6M/YTD/1Y load');
  await page.getByRole('tab', { name: 'Compare %' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.chart svg path').length >= 5, null, { timeout: 15000 });
  check((await page.locator('.note', { hasText: 'common baseline' }).count()) === 1, 'Comparison mode uses a labelled common % baseline');
  await page.screenshot({ path: path.join(shots, 'desktop.png'), fullPage: false });

  // 3. Alerts: price-above on MSFT, then move mock price and wait for auto-refresh.
  await msft.getByRole('button', { name: 'Add alert' }).click();
  const drawer = page.getByRole('dialog', { name: 'Alerts' });
  check((await drawer.innerText()).includes('only while MarketPulse is open'), 'Alerts panel states alerts run only while the app is open');
  await drawer.locator('select').first().selectOption('price-above');
  await drawer.getByLabel(/Price \(USD\)/).fill('120');
  await drawer.getByRole('button', { name: 'Add alert' }).click();
  await drawer.locator('select').first().selectOption('news');
  await drawer.locator('select').nth(1).selectOption('tesla');
  await drawer.getByRole('button', { name: 'Add alert' }).click();
  check((await drawer.locator('.rules li').count()) === 2, 'Two alert rules saved');
  await drawer.getByRole('button', { name: 'Close alerts' }).click();
  state.prices.MSFT = 125;
  state.news.push({ symbol: 'TSLA', headline: 'E2E mock story for Tesla', url: 'https://example.com/e2e-tesla', source: 'Mock Wire', datetime: Math.floor(Date.now() / 1000) });
  await page.locator('.toast', { hasText: 'MSFT' }).waitFor({ timeout: 30000 });
  check(true, 'Price alert toast fired after automatic refresh');
  const toastText = await page.locator('.toast', { hasText: 'MSFT' }).innerText();
  check(toastText.includes('125') && toastText.includes('USD') && toastText.includes('Twelve Data'), 'Alert shows triggering price, currency and source');
  await page.locator('.toast', { hasText: 'E2E mock story for Tesla' }).waitFor({ timeout: 30000 });
  check(true, 'News alert toast fired for new company story');
  await page.waitForTimeout(12000); // two more refresh cycles
  check((await page.locator('.toast', { hasText: 'MSFT' }).count()) === 1, 'No duplicate price alert on later refreshes');
  check((await page.locator('.news-item', { hasText: 'E2E mock story for Tesla' }).count()) === 1, 'News item displayed once with link');

  // 4. Manual refresh + persistence of watchlist preferences.
  const before = state.calls.length;
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await page.waitForTimeout(1500);
  check(state.calls.length > before, 'Manual refresh triggers a provider request');
  await page.locator('article', { has: page.getByRole('heading', { name: 'Tesla' }) }).getByRole('button', { name: 'Hide Tesla' }).click();
  await page.locator('article', { has: page.getByRole('heading', { name: 'Johnson & Johnson' }) }).getByRole('button', { name: /Move Johnson & Johnson up/ }).click();
  await page.reload();
  await page.locator('article .price').first().waitFor({ timeout: 15000 });
  const headings = await page.locator('article h3').allInnerTexts();
  check(!headings.includes('Tesla'), 'Hidden company stays hidden after reload');
  check(headings.indexOf('Johnson & Johnson') < headings.indexOf('Take-Two Interactive'), 'Reordered companies persist after reload');
  check((await page.locator('.history li').count()) === 0, 'History not shown until panel opened');
  await page.getByRole('button', { name: /Alerts \(/ }).click();
  check((await page.locator('.rules li').count()) === 2, 'Alert rules persist after reload');
  await page.getByRole('button', { name: 'Close alerts' }).click();

  // 5. Hidden tab pauses polling.
  // String form avoids bundler helpers being injected into the page function.
  await page.evaluate(`Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return true; } }); document.dispatchEvent(new Event('visibilitychange'));`);
  await page.waitForTimeout(300);
  check((await page.locator('.refresh-info').innerText()).includes('paused'), 'Polling pauses when the page is hidden');
  const hiddenCalls = state.calls.filter((c) => c.startsWith('/td/quote')).length;
  await page.waitForTimeout(8000);
  check(state.calls.filter((c) => c.startsWith('/td/quote')).length === hiddenCalls, 'No quote requests while hidden');
  await page.evaluate(`Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return false; } }); document.dispatchEvent(new Event('visibilitychange'));`);
  await page.waitForTimeout(1500);
  check(state.calls.filter((c) => c.startsWith('/td/quote')).length > hiddenCalls, 'Polling resumes immediately when visible again');

  // 6. Upstream outage → stale warnings, last data kept.
  mock.close();
  mock.closeAllConnections?.();
  await page.locator('article .warn', { hasText: /Last update error|failed/ }).first().waitFor({ timeout: 40000 });
  check((await page.locator('article .price').count()) > 0, 'Last good prices remain visible during provider outage');
  check(true, 'Error/stale warning displayed when updates fail');

  // 7. Mobile layout.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  const mp = await mobile.newPage();
  await mp.goto(`http://127.0.0.1:${APP_PORT}/`);
  await mp.locator('article .price').first().waitFor({ timeout: 15000 });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 1, 'No horizontal page overflow at 390px mobile width');
  const cardOverflow = await mp.evaluate(`Math.max(...[...document.querySelectorAll('article, .panel')].map((e) => e.getBoundingClientRect().right)) - window.innerWidth`);
  check((cardOverflow as number) <= 0, 'Cards and panels fit inside the 390px viewport');
  await mp.screenshot({ path: path.join(shots, 'mobile.png') });
  await page.screenshot({ path: path.join(shots, 'outage.png') });
  check(consoleErrors.filter((e) => !/Failed to load resource|ERR_CONNECTION/.test(e)).length === 0, `No unexpected console errors ${consoleErrors.join(' | ')}`);
  console.log(results.join('\n'));
  console.log(`\nE2E PASSED (${results.length} checks). Screenshots in e2e/screenshots/`);
} catch (e) {
  console.log(results.join('\n'));
  console.error(e);
  console.error('--- server log ---\n' + log);
  process.exitCode = 1;
} finally {
  await browser.close();
  app.kill();
  mock.close();
}
