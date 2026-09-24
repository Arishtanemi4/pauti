import { SqliteExecutor } from '../migrations/runner';
import { newId } from '../../core/id';

// Receipt OCR review gate (docs/plan/EXECUTE.md §5.6, Phase 7 task 7.2). ocr_artifacts is a
// private, local-only table (see src/db/queries/statements.ts) written directly here; the
// transaction it produces is written separately via src/crdt/write.ts (docs/ocr/OCR.md §2).

export async function createReceiptArtifact(
  db: SqliteExecutor,
  params: { fileUri: string; fileHash: string; rawText: string; parsedJson: string }
): Promise<string> {
  const artifactId = newId('ocr');
  await db.runAsync(
    `INSERT INTO ocr_artifacts (artifact_id, kind, file_uri, file_hash, raw_text, parsed_json)
     VALUES (?, 'RECEIPT', ?, ?, ?, ?)`,
    [artifactId, params.fileUri, params.fileHash, params.rawText, params.parsedJson]
  );
  return artifactId;
}

/** Links the reviewed artifact to the transaction created from it and marks it ACCEPTED. */
export async function acceptReceiptArtifact(db: SqliteExecutor, artifactId: string, trxnId: string): Promise<void> {
  await db.runAsync(
    `UPDATE ocr_artifacts SET review_status = 'ACCEPTED', trxn_id = ?, updated_at = datetime('now') WHERE artifact_id = ?`,
    [trxnId, artifactId]
  );
}
