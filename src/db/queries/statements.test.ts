import { describe, expect, it, beforeEach } from 'vitest';
import { SqliteExecutor, runMigrations } from '../migrations/runner';
import { migrations } from '../migrations';
import { createNodeSqliteExecutor } from '../testing/nodeSqliteExecutor';
import { StatementDraftEntry } from '../../parse/statement';
import {
  acceptStatementEntries,
  createStatementArtifact,
  findArtifactByFileHash,
  getUserDefaultCurrency,
  rejectArtifact,
} from './statements';

let db: SqliteExecutor;
const device = 'dev_test';
const userId = 'usr_self';

beforeEach(async () => {
  db = createNodeSqliteExecutor();
  await runMigrations(db, migrations);
  await db.runAsync(`INSERT INTO devices (device_id, device_name, public_key, is_self) VALUES (?, 'Test device', x'00', 1)`, [device]);
  await db.runAsync(
    `INSERT INTO users (user_id, username, default_currency, is_self, created_by_device_id) VALUES (?, 'self', 'EUR', 1, ?)`,
    [userId, device]
  );
});

const draftEntry = (overrides: Partial<StatementDraftEntry> = {}): StatementDraftEntry => ({
  date: '2026-01-10',
  description: 'Coffee shop',
  amountMinorUnits: -350,
  balanceAfterMinorUnits: 9650,
  signResolved: true,
  ...overrides,
});

describe('createStatementArtifact / rejectArtifact / findArtifactByFileHash', () => {
  it('creates a PENDING artifact findable by its file hash', async () => {
    const artifactId = await createStatementArtifact(db, {
      fileUri: 'file:///statement.pdf',
      fileHash: 'hash-1',
      rawText: 'raw',
      parsedJson: '{}',
    });

    const found = await findArtifactByFileHash(db, 'hash-1');
    expect(found?.artifactId).toBe(artifactId);
  });

  it('rejecting an artifact marks it REJECTED', async () => {
    const artifactId = await createStatementArtifact(db, {
      fileUri: 'file:///statement.pdf',
      fileHash: 'hash-2',
      rawText: 'raw',
      parsedJson: '{}',
    });

    await rejectArtifact(db, artifactId);

    const [row] = await db.getAllAsync<{ review_status: string }>(
      `SELECT review_status FROM ocr_artifacts WHERE artifact_id = ?`,
      [artifactId]
    );
    expect(row.review_status).toBe('REJECTED');
  });
});

describe('acceptStatementEntries', () => {
  it('writes rows into statement_entries and marks the artifact ACCEPTED', async () => {
    const artifactId = await createStatementArtifact(db, {
      fileUri: 'file:///statement.pdf',
      fileHash: 'hash-3',
      rawText: 'raw',
      parsedJson: '{}',
    });

    const entryIds = await acceptStatementEntries(db, {
      artifactId,
      userId,
      currency: 'EUR',
      sourceFileReference: 'statement.pdf',
      entries: [draftEntry()],
    });

    expect(entryIds).toHaveLength(1);

    const rows = await db.getAllAsync<{ description: string; amount: number }>(
      `SELECT description, amount FROM statement_entries WHERE user_id = ?`,
      [userId]
    );
    expect(rows).toEqual([{ description: 'Coffee shop', amount: -350 }]);

    const [artifact] = await db.getAllAsync<{ review_status: string }>(
      `SELECT review_status FROM ocr_artifacts WHERE artifact_id = ?`,
      [artifactId]
    );
    expect(artifact.review_status).toBe('ACCEPTED');
  });

  it('re-importing the same statement is idempotent: no duplicate rows', async () => {
    const artifactId = await createStatementArtifact(db, {
      fileUri: 'file:///statement.pdf',
      fileHash: 'hash-4',
      rawText: 'raw',
      parsedJson: '{}',
    });
    const params = {
      artifactId,
      userId,
      currency: 'EUR',
      sourceFileReference: 'statement.pdf',
      entries: [draftEntry(), draftEntry({ date: '2026-01-11', description: 'Groceries', amountMinorUnits: -1200, balanceAfterMinorUnits: 8450 })],
    };

    const firstIds = await acceptStatementEntries(db, params);
    const secondIds = await acceptStatementEntries(db, params);

    expect(secondIds).toEqual(firstIds);

    const [{ count }] = await db.getAllAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM statement_entries WHERE user_id = ?`,
      [userId]
    );
    expect(count).toBe(2);
  });
});

describe('getUserDefaultCurrency', () => {
  it('returns the user default currency', async () => {
    expect(await getUserDefaultCurrency(db, userId)).toBe('EUR');
  });

  it('falls back to INR for an unknown user', async () => {
    expect(await getUserDefaultCurrency(db, 'usr_missing')).toBe('INR');
  });
});
