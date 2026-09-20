import { Debt } from './types';

/**
 * Nets a list of directed debts down to one balance per person: positive means the person
 * is owed money overall, negative means they owe money overall. The sum of all values is
 * always zero (money only moves between participants, it doesn't appear or vanish).
 */
export function netBalances(debts: readonly Debt[]): Record<string, number> {
  const balances: Record<string, number> = {};
  for (const d of debts) {
    balances[d.from] = (balances[d.from] ?? 0) - d.amountMinorUnits;
    balances[d.to] = (balances[d.to] ?? 0) + d.amountMinorUnits;
  }
  return balances;
}

/** Combines net balances from multiple groups (or multiple pairs) into one running total. */
export function rollUpBalances(balanceSets: readonly Readonly<Record<string, number>>[]): Record<string, number> {
  const combined: Record<string, number> = {};
  for (const set of balanceSets) {
    for (const [id, amount] of Object.entries(set)) {
      combined[id] = (combined[id] ?? 0) + amount;
    }
  }
  return combined;
}
