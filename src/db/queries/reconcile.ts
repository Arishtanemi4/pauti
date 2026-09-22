import { SqliteExecutor } from '../migrations/runner';
import { MatchCandidate, Receipt, StatementLine, matchCandidates } from '../../core/reconcile';

// Reconciliation (docs/plan/EXECUTE.md Phase 6, task 6.6): links a statement entry to a
// transaction. statement_entries is private/local-only, but transaction_header is a
// CRDT-derived table (docs/architecture.md §4.3) whose reconciled_entry_id would reference
// data that only exists on this device — syncing it to another member's device would either
// leak private statement data or violate the table's own foreign key on devices that never
// imported that statement. So, unlike every other transaction_header field, this column is
// written directly here rather than through src/crdt/write.ts + the projector, exactly as
// src/db/projector.ts already treats it (absent from both its INSERT and its ON CONFLICT
// UPDATE clause, so a reprojection never touches or clears it).

export interface UnmatchedStatementEntry {
  readonly entryId: string;
  readonly statementDate: string;
  readonly description: string;
  readonly amountMinorUnits: number; // signed; negative = debit
  readonly currency: string;
  readonly matchedTrxnId: string | null;
  readonly matchConfidence: number | null;
  readonly matchStatus: 'UNMATCHED' | 'SUGGESTED' | 'CONFIRMED' | 'IGNORED';
}

export interface ReconciliationCandidateTransaction {
  readonly trxnId: string;
  readonly trxnDate: string;
  readonly description: string | null;
  readonly totalAmount: number;
}

export async function getUnmatchedStatementEntries(db: SqliteExecutor, userId: string): Promise<UnmatchedStatementEntry[]> {
  return db.getAllAsync<UnmatchedStatementEntry>(
    `SELECT entry_id AS entryId, statement_date AS statementDate, description, amount AS amountMinorUnits,
            currency, matched_trxn_id AS matchedTrxnId, match_confidence AS matchConfidence,
            match_status AS matchStatus
     FROM statement_entries
     WHERE user_id = ? AND match_status IN ('UNMATCHED', 'SUGGESTED') AND deleted_at IS NULL
     ORDER BY statement_date`,
    [userId]
  );
}

/** Same shape as {@link getUnmatchedStatementEntries}, scoped to a specific set of entries
 * (the review screen's just-accepted batch) rather than every outstanding entry for the user. */
export async function getStatementEntriesByIds(db: SqliteExecutor, entryIds: readonly string[]): Promise<UnmatchedStatementEntry[]> {
  if (entryIds.length === 0) return [];
  const placeholders = entryIds.map(() => '?').join(', ');
  return db.getAllAsync<UnmatchedStatementEntry>(
    `SELECT entry_id AS entryId, statement_date AS statementDate, description, amount AS amountMinorUnits,
            currency, matched_trxn_id AS matchedTrxnId, match_confidence AS matchConfidence,
            match_status AS matchStatus
     FROM statement_entries
     WHERE entry_id IN (${placeholders}) AND deleted_at IS NULL
     ORDER BY statement_date`,
    entryIds
  );
}

/** Looks up transactions by id, for displaying what a suggested match actually is. */
export async function getTransactionsByIds(
  db: SqliteExecutor,
  trxnIds: readonly string[]
): Promise<ReconciliationCandidateTransaction[]> {
  if (trxnIds.length === 0) return [];
  const placeholders = trxnIds.map(() => '?').join(', ');
  return db.getAllAsync<ReconciliationCandidateTransaction>(
    `SELECT trxn_id AS trxnId, trxn_date AS trxnDate, description, total_amount AS totalAmount
     FROM transaction_header WHERE trxn_id IN (${placeholders}) AND deleted_at IS NULL`,
    trxnIds
  );
}

/** Transactions this user paid for, in the given currency, not yet linked to a statement entry. */
export async function getUnreconciledTransactions(
  db: SqliteExecutor,
  userId: string,
  currency: string
): Promise<ReconciliationCandidateTransaction[]> {
  return db.getAllAsync<ReconciliationCandidateTransaction>(
    `SELECT trxn_id AS trxnId, trxn_date AS trxnDate, description, total_amount AS totalAmount
     FROM transaction_header
     WHERE payer_user_id = ? AND currency = ? AND reconciled_entry_id IS NULL AND deleted_at IS NULL`,
    [userId, currency]
  );
}

/**
 * Scores every unmatched debit entry against candidate transactions and records the best
 * candidate as a SUGGESTED match — never CONFIRMED automatically, whether the match is a
 * clean single hit or a tie between equally-scored candidates (Phase 6 Verify: an ambiguous
 * pair must surface as SUGGESTED for the user, not get linked on its own).
 */
export async function computeMatchSuggestions(db: SqliteExecutor, userId: string, currency: string): Promise<void> {
  const entries = await getUnmatchedStatementEntries(db, userId);
  const debitEntries = entries.filter((e) => e.currency === currency && e.amountMinorUnits < 0);
  if (debitEntries.length === 0) return;

  const transactions = await getUnreconciledTransactions(db, userId, currency);

  const statementLines: StatementLine[] = debitEntries.map((e) => ({
    id: e.entryId,
    amountMinorUnits: -e.amountMinorUnits,
    date: e.statementDate,
  }));
  const receipts: Receipt[] = transactions.map((t) => ({
    id: t.trxnId,
    amountMinorUnits: t.totalAmount,
    date: t.trxnDate,
  }));

  const candidates: MatchCandidate[] = matchCandidates(statementLines, receipts);
  const bestByEntry = new Map<string, MatchCandidate>();
  for (const candidate of candidates) {
    if (!bestByEntry.has(candidate.statementLineId)) {
      bestByEntry.set(candidate.statementLineId, candidate);
    }
  }

  for (const [entryId, candidate] of bestByEntry) {
    await db.runAsync(
      `UPDATE statement_entries
       SET matched_trxn_id = ?, match_confidence = ?, match_status = 'SUGGESTED', updated_at = datetime('now')
       WHERE entry_id = ?`,
      [candidate.receiptId, Math.round(candidate.score * 100), entryId]
    );
  }
}

/** User-confirmed link: the only path that sets match_status = 'CONFIRMED'. */
export async function confirmMatch(db: SqliteExecutor, entryId: string, trxnId: string): Promise<void> {
  await db.runAsync(
    `UPDATE statement_entries
     SET matched_trxn_id = ?, match_status = 'CONFIRMED', updated_at = datetime('now')
     WHERE entry_id = ?`,
    [trxnId, entryId]
  );
  await db.runAsync(
    `UPDATE transaction_header SET reconciled_entry_id = ?, updated_at = datetime('now') WHERE trxn_id = ?`,
    [entryId, trxnId]
  );
}

export async function ignoreMatch(db: SqliteExecutor, entryId: string): Promise<void> {
  await db.runAsync(
    `UPDATE statement_entries SET match_status = 'IGNORED', updated_at = datetime('now') WHERE entry_id = ?`,
    [entryId]
  );
}
