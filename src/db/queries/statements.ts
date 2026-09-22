import { SqliteExecutor } from '../migrations/runner';
import { newId } from '../../core/id';
import { fnv1a } from '../../core/hash';
import { StatementDraftEntry } from '../../parse/statement';

// Statement import review gate (docs/plan/EXECUTE.md §5.6, task 6.5). ocr_artifacts and
// statement_entries are private, local-only tables (never synced), so — unlike
// transaction_header — these are written directly here rather than via src/crdt/write.ts.

export async function createStatementArtifact(
  db: SqliteExecutor,
  params: { fileUri: string; fileHash: string; rawText: string; parsedJson: string }
): Promise<string> {
  const artifactId = newId('ocr');
  await db.runAsync(
    `INSERT INTO ocr_artifacts (artifact_id, kind, file_uri, file_hash, raw_text, parsed_json)
     VALUES (?, 'STATEMENT', ?, ?, ?, ?)`,
    [artifactId, params.fileUri, params.fileHash, params.rawText, params.parsedJson]
  );
  return artifactId;
}

export async function rejectArtifact(db: SqliteExecutor, artifactId: string): Promise<void> {
  await db.runAsync(
    `UPDATE ocr_artifacts SET review_status = 'REJECTED', updated_at = datetime('now') WHERE artifact_id = ?`,
    [artifactId]
  );
}

/**
 * Writes reviewed draft entries into statement_entries and marks the artifact ACCEPTED.
 * source_row_hash is derived from the row's own fields plus the source file, so re-importing
 * an overlapping statement resolves to the same hash and the UNIQUE(user_id, source_row_hash)
 * constraint silently skips the duplicate (INSERT OR IGNORE) — no duplicate rows, no error.
 */
/** Returns the entry_id of every reviewed row, whether newly inserted or already present from
 * an earlier import of an overlapping statement — the caller uses these to look up match
 * suggestions for exactly this batch. */
export async function acceptStatementEntries(
  db: SqliteExecutor,
  params: {
    artifactId: string;
    userId: string;
    currency: string;
    sourceFileReference: string;
    entries: readonly StatementDraftEntry[];
  }
): Promise<string[]> {
  const entryIds: string[] = [];
  for (const entry of params.entries) {
    const rowHash = fnv1a(
      `${entry.date}|${entry.description}|${entry.amountMinorUnits}|${entry.balanceAfterMinorUnits}|${params.sourceFileReference}`
    );
    await db.runAsync(
      `INSERT INTO statement_entries
         (entry_id, user_id, statement_date, description, amount, currency, balance_after,
          source_file_reference, source_row_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, source_row_hash) DO NOTHING`,
      [
        newId('stm'),
        params.userId,
        entry.date,
        entry.description,
        entry.amountMinorUnits,
        params.currency,
        entry.balanceAfterMinorUnits,
        params.sourceFileReference,
        rowHash,
      ]
    );
    const [row] = await db.getAllAsync<{ entry_id: string }>(
      `SELECT entry_id FROM statement_entries WHERE user_id = ? AND source_row_hash = ?`,
      [params.userId, rowHash]
    );
    if (row) entryIds.push(row.entry_id);
  }

  await db.runAsync(
    `UPDATE ocr_artifacts SET review_status = 'ACCEPTED', updated_at = datetime('now') WHERE artifact_id = ?`,
    [params.artifactId]
  );

  return entryIds;
}

export async function getUserDefaultCurrency(db: SqliteExecutor, userId: string): Promise<string> {
  const [row] = await db.getAllAsync<{ default_currency: string }>(
    `SELECT default_currency FROM users WHERE user_id = ?`,
    [userId]
  );
  return row?.default_currency ?? 'INR';
}

export async function findArtifactByFileHash(db: SqliteExecutor, fileHash: string): Promise<{ artifactId: string } | undefined> {
  const [row] = await db.getAllAsync<{ artifactId: string }>(
    `SELECT artifact_id AS artifactId FROM ocr_artifacts WHERE file_hash = ? AND deleted_at IS NULL`,
    [fileHash]
  );
  return row;
}
