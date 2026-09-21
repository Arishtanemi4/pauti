import { describe, expect, it, beforeEach } from 'vitest';
import { SqliteExecutor, runMigrations } from '../migrations/runner';
import { migrations } from '../migrations';
import { createNodeSqliteExecutor } from '../testing/nodeSqliteExecutor';
import { seedFixtures, FIXTURE_IDS } from '../fixtures';
import { getSplitEditorData } from './split';

let db: SqliteExecutor;

beforeEach(async () => {
  db = createNodeSqliteExecutor();
  await runMigrations(db, migrations);
  await seedFixtures(db);
});

describe('getSplitEditorData', () => {
  it('returns the ITEMIZED receipt with its line and both line-scope and header-scope splits', async () => {
    const data = await getSplitEditorData(db, FIXTURE_IDS.trxns.t2);
    expect(data?.lines).toHaveLength(1);
    expect(data?.lines[0].productName).toBe('Wine');

    // 2 line-scope splits (1/3 + 2/3 of the wine) + 2 header-scope splits (the unitemized 100).
    expect(data?.splits).toHaveLength(4);
    const lineScope = data?.splits.filter((s) => s.lineId !== null) ?? [];
    expect(lineScope.map((s) => s.owedAmountMinorUnits).sort((a, b) => a - b)).toEqual([300, 600]);
  });

  it('returns undefined for an unknown transaction', async () => {
    expect(await getSplitEditorData(db, 'trx_does_not_exist')).toBeUndefined();
  });
});
