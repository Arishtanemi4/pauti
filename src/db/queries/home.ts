import { SqliteExecutor } from '../migrations/runner';
import { CurrencyAmount } from './types';

export interface BalanceTile {
  readonly currency: string;
  readonly owedToMeMinorUnits: number;
  readonly iOweMinorUnits: number;
  readonly netMinorUnits: number;
}

export interface ActivityItem {
  readonly kind: 'EXPENSE' | 'SETTLEMENT';
  readonly id: string;
  readonly date: string;
  readonly description: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
}

/** Total the self user paid, per currency, over [startDate, endDate] (inclusive, ISO dates). */
export async function getPeriodSpend(
  db: SqliteExecutor,
  selfUserId: string,
  startDate: string,
  endDate: string
): Promise<CurrencyAmount[]> {
  return db.getAllAsync<CurrencyAmount>(
    `SELECT currency, SUM(total_amount) AS amountMinorUnits
     FROM transaction_header
     WHERE payer_user_id = ? AND deleted_at IS NULL AND trxn_date BETWEEN ? AND ?
     GROUP BY currency`,
    [selfUserId, startDate, endDate]
  );
}

/** Spend broken down by store category, for the self user's own paid expenses in range. */
export async function getCategoryBreakdown(
  db: SqliteExecutor,
  selfUserId: string,
  startDate: string,
  endDate: string
): Promise<Array<{ categoryName: string | null; currency: string; amountMinorUnits: number }>> {
  return db.getAllAsync(
    `SELECT sc.category_name AS categoryName, h.currency AS currency, SUM(h.total_amount) AS amountMinorUnits
     FROM transaction_header h
     LEFT JOIN stores s ON s.store_id = h.store_id
     LEFT JOIN store_categories sc ON sc.category_id = s.store_category_id
     WHERE h.payer_user_id = ? AND h.deleted_at IS NULL AND h.trxn_date BETWEEN ? AND ?
     GROUP BY sc.category_name, h.currency`,
    [selfUserId, startDate, endDate]
  );
}

/**
 * Owed/lent/net, per currency, for the self user across every group and direct expense —
 * this is the number that must agree with src/core/balance/netting.ts computed from the
 * same raw v_split_outstanding rows (see home.test.ts).
 */
export async function getBalanceTiles(db: SqliteExecutor, selfUserId: string): Promise<BalanceTile[]> {
  const rows = await db.getAllAsync<{ currency: string; owedToMe: number | null; iOwe: number | null }>(
    `SELECT currency,
            SUM(CASE WHEN creditor_id = ? THEN gross_amount ELSE 0 END) AS owedToMe,
            SUM(CASE WHEN debtor_id = ? THEN gross_amount ELSE 0 END) AS iOwe
     FROM v_directed_balance
     WHERE creditor_id = ? OR debtor_id = ?
     GROUP BY currency`,
    [selfUserId, selfUserId, selfUserId, selfUserId]
  );

  return rows.map((r) => {
    const owedToMe = r.owedToMe ?? 0;
    const iOwe = r.iOwe ?? 0;
    return { currency: r.currency, owedToMeMinorUnits: owedToMe, iOweMinorUnits: iOwe, netMinorUnits: owedToMe - iOwe };
  });
}

export async function getRecentActivity(db: SqliteExecutor, selfUserId: string, limit = 20): Promise<ActivityItem[]> {
  return db.getAllAsync<ActivityItem>(
    `SELECT 'EXPENSE' AS kind, trxn_id AS id, trxn_date AS date,
            COALESCE(description, 'Expense') AS description, total_amount AS amountMinorUnits, currency
     FROM transaction_header
     WHERE deleted_at IS NULL
       AND (payer_user_id = ? OR trxn_id IN (SELECT trxn_id FROM expense_splits WHERE debtor_id = ?))
     UNION ALL
     SELECT 'SETTLEMENT' AS kind, settlement_id AS id, settled_at AS date,
            COALESCE(note, 'Settlement') AS description, amount AS amountMinorUnits, currency
     FROM settlements
     WHERE deleted_at IS NULL AND (from_user_id = ? OR to_user_id = ?)
     ORDER BY date DESC
     LIMIT ?`,
    [selfUserId, selfUserId, selfUserId, selfUserId, limit]
  );
}
