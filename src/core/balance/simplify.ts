import { Settlement } from './types';

/**
 * Reduces a set of net balances to a minimal-ish set of settlements: repeatedly match the
 * largest debtor with the largest creditor and settle as much of that pair as possible.
 * This is the standard greedy heuristic (not a guaranteed global minimum — that's NP-hard
 * in general) used by every Splitwise-style app for multi-hop debt simplification. Ties
 * are broken by comparing `id`, so the result doesn't depend on object key order.
 */
export function simplifyDebts(balances: Readonly<Record<string, number>>): Settlement[] {
  const entries = Object.entries(balances)
    .filter(([, amount]) => amount !== 0)
    .map(([id, amount]) => ({ id, amount }));

  const settlements: Settlement[] = [];

  for (;;) {
    const debtors = entries
      .filter((e) => e.amount < 0)
      .sort((a, b) => a.amount - b.amount || (a.id < b.id ? -1 : 1));
    const creditors = entries
      .filter((e) => e.amount > 0)
      .sort((a, b) => b.amount - a.amount || (a.id < b.id ? -1 : 1));

    if (debtors.length === 0 || creditors.length === 0) break;

    const debtor = debtors[0];
    const creditor = creditors[0];
    const amount = Math.min(-debtor.amount, creditor.amount);

    settlements.push({ from: debtor.id, to: creditor.id, amountMinorUnits: amount });

    debtor.amount += amount;
    creditor.amount -= amount;

    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].amount === 0) entries.splice(i, 1);
    }
  }

  return settlements;
}
