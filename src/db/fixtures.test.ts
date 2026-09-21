import { describe, expect, it } from 'vitest';
import { createNodeSqliteExecutor } from './testing/nodeSqliteExecutor';
import { runMigrations } from './migrations/runner';
import { migrations } from './migrations';
import { seedFixtures } from './fixtures';

describe('seedFixtures', () => {
  it('loads cleanly against a freshly migrated database', async () => {
    const db = createNodeSqliteExecutor();
    await runMigrations(db, migrations);
    await expect(seedFixtures(db)).resolves.toBeUndefined();

    const [{ count }] = await db.getAllAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM transaction_header'
    );
    expect(count).toBe(5);
  });
});
