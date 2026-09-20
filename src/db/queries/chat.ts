import { SqliteExecutor } from '../migrations/runner';
import { CurrencyAmount } from './types';

export interface ContactBalance {
  readonly userId: string;
  readonly balances: CurrencyAmount[]; // positive = they owe self; negative = self owes them
}

export interface ThreadItem {
  readonly kind: 'EXPENSE' | 'SETTLEMENT';
  readonly id: string;
  readonly date: string;
  readonly description: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
}

/**
 * Net balance with every contact, summed across every group plus direct expenses —
 * per currency, since amounts in different currencies are never added together.
 */
export async function getContactBalances(db: SqliteExecutor, selfUserId: string): Promise<ContactBalance[]> {
  const rows = await db.getAllAsync<{ otherUserId: string; currency: string; net: number }>(
    `SELECT other_user_id AS otherUserId, currency, SUM(signedAmount) AS net FROM (
       SELECT debtor_id AS other_user_id, currency, gross_amount AS signedAmount
       FROM v_directed_balance WHERE creditor_id = ?
       UNION ALL
       SELECT creditor_id AS other_user_id, currency, -gross_amount AS signedAmount
       FROM v_directed_balance WHERE debtor_id = ?
     )
     GROUP BY other_user_id, currency`,
    [selfUserId, selfUserId]
  );

  const byUser = new Map<string, CurrencyAmount[]>();
  for (const row of rows) {
    const list = byUser.get(row.otherUserId) ?? [];
    list.push({ currency: row.currency, amountMinorUnits: row.net });
    byUser.set(row.otherUserId, list);
  }

  return Array.from(byUser.entries()).map(([userId, balances]) => ({ userId, balances }));
}

/** Shared expenses and settlement events with one contact, chronological. */
export async function getThread(db: SqliteExecutor, selfUserId: string, otherUserId: string): Promise<ThreadItem[]> {
  return db.getAllAsync<ThreadItem>(
    `SELECT DISTINCT 'EXPENSE' AS kind, h.trxn_id AS id, h.trxn_date AS date,
            COALESCE(h.description, 'Expense') AS description, h.total_amount AS amountMinorUnits, h.currency
     FROM transaction_header h
     JOIN expense_splits s ON s.trxn_id = h.trxn_id
     WHERE h.deleted_at IS NULL
       AND ((h.payer_user_id = ? AND s.debtor_id = ?) OR (h.payer_user_id = ? AND s.debtor_id = ?))
     UNION ALL
     SELECT 'SETTLEMENT' AS kind, settlement_id AS id, settled_at AS date,
            COALESCE(note, 'Settlement') AS description, amount AS amountMinorUnits, currency
     FROM settlements
     WHERE deleted_at IS NULL
       AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
     ORDER BY date ASC`,
    [selfUserId, otherUserId, otherUserId, selfUserId, selfUserId, otherUserId, otherUserId, selfUserId]
  );
}
