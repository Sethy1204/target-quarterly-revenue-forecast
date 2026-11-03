/**
 * Curated, dated SpaceX developments with source links.
 *
 * Compiled 2026-11-03 from search results of the listed publishers. Figures come from
 * those sources' own reporting; where sources differed, the difference is noted.
 * This list is static and does NOT update automatically — live SpaceX news comes from
 * the configured news provider. Re-check each item at its source before relying on it.
 */

export interface Development {
  date: string; // YYYY-MM-DD (event date)
  category: 'listing' | 'financing/valuation' | 'corporate' | 'launch';
  title: string;
  detail: string;
  /** True when a valuation figure is a private-market or implied estimate, not a trading price. */
  valuationEstimate?: boolean;
  sources: { label: string; url: string }[];
}

export const SPACEX_COMPILED_ON = '2026-11-03';

export const SPACEX_DEVELOPMENTS: Development[] = [
  {
    date: '2026-02-02',
    category: 'corporate',
    title: 'xAI combined with SpaceX',
    detail:
      'SpaceX\'s merger with xAI closed in early February 2026; CNBC reported the combination valued at about US$1.25 trillion. That figure is a private-market valuation from before the IPO — not a market capitalisation from trading.',
    valuationEstimate: true,
    sources: [{ label: 'CNBC (2026-02-03)', url: 'https://www.cnbc.com/2026/02/03/musk-xai-spacex-biggest-merger-ever.html' }],
  },
  {
    date: '2026-05-20',
    category: 'listing',
    title: 'SpaceX filed its S-1 registration statement',
    detail: 'Space Exploration Technologies Corp. filed to list Class A common stock on Nasdaq under the symbol SPCX. Class B shares carry 10 votes per share.',
    sources: [
      { label: 'SEC EDGAR — S-1', url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026036936/spaceexplorationtechnologi.htm' },
      { label: 'CNN (2026-05-20)', url: 'https://www.cnn.com/2026/05/20/business/spacex-files-for-stock-sale-ipo-elon-musk' },
    ],
  },
  {
    date: '2026-06-12',
    category: 'listing',
    title: 'SPCX began trading on Nasdaq',
    detail:
      'The IPO priced at US$135 per share on 11 Jun 2026; shares opened at US$150 on 12 Jun. Reported first-day close: US$160.95 (CNBC) / US$161.11 (CNN) — sources differ slightly.',
    sources: [
      { label: 'CNBC (2026-06-12)', url: 'https://www.cnbc.com/2026/06/12/spacex-ipo-spcx-live-updates.html' },
      { label: 'Nasdaq newsroom', url: 'https://www.nasdaq.com/newsroom/spacex-ipo-rocket-company-launches-historic-ipo' },
    ],
  },
  {
    date: '2026-06-12',
    category: 'financing/valuation',
    title: 'IPO proceeds',
    detail: 'Nasdaq reported total proceeds of US$85.7 billion after underwriters exercised the over-allotment (greenshoe) option; the base deal was reported at about US$75 billion.',
    sources: [{ label: 'Nasdaq newsroom', url: 'https://www.nasdaq.com/newsroom/spacex-makes-history-raising-85-billion-through-nasdaq-listing' }],
  },
  {
    date: '2026-09-28',
    category: 'launch',
    title: 'Starship Flight 14 reached orbit',
    detail: 'First Starship mission to reach orbit and deploy an operational payload — Starlink V3 satellites (reported as 26).',
    sources: [
      { label: 'CNBC (2026-09-28)', url: 'https://www.cnbc.com/2026/09/28/spacex-prepares-to-send-starship-rocket-to-orbit-for-first-time.html' },
      { label: 'Spaceflight Now (2026-09-28)', url: 'https://spaceflightnow.com/2026/09/28/live-coverage-spacex-to-launch-first-starlink-v3-satellites-to-orbit-on-starship/' },
    ],
  },
  {
    date: '2026-10-31',
    category: 'launch',
    title: 'Falcon 9 launched 27 Starlink satellites from California',
    detail: 'Space.com described it as the 118th Falcon 9 flight of 2026 (count per the publisher).',
    sources: [{ label: 'Space.com', url: 'https://www.space.com/space-exploration/launches-spacecraft/spacex-starlink-launch-falcon-9-group-15-18-landing-ocisly' }],
  },
];

export const SPACEX_DISTINCTIONS = [
  'SPCX = Class A common stock of Space Exploration Technologies Corp. (SpaceX), listed on Nasdaq in USD.',
  'Starlink is SpaceX\'s satellite-internet business (reported within its Connectivity segment). It has no separate stock listing.',
  'Funds, ETFs, SPVs or other companies that hold SpaceX shares are not SpaceX stock; MarketPulse never shows them as SPCX.',
  'Pre-IPO figures (private funding rounds, tender offers, merger valuations) are estimates, not trading prices.',
];
