import { describe, expect, it } from 'vitest';
import { ALL_LISTINGS, COMPANIES, getListing } from '../shared/companies';

describe('ticker / exchange mapping', () => {
  it('maps TELUS to TSX "T" in CAD with exchange-qualified provider symbols', () => {
    const t = getListing('T:XTSE')!;
    expect(t.companyId).toBe('telus');
    expect(t.exchange).toBe('TSX');
    expect(t.mic).toBe('XTSE');
    expect(t.currency).toBe('CAD');
    expect(t.primary).toBe(true);
    expect(t.providerSymbols.twelvedata).toEqual({ symbol: 'T', mic_code: 'XTSE' });
    expect(t.providerSymbols.finnhub).toBe('T.TO');
  });

  it('maps TELUS NYSE listing to TU in USD', () => {
    const tu = getListing('TU:XNYS')!;
    expect(tu.companyId).toBe('telus');
    expect(tu.currency).toBe('USD');
    expect(tu.primary).toBe(false);
  });

  it('never configures a US "T" listing (that ticker is AT&T, not TELUS)', () => {
    expect(ALL_LISTINGS.filter((l) => l.symbol === 'T' && l.exchange !== 'TSX')).toEqual([]);
    expect(ALL_LISTINGS.some((l) => l.providerSymbols.finnhub === 'T')).toBe(false);
    expect(COMPANIES.some((c) => /at&t/i.test(c.name))).toBe(false);
  });

  it('uses USD for all US listings and CAD only for TSX', () => {
    for (const l of ALL_LISTINGS) expect(l.currency).toBe(l.exchange === 'TSX' ? 'CAD' : 'USD');
  });

  it('has the expected symbols on the expected exchanges', () => {
    const map = Object.fromEntries(ALL_LISTINGS.map((l) => [l.id, `${l.companyId}`]));
    expect(map).toEqual({
      'SPCX:XNAS': 'spacex', 'T:XTSE': 'telus', 'TU:XNYS': 'telus', 'TTWO:XNAS': 'take-two', 'JNJ:XNYS': 'jnj',
      'CRWV:XNAS': 'coreweave', 'TSLA:XNAS': 'tesla', 'MSFT:XNAS': 'microsoft', 'GOOGL:XNAS': 'alphabet', 'GOOG:XNAS': 'alphabet',
    });
  });

  it('has unique ids and exactly one primary listing per company', () => {
    expect(new Set(ALL_LISTINGS.map((l) => l.id)).size).toBe(ALL_LISTINGS.length);
    for (const c of COMPANIES) expect(c.listings.filter((l) => l.primary)).toHaveLength(1);
  });

  it('distinguishes SpaceX from Starlink and funds', () => {
    const spx = COMPANIES.find((c) => c.id === 'spacex')!;
    expect(spx.listings.map((l) => l.symbol)).toEqual(['SPCX']);
    expect(spx.notes.join(' ')).toMatch(/Starlink.*not a separately listed/);
    expect(spx.notes.join(' ')).toMatch(/NOT SpaceX stock/);
  });
});
