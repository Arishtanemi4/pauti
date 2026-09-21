// The only file that may import expo-sqlite (§2: platform APIs are confined to
// src/platform/). Opens the on-device database and exposes it through the same
// SqliteExecutor interface src/db/migrations/runner.ts and src/db/queries/* already speak —
// expo-sqlite's execAsync/getAllAsync/runAsync methods match that interface exactly, so no
// translation layer is needed, just this one import boundary.

import * as SQLite from 'expo-sqlite';
import { SqliteExecutor } from '../db/migrations/runner';

export async function openDatabase(name = 'pauti.db'): Promise<SqliteExecutor> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync('PRAGMA foreign_keys = ON;');

  return {
    execAsync: (sql) => db.execAsync(sql),
    getAllAsync: (sql, params = []) => db.getAllAsync(sql, params as SQLite.SQLiteBindParams),
    runAsync: (sql, params = []) => db.runAsync(sql, params as SQLite.SQLiteBindParams),
  };
}
