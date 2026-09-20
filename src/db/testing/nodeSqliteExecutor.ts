// Wraps Node's built-in node:sqlite (Node 22.5+) so tests can exercise real SQL against a
// real SQLite engine without installing a dependency — there's no JS-only SQLite driver
// that runs both here and on-device, and expo-sqlite itself only runs under Hermes/RN, not
// plain Node. Test-only: the app itself always talks to expo-sqlite via this same
// SqliteExecutor interface.

import { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { SqliteExecutor } from '../migrations/runner';

export function createNodeSqliteExecutor(): SqliteExecutor {
  const db = new DatabaseSync(':memory:');

  return {
    async execAsync(sql) {
      db.exec(sql);
    },
    async getAllAsync(sql, params = []) {
      return db.prepare(sql).all(...(params as SQLInputValue[])) as never;
    },
    async runAsync(sql, params = []) {
      return db.prepare(sql).run(...(params as SQLInputValue[]));
    },
  };
}
