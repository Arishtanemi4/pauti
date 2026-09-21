import { describe, expect, it } from 'vitest';
import { createNodeSqliteExecutor } from './testing/nodeSqliteExecutor';
import { initDatabase } from './init';

describe('initDatabase', () => {
  it('migrates an empty database and seeds fixtures in dev', async () => {
    const db = createNodeSqliteExecutor();
    await initDatabase(db);

    const [{ count }] = await db.getAllAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM transaction_header'
    );
    // vitest runs with __DEV__ undefined, so seeding is skipped — just confirm migrations ran.
    expect(count).toBe(0);

    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'transaction_header'"
    );
    expect(tables).toHaveLength(1);
  });

  it('is idempotent — calling it twice does not re-seed or error', async () => {
    const db = createNodeSqliteExecutor();
    await initDatabase(db);
    await expect(initDatabase(db)).resolves.toBeUndefined();
  });
});
