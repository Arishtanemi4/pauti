import { describe, expect, it, beforeEach } from 'vitest';
import { SqliteExecutor, runMigrations } from '../db/migrations/runner';
import { migrations } from '../db/migrations';
import { createNodeSqliteExecutor } from '../db/testing/nodeSqliteExecutor';
import { seedFixtures, FIXTURE_IDS } from '../db/fixtures';
import { recordSettlement } from './settle';

const DEVICE_ID = 'dev_fixture';

let db: SqliteExecutor;

beforeEach(async () => {
  db = createNodeSqliteExecutor();
  await runMigrations(db, migrations);
  await seedFixtures(db);
});

describe('recordSettlement', () => {
  it('settles what bob owes alice in a single group and clears the outstanding balance', async () => {
    await recordSettlement(db, DEVICE_ID, FIXTURE_IDS.users.bob, FIXTURE_IDS.users.alice, 650, 'INR');

    const outstanding = await db.getAllAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM v_split_outstanding
       WHERE debtor_id = ? AND creditor_id = ? AND currency = 'INR' AND outstanding_amount > 0`,
      [FIXTURE_IDS.users.bob, FIXTURE_IDS.users.alice]
    );
    expect(outstanding[0].n).toBe(0);

    const settlements = await db.getAllAsync<{ amount: number }>(
      `SELECT amount FROM settlements WHERE from_user_id = ? AND to_user_id = ?`,
      [FIXTURE_IDS.users.bob, FIXTURE_IDS.users.alice]
    );
    expect(settlements).toEqual([{ amount: 650 }]);
  });

  it('throws when there is nothing outstanding for that pair/currency', async () => {
    // Carol never owes Alice anything in INR (T5 is the only carol->alice debt, and it's USD).
    await expect(
      recordSettlement(db, DEVICE_ID, FIXTURE_IDS.users.carol, FIXTURE_IDS.users.alice, 100, 'INR')
    ).rejects.toThrow('Nothing outstanding to settle');
  });

  it('scoped to a group still writes to that group even when other groups also have outstanding balances', async () => {
    // Alice owes bob 3000 in the trio group (T1); settling scoped to pairAB must not touch it.
    await expect(
      recordSettlement(db, DEVICE_ID, FIXTURE_IDS.users.alice, FIXTURE_IDS.users.bob, 100, 'INR', FIXTURE_IDS.groups.pairAB)
    ).rejects.toThrow('Nothing outstanding to settle');

    const trioOutstanding = await db.getAllAsync<{ outstanding_amount: number }>(
      `SELECT outstanding_amount FROM v_split_outstanding
       WHERE debtor_id = ? AND creditor_id = ? AND group_id = ?`,
      [FIXTURE_IDS.users.alice, FIXTURE_IDS.users.bob, FIXTURE_IDS.groups.trio]
    );
    expect(trioOutstanding).toEqual([{ outstanding_amount: 3000 }]);
  });
});
