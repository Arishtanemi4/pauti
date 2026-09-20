import { describe, expect, it } from 'vitest';
import { netBalances, rollUpBalances } from './netting';
import { simplifyDebts } from './simplify';
import { mulberry32, randomInt } from '../testing/prng';

function applySettlements(settlements: ReturnType<typeof simplifyDebts>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const s of settlements) {
    result[s.from] = (result[s.from] ?? 0) - s.amountMinorUnits;
    result[s.to] = (result[s.to] ?? 0) + s.amountMinorUnits;
  }
  return result;
}

/** Generates a random balance set that is a valid closed system: it always sums to zero. */
function randomZeroSumBalances(rng: () => number, count: number): Record<string, number> {
  const balances: Record<string, number> = {};
  let running = 0;
  for (let i = 0; i < count - 1; i++) {
    const amount = randomInt(rng, -10_000, 10_000);
    balances[`p${i}`] = amount;
    running += amount;
  }
  balances[`p${count - 1}`] = -running;
  return balances;
}

describe('netBalances', () => {
  it('nets a pair of opposing debts down to one balance each', () => {
    const balances = netBalances([
      { from: 'a', to: 'b', amountMinorUnits: 500 },
      { from: 'b', to: 'a', amountMinorUnits: 200 },
    ]);
    expect(balances).toEqual({ a: -300, b: 300 });
  });
});

describe('rollUpBalances', () => {
  it('sums balances for the same person across groups', () => {
    const combined = rollUpBalances([{ a: 100, b: -100 }, { a: -40, c: 40 }]);
    expect(combined).toEqual({ a: 60, b: -100, c: 40 });
  });
});

describe('simplifyDebts', () => {
  it('produces zero settlements for a set of balances that is already all zero', () => {
    expect(simplifyDebts({ a: 0, b: 0 })).toEqual([]);
  });

  it('property: applying the settlements reproduces the original balances exactly, for random closed systems', () => {
    const rng = mulberry32(2026);
    for (let trial = 0; trial < 300; trial++) {
      const count = randomInt(rng, 2, 10);
      const balances = randomZeroSumBalances(rng, count);

      const settlements = simplifyDebts(balances);
      const reconstructed = applySettlements(settlements);

      for (const id of Object.keys(balances)) {
        expect(reconstructed[id] ?? 0).toBe(balances[id]);
      }
    }
  });

  it('property: every settlement set nets every participant to zero once applied on top of their balance', () => {
    const rng = mulberry32(31337);
    for (let trial = 0; trial < 300; trial++) {
      const count = randomInt(rng, 2, 10);
      const balances = randomZeroSumBalances(rng, count);

      const settlements = simplifyDebts(balances);
      const net: Record<string, number> = { ...balances };
      for (const s of settlements) {
        net[s.from] += s.amountMinorUnits;
        net[s.to] -= s.amountMinorUnits;
      }

      for (const amount of Object.values(net)) {
        expect(amount).toBe(0);
      }
    }
  });
});
