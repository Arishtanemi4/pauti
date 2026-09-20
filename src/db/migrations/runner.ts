// Forward-only migration runner. Matches expo-sqlite's real async API shape (execAsync /
// getAllAsync / runAsync) so the same code runs against the on-device database and against
// any test double with the same surface — nothing here is Expo/React specific.

export interface SqliteExecutor {
  execAsync(sql: string): Promise<void>;
  getAllAsync<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  runAsync(sql: string, params?: readonly unknown[]): Promise<unknown>;
}

export interface Migration {
  readonly version: number;
  readonly sql: string;
}

async function currentVersion(db: SqliteExecutor): Promise<number> {
  try {
    const rows = await db.getAllAsync<{ version: number | null }>(
      'SELECT MAX(version) AS version FROM schema_migrations'
    );
    return rows[0]?.version ?? 0;
  } catch {
    // schema_migrations doesn't exist yet — this is an empty database. Migration 1 creates
    // it (it's the first statement in the verbatim schema), so there's nothing to bootstrap
    // here beyond treating "table missing" as "nothing applied yet".
    return 0;
  }
}

/** Applies every migration newer than the database's current version, in order. */
export async function runMigrations(db: SqliteExecutor, migrations: readonly Migration[]): Promise<void> {
  const applied = await currentVersion(db);
  const pending = [...migrations].filter((m) => m.version > applied).sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    await db.execAsync(migration.sql);
    await db.runAsync('INSERT INTO schema_migrations (version) VALUES (?)', [migration.version]);
  }
}
