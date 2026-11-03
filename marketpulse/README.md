# MarketPulse

A dark-themed stock and company-news dashboard for a fixed watchlist. It shows quotes, charts, news, upcoming earnings and in-app alerts. Data comes from documented market-data APIs behind replaceable provider adapters. MarketPulse never simulates prices, headlines or refresh times.

| Company | Listing(s) shown | Currency |
|---|---|---|
| SpaceX (Space Exploration Technologies Corp.) | **Nasdaq: SPCX** (Class A). Public since 12 Jun 2026 | USD |
| TELUS Corporation | **TSX: T** (default). NYSE: TU | CAD / USD |
| Take-Two Interactive | Nasdaq: TTWO | USD |
| Johnson & Johnson | NYSE: JNJ | USD |
| CoreWeave | Nasdaq: CRWV | USD |
| Tesla | Nasdaq: TSLA | USD |
| Microsoft | Nasdaq: MSFT | USD |
| Alphabet | Nasdaq: GOOGL (Class A), GOOG (Class C) | USD |

TELUS's TSX ticker `T` is always sent to providers with the exchange attached (`mic_code=XTSE` / `T.TO`). A bare `T` is never sent, because on the NYSE `T` is AT&T. A quote is rejected if the provider returns a different exchange or currency. See [VERIFICATION.md](VERIFICATION.md) for how each listing was checked.

---

## 1. Install and launch

Requirements: Node.js 20 or newer (tested with 22.x) and npm.

```bash
cd marketpulse
npm install
```

**Configure the providers.** You can use the interactive setup:

```bash
npm run setup
```

Or edit the example file by hand:

```bash
cp .env.example .env
```

**Development** (API on :8787 and Vite on :5173 with hot reload). Open http://localhost:5173.

```bash
npm run dev
```

**Production** (one process serving the API and the built UI). Open http://localhost:8787.

```bash
npm run build
```

```bash
npm start
```

**Demo mode** (no keys, no network calls, clearly labelled static fixtures):

```bash
npm run build
```

```bash
npm run start:demo
```

If you start the app without any keys, the UI opens a setup screen. It lists the missing variables and the steps to fix them. The app does not show any prices in that state.

## 2. Provider accounts, keys and subscriptions

| Role | Provider | Account | Env var |
|---|---|---|---|
| Quotes (US + TSX), price charts | **Twelve Data**: `/quote`, `/time_series` | https://twelvedata.com/pricing (free "Basic" plan available) | `TWELVEDATA_API_KEY` |
| Company news, earnings calendar, market cap | **Finnhub**: `/company-news`, `/calendar/earnings`, `/stock/profile2` | https://finnhub.io/register (free plan available) | `FINNHUB_API_KEY` |

API keys are read only by the Node server from `.env`. They never go to the browser. Finnhub keys are sent in the `X-Finnhub-Token` header, and keys are removed from any error message the server logs.

**What to check on your plans before relying on the labels.** These details change, so verify them on the providers' own pages:

- **Data timing per exchange.** Twelve Data's exchange page listed the Toronto Stock Exchange (XTSE) as **end-of-day** when this was built. Intraday TSX data (and therefore the 1D/5D TSX charts) may need a higher plan or may not be offered at all. Set `TWELVEDATA_US_TIMING` and `TWELVEDATA_TSX_TIMING` in `.env` to `real-time`, `delayed` or `end-of-day`, matching what your plan provides. The UI labels quotes from these declarations. By default, US data is labelled **delayed (~15 min)** until you declare otherwise, and TSX data is labelled **end-of-day**.
- **Rate limits.** The defaults match Twelve Data's free plan: 8 credits/min and 800 credits/day, at 1 credit per symbol. Finnhub's free plan is documented at 60 calls/min, and MarketPulse uses 50/min by default. Enter your own plan's numbers in `.env`.
- **Extended hours.** Twelve Data documents `prepost=true` pre/post-market data for Pro plans and above. Set `TWELVEDATA_PREPOST=true` only if your plan includes it. Otherwise each card says "Extended-hours price: not provided by current feed/plan".
- **Licensing.** Free tiers are generally licensed for personal, non-commercial use, and Finnhub's free news licence is described that way. Read each provider's terms before any commercial or public deployment, or before redistributing the data.

**Free-plan math.** All 10 listings cost 10 credits per refresh. 800 credits/day spread across a 16-hour active window allows one refresh about every **12 minutes**, and the server sets that interval automatically. You can refresh more often by hiding companies (hidden companies are not polled), upgrading the plan and raising the limits in `.env`, or setting `QUOTE_PROVIDER=finnhub` for US-only quotes. Finnhub's `/quote` has no volume field, and its TSX coverage depends on the plan.

## 3. Architecture

```
marketpulse/
├─ shared/            Pure TypeScript used by server and UI (unit-tested)
│  ├─ companies.ts    Verified watchlist: ids, exchanges, MICs, currencies, provider symbols
│  ├─ market.ts       Change/% math, exchange sessions + holiday tables, timezone helpers
│  ├─ freshness.ts    real-time / delayed / end-of-day / stale classification
│  ├─ alerts.ts       Alert engine with duplicate prevention
│  ├─ series.ts       Common-baseline % normalisation for comparisons
│  ├─ spacex.ts       Dated, sourced SpaceX milestones (static)
│  └─ types.ts, format.ts
├─ server/
│  ├─ providers/      Adapter interfaces + twelvedata.ts, finnhub.ts, demo.ts, registry.ts
│  ├─ services/       Quote scheduler/cache, charts, news (dedupe), earnings, fundamentals
│  ├─ http.ts         fetch with timeout, bounded retries, exponential backoff, key redaction
│  ├─ rateGate.ts     Token bucket (per-minute), daily cap, 429 cooldown (60 s → 15 min)
│  ├─ app.ts          Express routes (/api/config, quotes, chart, news, earnings, fundamentals)
│  └─ index.ts        Loads .env, serves API + built UI
├─ src/               React UI (cards, SVG charts, news, alerts, status panel, settings)
├─ tests/             Vitest unit + integration tests (mocked provider responses)
└─ e2e/               Playwright smoke test against a local mock provider
```

- **Provider adapters.** The services and UI depend only on the interfaces in `server/providers/types.ts`. To change provider, write one adapter and wire it in `registry.ts`.
- **Refresh model.** The browser polls the server on the schedule the server returns. The server caches each listing and calls the provider only when the listing is due. The refresh interval is calculated from the provider's per-minute and per-day budget, and stretches to 15 minutes when all markets are closed. Many tabs therefore do not multiply provider usage. Both providers' free plans are REST polling, so no streaming is used. Twelve Data documents WebSocket streaming only on higher plans.
- **Manual refresh** skips the cache. It is still throttled to once per 10 s and still limited by the provider budget.
- **Failures.** Network and 5xx errors get bounded retries with exponential backoff. HTTP 429 is never retried right away: the server enters a cooldown and serves cached data marked with a warning. Each listing also backs off on its own after failures (30 s up to 15 min). The browser backs off too (15 s up to 10 min).
- **Hidden tab.** Polling stops while the page is hidden. When the page becomes visible again, it refreshes immediately if a refresh is due.

## 4. Features

- **Company cards.** Each card shows the last price with an explicit **CAD/USD** label and the daily change and % against the previous close. It also shows prev close, open, high/low, volume and market cap (company-level, from Finnhub's profile). Further fields: the quote timestamp and its age, exchange, provider, and session status (pre-market / regular / after-hours / closed / holiday) using NYSE/Nasdaq and TSX holiday tables for 2026–2027. A **freshness badge** reads Real-time, Delayed ~N min, End-of-day / Last close, Stale, or DEMO.
- **Extended hours** appear on a separate line, with their change measured against the regular-session close and labelled as such. They are never mixed into the daily change.
- **Missing values** display as "—" with a tooltip. Values are never zero-filled. Finnhub's all-zero "no data" replies are treated as missing.
- **Charts.** Ranges: 1D, 5D, 1M, 6M, YTD, 1Y. Hovering or touching shows a crosshair tooltip with times in the selected timezone. **Compare %** mode normalises every series to a **common baseline time**. When a range isn't available on your plan, the chart says so.
- **SpaceX panel.** Explains how SPCX, Starlink, xAI and third-party funds relate. It filters live headlines into launch/Starlink and financing/valuation groups (by headline keywords, labelled as such). It also includes a static, dated milestone list with source links. Pre-IPO valuations are labelled "Private valuation estimate — not a trading price".
- **News.** Each story shows headline, publisher, publication time and age, a link to the original, the related companies, and the feed's own summary when one is supplied (MarketPulse never generates summaries). Stories are deduplicated by normalised URL and by publisher + headline, and merged across companies. You can filter by company and by type. Press-release wire publishers are marked as "Company announcement". The feed doesn't label opinion pieces, so other items say "type not specified". There are no "breaking" labels: age is shown instead.
- **Earnings.** Upcoming dates come from Finnhub and are all shown as **"Unconfirmed (provider estimate)"**, because the provider does not say which dates the company has confirmed.
- **Alerts** (in-app only). Types: price at or above / at or below, daily move of at least ±X%, and new company news. Each alert shows the triggering price or headline, the currency, the source, the data timestamp and the trigger time. Duplicates are prevented: price alerts re-arm only after the price crosses back, % alerts fire once per trading day, and news alerts fire once per story and only for stories published after the rule was created (with a 15-min grace window). Alerts never fire on data marked stale. Optional browser notifications work while the page is open.
- **Usability.** Default timezone is America/Toronto, and you can change it. Companies can be reordered and hidden. Preferences and alert rules persist in localStorage. The UI has loading, empty, disconnected, error, rate-limited, stale and setup states, a "Data sources & freshness" panel, and layouts for desktop and mobile.

## 5. Tests actually performed

Run them yourself:

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build
```

```bash
npm run test:e2e
```

`npm run test:e2e` needs Playwright and Chromium: `npm i -D playwright && npx playwright install chromium`.

- **75 Vitest tests, all passing.**
  - Ticker/exchange/currency mapping, including that TELUS is never sent as a bare `T` and that AT&T-style mismatches are rejected.
  - % calculations and null handling, sessions across EST/EDT, holidays and early closes, timezone conversion, and the freshness rules.
  - Currency and timezone formatting, common-baseline normalisation, and alert dedupe for all three alert types.
  - Retry and backoff, 429 handling, the rate budget and daily cap, and key redaction.
  - Twelve Data and Finnhub parsing, batching and error mapping, plus news dedupe.
  - Quote-service caching, scheduling, force-refresh throttling, outage behaviour, stale marking and 429 cooldowns.
  - Full HTTP API tests in live (mocked upstream), unconfigured and demo modes.
- **Playwright end-to-end smoke test, 31 checks passing.** It runs the production build against a **local mock** of the Twelve Data and Finnhub endpoints. It covers:
  - CAD/USD labels and the TELUS TSX/NYSE tabs, plus the end-of-day and delayed labels.
  - "—" for a missing value, and Toronto-timezone display while the browser is set to Vancouver.
  - All chart ranges and compare mode.
  - A price alert and a news alert firing after automatic refresh, with no duplicates afterwards.
  - Manual refresh, and hide/reorder/alert persistence across reload.
  - Polling pausing while the tab is hidden and resuming when it is visible.
  - An upstream outage: last prices kept and warnings shown.
  - No horizontal overflow at 390 px.

**Not verified:** the build environment could not reach `api.twelvedata.com` or `finnhub.io` (outbound access was blocked). Live provider responses, plan coverage (especially TSX), real rate-limit behaviour and real news content have **not** been checked against the real APIs. The adapters follow the providers' documented request and response formats, but field-level details are worth checking on first run. In particular, check Twelve Data's `last_quote_at`, `extended_*` and `is_market_open` fields and its batch response shape. The **Data sources & freshness** panel shows any provider error message as it happens.

## 6. Limitations

- **Quote delay depends on your plan.** MarketPulse labels data according to your declared plan timing and the provider's timestamps. Refreshing often does not make delayed data real-time. On free plans, US data may be delayed and TSX data is end-of-day.
- **Alerts run only while the app is open** in a browser tab, and pause while the tab is hidden, because polling pauses. There is no backend scheduler, email, SMS or push service. Rules are stored per browser.
- **Free-plan refresh is slow** for 10 symbols (about every 12 min) because of the daily credit cap. See section 2.
- **Holiday tables** cover 2026–2027 and need yearly updates. Outside those years the cards say so, and the server prefers the provider's market-open flag when one is given.
- **Market cap** is updated a few times a day from the company profile, not computed in real time. GOOGL and GOOG share one Alphabet market cap.
- **News typing** relies on publisher and category hints. Opinion can't be detected from this feed. Topic tags are headline keyword matches.
- **SpaceX milestones** are a static list compiled on 2026-11-03 from the sources linked in the app. Re-verify them at the source. Live SpaceX headlines come from the news feed.
- The server keeps its cache in memory, so a restart clears it. It is designed for a single user or a small team, not for public redistribution of data.
