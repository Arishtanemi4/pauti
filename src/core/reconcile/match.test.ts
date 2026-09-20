import { describe, expect, it } from 'vitest';
import { matchCandidates } from './match';

describe('matchCandidates', () => {
  it('scores a same-day, same-amount match at 1.0', () => {
    const candidates = matchCandidates(
      [{ id: 's1', amountMinorUnits: 1500, date: '2026-01-15' }],
      [{ id: 'r1', amountMinorUnits: 1500, date: '2026-01-15' }]
    );
    expect(candidates).toEqual([{ statementLineId: 's1', receiptId: 'r1', score: 1 }]);
  });

  it('never matches on amount alone — different amounts are excluded entirely', () => {
    const candidates = matchCandidates(
      [{ id: 's1', amountMinorUnits: 1500, date: '2026-01-15' }],
      [{ id: 'r1', amountMinorUnits: 1600, date: '2026-01-15' }]
    );
    expect(candidates).toEqual([]);
  });

  it('excludes matches beyond the date distance cutoff', () => {
    const candidates = matchCandidates(
      [{ id: 's1', amountMinorUnits: 1500, date: '2026-01-01' }],
      [{ id: 'r1', amountMinorUnits: 1500, date: '2026-01-20' }],
      { maxDateDistanceDays: 7 }
    );
    expect(candidates).toEqual([]);
  });

  it('returns every candidate, scored, when more than one receipt could match — never a single answer', () => {
    const candidates = matchCandidates(
      [{ id: 's1', amountMinorUnits: 1500, date: '2026-01-15' }],
      [
        { id: 'r1', amountMinorUnits: 1500, date: '2026-01-15' },
        { id: 'r2', amountMinorUnits: 1500, date: '2026-01-14' },
      ]
    );
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toEqual({ statementLineId: 's1', receiptId: 'r1', score: 1 });
    expect(candidates[1].receiptId).toBe('r2');
    expect(candidates[1].score).toBeLessThan(1);
  });
});
