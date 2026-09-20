import { describe, expect, it, beforeEach } from 'vitest';
import { SqliteExecutor, runMigrations } from '../migrations/runner';
import { migrations } from '../migrations';
import { createNodeSqliteExecutor } from '../testing/nodeSqliteExecutor';
import { seedFixtures, FIXTURE_IDS } from '../testing/fixtures';
import { getGroupOptions, getStoreOptions } from './add';

let db: SqliteExecutor;

beforeEach(async () => {
  db = createNodeSqliteExecutor();
  await runMigrations(db, migrations);
  await seedFixtures(db);
});

it('getGroupOptions lists every group Alice belongs to', async () => {
  const options = await getGroupOptions(db, FIXTURE_IDS.users.alice);
  expect(options).toHaveLength(3);
});

it('getStoreOptions lists the seeded store', async () => {
  const options = await getStoreOptions(db);
  expect(options.map((s) => s.storeName)).toEqual(['Corner Shop']);
});
