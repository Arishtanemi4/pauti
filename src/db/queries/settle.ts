import { SqliteExecutor } from '../migrations/runner';

// Outstanding splits between a debtor/creditor pair, oldest-first, for the settle-up action
// (docs/plan/EXECUTE.md §5.2, ADR-006). This module only reads and orders; the allocation
// arithmetic is pure and lives in src/core/balance's allocateSettlement.

export interface OutstandingSplitRow {
  readonly scopeKey: string;
  readonly groupId: string;
  readonly crdtDocId: string;
  readonly outstandingAmountMinorUnits: number;
}

/**
 * Every split `debtorId` still owes `creditorId` in `currency`, oldest transaction date
 * first. Pass `groupId` to scope the settlement to a single group (the group screen);
 * omit it to span every group the pair shares (the chat thread, per ADR-006).
 */
export async function getOutstandingSplits(
  db: SqliteExecutor,
  debtorId: string,
  creditorId: string,
  currency: string,
  groupId?: string
): Promise<OutstandingSplitRow[]> {
  const params: unknown[] = [debtorId, creditorId, currency];
  let groupFilter = '';
  if (groupId) {
    groupFilter = 'AND o.group_id = ?';
    params.push(groupId);
  }

  return db.getAllAsync<OutstandingSplitRow>(
    `SELECT COALESCE(o.line_id, o.trxn_id) AS scopeKey, o.group_id AS groupId, g.crdt_doc_id AS crdtDocId,
            o.outstanding_amount AS outstandingAmountMinorUnits
     FROM v_split_outstanding o
     JOIN transaction_header h ON h.trxn_id = o.trxn_id
     JOIN groups g ON g.group_id = o.group_id
     WHERE o.debtor_id = ? AND o.creditor_id = ? AND o.currency = ? AND o.outstanding_amount > 0 ${groupFilter}
     ORDER BY h.trxn_date ASC, COALESCE(o.line_id, o.trxn_id) ASC`,
    params
  );
}
