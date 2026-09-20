import { describe, expect, it } from 'vitest';
import { createNodeSqliteExecutor } from '../testing/nodeSqliteExecutor';
import { runMigrations } from './runner';
import { migrations } from './index';

describe('runMigrations', () => {
  it('applies cleanly from an empty database', async () => {
    const db = createNodeSqliteExecutor();
    await expect(runMigrations(db, migrations)).resolves.toBeUndefined();

    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    expect(tables.map((t) => t.name)).toContain('transaction_header');
    expect(tables.map((t) => t.name)).toContain('expense_splits');
  });

  it('records the applied version in schema_migrations', async () => {
    const db = createNodeSqliteExecutor();
    await runMigrations(db, migrations);

    const rows = await db.getAllAsync<{ version: number }>('SELECT version FROM schema_migrations');
    expect(rows).toEqual([{ version: 1 }]);
  });

  it('is idempotent — running again applies nothing new', async () => {
    const db = createNodeSqliteExecutor();
    await runMigrations(db, migrations);
    await expect(runMigrations(db, migrations)).resolves.toBeUndefined();

    const rows = await db.getAllAsync<{ version: number }>('SELECT version FROM schema_migrations');
    expect(rows).toEqual([{ version: 1 }]);
  });
});
