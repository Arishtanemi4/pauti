import { describe, expect, it } from 'vitest';
import { allocateSettlement } from './settle';
import { mulberry32, randomInt } from '../testing/prng';

describe('allocateSettlement', () => {
  it('allocates fully against the oldest split first', () => {
    const allocations = allocateSettlement(1200, [
      { scopeKey: 'trx_old', outstandingAmountMinorUnits: 1000 },
      { scopeKey: 'trx_new', outstandingAmountMinorUnits: 1000 },
    ]);
    expect(allocations).toEqual([
      { scopeKey: 'trx_old', amountMinorUnits: 1000 },
      { scopeKey: 'trx_new', amountMinorUnits: 200 },
    ]);
  });

  it('stops once the amount is fully allocated, leaving later splits untouched', () => {
    const allocations = allocateSettlement(500, [
      { scopeKey: 'trx_old', outstandingAmountMinorUnits: 1000 },
      { scopeKey: 'trx_new', outstandingAmountMinorUnits: 1000 },
    ]);
    expect(allocations).toEqual([{ scopeKey: 'trx_old', amountMinorUnits: 500 }]);
  });

  it('throws when the amount exceeds total outstanding', () => {
    expect(() => allocateSettlement(3000, [{ scopeKey: 'trx_old', outstandingAmountMinorUnits: 1000 }])).toThrow(
      'exceeds'
    );
  });

  it('throws for a non-positive amount', () => {
    expect(() => allocateSettlement(0, [])).toThrow('greater than zero');
  });

  it('property: allocations always sum to the settled amount, for random outstanding sets', () => {
    const rng = mulberry32(4242);
    for (let trial = 0; trial < 300; trial++) {
      const count = randomInt(rng, 1, 8);
      const splits = Array.from({ length: count }, (_, i) => ({
        scopeKey: `trx_${i}`,
        outstandingAmountMinorUnits: randomInt(rng, 1, 5000),
      }));
      const total = splits.reduce((sum, s) => sum + s.outstandingAmountMinorUnits, 0);
      const amount = randomInt(rng, 1, total);

      const allocations = allocateSettlement(amount, splits);
      expect(allocations.reduce((sum, a) => sum + a.amountMinorUnits, 0)).toBe(amount);
      for (const a of allocations) {
        const split = splits.find((s) => s.scopeKey === a.scopeKey)!;
        expect(a.amountMinorUnits).toBeLessThanOrEqual(split.outstandingAmountMinorUnits);
      }
    }
  });
});
