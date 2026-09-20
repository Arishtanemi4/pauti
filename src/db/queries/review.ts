import { SqliteExecutor } from '../migrations/runner';

// Data for the OCR/import review gate (docs/plan/EXECUTE.md §5.6): every artifact reaches
// this screen before anything it contains can enter the ledger.

export interface OcrArtifact {
  readonly artifactId: string;
  readonly kind: 'RECEIPT' | 'STATEMENT';
  readonly fileUri: string;
  readonly rawText: string | null;
  readonly parsedJson: string | null;
  readonly reviewStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  readonly trxnId: string | null;
}

export async function getOcrArtifact(db: SqliteExecutor, artifactId: string): Promise<OcrArtifact | undefined> {
  const [row] = await db.getAllAsync<OcrArtifact>(
    `SELECT artifact_id AS artifactId, kind, file_uri AS fileUri, raw_text AS rawText,
            parsed_json AS parsedJson, review_status AS reviewStatus, trxn_id AS trxnId
     FROM ocr_artifacts WHERE artifact_id = ? AND deleted_at IS NULL`,
    [artifactId]
  );
  return row;
}

export async function getPendingArtifacts(db: SqliteExecutor): Promise<OcrArtifact[]> {
  return db.getAllAsync<OcrArtifact>(
    `SELECT artifact_id AS artifactId, kind, file_uri AS fileUri, raw_text AS rawText,
            parsed_json AS parsedJson, review_status AS reviewStatus, trxn_id AS trxnId
     FROM ocr_artifacts WHERE review_status = 'PENDING' AND deleted_at IS NULL
     ORDER BY created_at`
  );
}
