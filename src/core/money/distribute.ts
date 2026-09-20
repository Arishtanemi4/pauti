// Deterministic remainder distribution (largest-remainder method). Splitting a total
// across weighted shares can leave a handful of minor units unaccounted for after
// flooring each share's exact allocation; this hands those leftover units out one at a
// time to the shares with the largest fractional remainder. Ties are broken by comparing
// `id` — never array position — so the result does not depend on input order, locale, or
// wall-clock time (docs/plan/EXECUTE.md Phase 1.1).

import { Fraction, ZERO, addFractions } from './fraction';

export interface WeightedShare {
  readonly id: string;
  readonly weight: Fraction;
}

export function distributeByWeight(
  totalMinorUnits: number,
  shares: readonly WeightedShare[]
): Record<string, number> {
  if (!Number.isInteger(totalMinorUnits)) {
    throw new Error('totalMinorUnits must be an integer');
  }
  if (shares.length === 0) {
    if (totalMinorUnits !== 0) {
      throw new Error('Cannot distribute a non-zero total across zero shares');
    }
    return {};
  }

  const weightSum = shares.reduce<Fraction>((acc, s) => addFractions(acc, s.weight), ZERO);
  if (weightSum.num <= 0) {
    throw new Error('Total weight must be greater than zero');
  }

  const allocations = shares.map((s) => {
    // exact share = totalMinorUnits * (s.weight / weightSum)
    const numerator = totalMinorUnits * s.weight.num * weightSum.den;
    const denominator = s.weight.den * weightSum.num;
    const floor = Math.floor(numerator / denominator);
    const remainderNumerator = numerator - floor * denominator;
    return { id: s.id, floor, remainderNumerator, denominator };
  });

  const result: Record<string, number> = {};
  let allocated = 0;
  for (const a of allocations) {
    result[a.id] = a.floor;
    allocated += a.floor;
  }

  const remaining = totalMinorUnits - allocated;
  if (remaining < 0) {
    throw new Error('Distribution over-allocated; this indicates a bug');
  }

  const ranked = [...allocations].sort((x, y) => {
    // Largest fractional remainder first: compare x.remainder/x.denominator against
    // y.remainder/y.denominator via cross-multiplication (denominators may differ).
    const cross = y.remainderNumerator * x.denominator - x.remainderNumerator * y.denominator;
    if (cross !== 0) return cross;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });

  for (let i = 0; i < remaining; i++) {
    result[ranked[i].id] += 1;
  }

  return result;
}

export function distributeEqually(totalMinorUnits: number, ids: readonly string[]): Record<string, number> {
  return distributeByWeight(
    totalMinorUnits,
    ids.map((id) => ({ id, weight: { num: 1, den: 1 } }))
  );
}
