import { describe, expect, it } from 'vitest';
import { computeSplit } from './split';
import { mulberry32, randomInt } from '../testing/prng';

describe('computeSplit', () => {
  it('EQUAL: splits evenly with a stable remainder rule', () => {
    const result = computeSplit(100, 'EQUAL', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(Object.values(result).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('SHARES: "a third of the wine" is an exact 1/3, not the float 0.3333', () => {
    const result = computeSplit(300, 'SHARES', [
      { id: 'alice', weight: { num: 1, den: 3 } },
      { id: 'bob', weight: { num: 2, den: 3 } },
    ]);
    expect(result).toEqual({ alice: 100, bob: 200 });
  });

  it('EXACT: passes amounts through when they sum to the total', () => {
    const result = computeSplit(100, 'EXACT', [
      { id: 'a', amount: 60 },
      { id: 'b', amount: 40 },
    ]);
    expect(result).toEqual({ a: 60, b: 40 });
  });

  it('EXACT: rejects amounts that do not sum to the total', () => {
    expect(() =>
      computeSplit(100, 'EXACT', [
        { id: 'a', amount: 60 },
        { id: 'b', amount: 30 },
      ])
    ).toThrow();
  });

  it('PERCENT: rejects a participant missing a weight', () => {
    expect(() => computeSplit(100, 'PERCENT', [{ id: 'a' }])).toThrow();
  });

  it('property: EQUAL/PERCENT/SHARES components always sum back to the total, for randomised amounts and participant counts', () => {
    const rng = mulberry32(1234);
    const methods = ['EQUAL', 'PERCENT', 'SHARES'] as const;
    for (let trial = 0; trial < 500; trial++) {
      const total = randomInt(rng, 0, 1_000_000);
      const method = methods[randomInt(rng, 0, methods.length - 1)];
      const count = randomInt(rng, 1, 15);
      const participants = Array.from({ length: count }, (_, i) => ({
        id: `p${i}`,
        weight: { num: randomInt(rng, 1, 25), den: 1 },
      }));

      const result = computeSplit(total, method, participants);
      const sum = Object.values(result).reduce((a, b) => a + b, 0);
      expect(sum).toBe(total);
    }
  });
});
