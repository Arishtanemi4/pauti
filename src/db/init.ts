import { Migration, SqliteExecutor, runMigrations } from './migrations/runner';
import { migrations } from './migrations';
import { seedFixtures } from './fixtures';

/**
 * Runs migrations, then — in development builds only, and only against an empty database —
 * seeds the Phase 2 fixture set. This is what lets Phase 4's screens have real data to
 * render before Phase 5 adds manual entry. Never runs in a production build (`__DEV__`).
 */
export async function initDatabase(db: SqliteExecutor, migrationList: readonly Migration[] = migrations): Promise<void> {
  await runMigrations(db, migrationList);

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    const [{ count }] = await db.getAllAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM transaction_header'
    );
    if (count === 0) {
      await seedFixtures(db);
    }
  }
}
