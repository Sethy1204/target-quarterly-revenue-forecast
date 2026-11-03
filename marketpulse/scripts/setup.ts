/**
 * Interactive setup: asks for API keys and plan details, writes .env.
 * Usage: npm run setup
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

function parse(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const mm = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (mm) m.set(mm[1], mm[2]);
  }
  return m;
}

const base = readFileSync(existsSync(envPath) ? envPath : examplePath, 'utf8');
const current = parse(base);
const rl = createInterface({ input, output });

async function ask(key: string, prompt: string, opts: { secret?: boolean; choices?: string[] } = {}) {
  const cur = current.get(key) ?? '';
  const shown = opts.secret && cur ? `${cur.slice(0, 3)}…(set)` : cur;
  for (;;) {
    const a = (await rl.question(`${prompt}${shown ? ` [${shown}]` : ''}: `)).trim();
    const v = a || cur;
    if (opts.choices && v && !opts.choices.includes(v)) {
      console.log(`  Please enter one of: ${opts.choices.join(', ')}`);
      continue;
    }
    current.set(key, v);
    return v;
  }
}

console.log('\nMarketPulse setup — values are written to .env (git-ignored). Press Enter to keep the value in brackets.\n');
console.log('1) Twelve Data (quotes + charts). Free key: https://twelvedata.com/pricing');
await ask('TWELVEDATA_API_KEY', '   Twelve Data API key', { secret: true });
await ask('TWELVEDATA_CREDITS_PER_MINUTE', '   Plan credits per minute (0 = unlimited)');
await ask('TWELVEDATA_CREDITS_PER_DAY', '   Plan credits per day (0 = unlimited)');
console.log('   Timing your plan provides — check https://twelvedata.com/exchanges for XNAS/XNYS/XTSE:');
await ask('TWELVEDATA_US_TIMING', '   US (Nasdaq/NYSE) timing', { choices: ['real-time', 'delayed', 'end-of-day'] });
await ask('TWELVEDATA_TSX_TIMING', '   TSX timing', { choices: ['real-time', 'delayed', 'end-of-day'] });
console.log('\n2) Finnhub (news, earnings dates, market cap). Free key: https://finnhub.io/register');
await ask('FINNHUB_API_KEY', '   Finnhub API key', { secret: true });
rl.close();

// Rewrite preserving comments/order of the template.
const lines = readFileSync(examplePath, 'utf8').split(/\r?\n/).map((line) => {
  const mm = /^(\s*#?\s*)([A-Z0-9_]+)\s*=/.exec(line);
  if (mm && current.has(mm[2]) && !line.trim().startsWith('#')) return `${mm[2]}=${current.get(mm[2])}`;
  return line;
});
writeFileSync(envPath, lines.join('\n'), { mode: 0o600 });
console.log(`\nWrote ${envPath}. Start with: npm run dev  (or npm run build && npm start)\n`);
