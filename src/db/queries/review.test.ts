import { describe, expect, it, beforeEach } from 'vitest';
import { SqliteExecutor, runMigrations } from '../migrations/runner';
import { migrations } from '../migrations';
import { createNodeSqliteExecutor } from '../testing/nodeSqliteExecutor';
import { getOcrArtifact, getPendingArtifacts } from './review';

let db: SqliteExecutor;

beforeEach(async () => {
  db = createNodeSqliteExecutor();
  await runMigrations(db, migrations);
});

it('getOcrArtifact returns undefined when the artifact does not exist', async () => {
  expect(await getOcrArtifact(db, 'ocr_does_not_exist')).toBeUndefined();
});

it('getPendingArtifacts returns an empty list on a fresh database', async () => {
  expect(await getPendingArtifacts(db)).toEqual([]);
});
