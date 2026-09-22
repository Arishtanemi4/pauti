import { describe, expect, it, beforeEach } from 'vitest';
import { SqliteExecutor, runMigrations } from '../migrations/runner';
import { migrations } from '../migrations';
import { createNodeSqliteExecutor } from '../testing/nodeSqliteExecutor';
import { seedFixtures, FIXTURE_IDS } from '../fixtures';
import { getOutstandingSplits } from './settle';

let db: SqliteExecutor;

beforeEach(async () => {
  db = createNodeSqliteExecutor();
  await runMigrations(db, migrations);
  await seedFixtures(db);
});

describe('getOutstandingSplits', () => {
  it('finds what alice owes bob (T1, split 3000 each in the trio group)', async () => {
    const rows = await getOutstandingSplits(db, FIXTURE_IDS.users.alice, FIXTURE_IDS.users.bob, 'INR');
    expect(rows).toEqual([
      {
        scopeKey: FIXTURE_IDS.trxns.t1,
        groupId: FIXTURE_IDS.groups.trio,
        crdtDocId: `crdt_${FIXTURE_IDS.groups.trio}`,
        outstandingAmountMinorUnits: 3000,
      },
    ]);
  });

  it('spans multiple groups when no groupId is given, oldest transaction date first', async () => {
    // T3 (trio, 2026-01-12) and T4b (pairAC, 2026-01-14) both owed alice -> carol, but were
    // fully settled by the fixture's cross-group settlement — nothing outstanding remains.
    const rows = await getOutstandingSplits(db, FIXTURE_IDS.users.alice, FIXTURE_IDS.users.carol, 'INR');
    expect(rows).toEqual([]);
  });

  it('scopes to a single group when groupId is given', async () => {
    const rows = await getOutstandingSplits(
      db,
      FIXTURE_IDS.users.alice,
      FIXTURE_IDS.users.bob,
      'INR',
      FIXTURE_IDS.groups.pairAB
    );
    // Alice owes bob nothing directly in pairAB — T2's splits are Alice/Bob debts to
    // themselves as payer, not to each other in that direction.
    expect(rows).toEqual([]);
  });

});
