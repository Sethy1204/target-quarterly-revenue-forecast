# Listing verification (performed 2026-11-03)

Method: web searches made from the build environment. Full pages from several primary sites (Wikipedia, provider sites) could **not** be opened from that environment, so some findings rely on search-result excerpts of the listed sources. Re-check against the primary sources before relying on them.

| Company | Finding | Sources consulted |
|---|---|---|
| SpaceX | **Publicly traded.** Space Exploration Technologies Corp. Class A common stock trades on **Nasdaq as SPCX** in USD. The IPO priced on 11 Jun 2026 at US$135, and trading began on 12 Jun 2026. Class B shares carry 10 votes per share. Starlink is a business within SpaceX (Connectivity segment) and is not separately listed. xAI merged into SpaceX in Feb 2026. | Nasdaq newsroom (SpaceX IPO and proceeds articles), SEC EDGAR S-1 / S-1/A filings (CIK 1181412), CNBC 2026-06-12, CNN 2026-05-20 / 2026-06-12, CNBC 2026-02-03 |
| TELUS | TSX: **T** (CAD); NYSE: **TU** (USD). The NYSE ticker **T** is AT&T Inc. (unrelated). | TELUS investor relations; general exchange listings |
| Take-Two Interactive | Nasdaq: TTWO (USD) | Company IR |
| Johnson & Johnson | NYSE: JNJ (USD) | Company IR |
| CoreWeave | Nasdaq: CRWV (USD), Class A | Company IR |
| Tesla | Nasdaq: TSLA (USD) | Company IR |
| Microsoft | Nasdaq: MSFT (USD) | Company IR |
| Alphabet | Nasdaq: GOOGL (Class A) and GOOG (Class C), USD | Company IR |

For TELUS, Take-Two, J&J, CoreWeave, Tesla, Microsoft and Alphabet, the listings match the task brief and long-standing public listings. No delisting or ticker change came up in this session's searches, but it did not run a dedicated search for each company. Confirm current status on each company's investor-relations page or on the exchange's site.

## Provider capability notes (from provider documentation and search excerpts)

- **Twelve Data.**
  - The exchange page lists the Toronto Stock Exchange (MIC XTSE) with delay "EOD".
  - Pre/post-market data via `prepost=true` is documented for Pro plans and above.
  - Pricing gives the free and Basic plans an 800-request daily cap. Paid plans have per-minute credit limits.
  - Fundamentals start at the Grow plan.
- **Finnhub.**
  - The free tier is widely documented at 60 calls/min.
  - Company news is included in the free tier.
  - The pricing page lists TSX among its international markets. The documentation, however, describes real-time international prices as an Enterprise feature, and another table lists TSX as end-of-day. Treat TSX coverage as plan-dependent.

These capabilities change. Check the current pricing and docs pages for your account.
