import { describe, expect, it } from 'vitest';
import { formatDateTime, formatMarketCap, formatPercent, formatPrice, formatSigned } from '../shared/format';

describe('formatting', () => {
  it('always labels currency', () => {
    expect(formatPrice(112.345, 'CAD')).toBe('112.35 CAD');
    expect(formatPrice(1234.5, 'USD')).toBe('1,234.50 USD');
    expect(formatMarketCap(2.5e12, 'USD')).toBe('2.5T USD');
  });
  it('renders missing values as a dash, never 0', () => {
    expect(formatPrice(null, 'USD')).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
    expect(formatMarketCap(null, 'USD')).toBe('—');
  });
  it('signs changes', () => {
    expect(formatSigned(1.234)).toBe('+1.23');
    expect(formatSigned(-1.234)).toBe('−1.23');
    expect(formatPercent(0)).toBe('0.00%');
  });
  it('formats timestamps in America/Toronto by default usage', () => {
    expect(formatDateTime('2026-11-03T14:30:00Z', 'America/Toronto')).toBe('Nov 3, 2026, 9:30 AM EST');
    expect(formatDateTime('2026-07-15T13:30:00Z', 'America/Toronto')).toBe('Jul 15, 2026, 9:30 AM EDT');
    expect(formatDateTime(null, 'America/Toronto')).toBe('—');
  });
});
