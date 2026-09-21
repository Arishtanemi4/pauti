import { describe, expect, it } from 'vitest';
import { periodRange } from './period';

describe('periodRange', () => {
  it('DAILY is a single day', () => {
    expect(periodRange('DAILY', new Date(2026, 0, 15))).toEqual({ startDate: '2026-01-15', endDate: '2026-01-15' });
  });

  it('WEEKLY spans Sunday to Saturday', () => {
    // 2026-01-15 is a Thursday.
    expect(periodRange('WEEKLY', new Date(2026, 0, 15))).toEqual({ startDate: '2026-01-11', endDate: '2026-01-17' });
  });

  it('MONTHLY spans the full calendar month, including a leap February', () => {
    expect(periodRange('MONTHLY', new Date(2026, 0, 15))).toEqual({ startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(periodRange('MONTHLY', new Date(2028, 1, 10))).toEqual({ startDate: '2028-02-01', endDate: '2028-02-29' });
  });

  it('YEARLY spans Jan 1 to Dec 31', () => {
    expect(periodRange('YEARLY', new Date(2026, 5, 1))).toEqual({ startDate: '2026-01-01', endDate: '2026-12-31' });
  });

  it('property: startDate is never after endDate, for every period and every day of a year', () => {
    for (let day = 0; day < 365; day++) {
      const date = new Date(2026, 0, 1 + day);
      for (const period of ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const) {
        const { startDate, endDate } = periodRange(period, date);
        expect(startDate <= endDate).toBe(true);
      }
    }
  });
});
