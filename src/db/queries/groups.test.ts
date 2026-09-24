import { describe, expect, it, beforeEach } from 'vitest';
import { SqliteExecutor, runMigrations } from '../migrations/runner';
import { migrations } from '../migrations';
import { createNodeSqliteExecutor } from '../testing/nodeSqliteExecutor';
import { seedFixtures, FIXTURE_IDS } from '../fixtures';
import { netBalances, simplifyDebts } from '../../core/balance';
import { createGroupSkeleton, getGroupBalances, getGroupDetail, getGroupList, getGroupMembers } from './groups';

let db: SqliteExecutor;

beforeEach(async () => {
  db = createNodeSqliteExecutor();
  await runMigrations(db, migrations);
  await seedFixtures(db);
});

describe('getGroupBalances', () => {
  it('matches src/core/balance netted from the same group-scoped outstanding splits, for every group', async () => {
    for (const groupId of Object.values(FIXTURE_IDS.groups)) {
      const outstanding = await db.getAllAsync<{
        creditor_id: string;
        debtor_id: string;
        currency: string;
        outstanding_amount: number;
      }>(`SELECT creditor_id, debtor_id, currency, outstanding_amount FROM v_split_outstanding WHERE group_id = ?`, [
        groupId,
      ]);

      const byCurrency = new Map<string, { from: string; to: string; amountMinorUnits: number }[]>();
      for (const row of outstanding) {
        const list = byCurrency.get(row.currency) ?? [];
        list.push({ from: row.debtor_id, to: row.creditor_id, amountMinorUnits: row.outstanding_amount });
        byCurrency.set(row.currency, list);
      }

      const actual = await getGroupBalances(db, groupId);

      for (const [currency, debts] of byCurrency) {
        const expected = netBalances(debts);
        const actualForCurrency = actual.find((a) => a.currency === currency);
        for (const [userId, amount] of Object.entries(expected)) {
          expect(actualForCurrency?.memberNet[userId] ?? 0).toBe(amount);
        }
      }
    }
  });

  it('the three-person group nets to the hand-computed balances (alice -3000, bob +5000, carol -2000)', async () => {
    const balances = await getGroupBalances(db, FIXTURE_IDS.groups.trio);
    const inr = balances.find((b) => b.currency === 'INR');
    expect(inr?.memberNet).toEqual({
      [FIXTURE_IDS.users.alice]: -3000,
      [FIXTURE_IDS.users.bob]: 5000,
      [FIXTURE_IDS.users.carol]: -2000,
    });
  });

  it('simplifyDebts on a group balance settles every member to zero', async () => {
    const balances = await getGroupBalances(db, FIXTURE_IDS.groups.trio);
    const inr = balances.find((b) => b.currency === 'INR')!;

    const settlements = simplifyDebts(inr.memberNet);
    const net = { ...inr.memberNet };
    for (const s of settlements) {
      net[s.from] += s.amountMinorUnits;
      net[s.to] -= s.amountMinorUnits;
    }
    for (const amount of Object.values(net)) {
      expect(amount).toBe(0);
    }
  });

  it('the pair group with a multi-currency expense returns one entry per currency', async () => {
    const balances = await getGroupBalances(db, FIXTURE_IDS.groups.pairAC);
    expect(balances.map((b) => b.currency).sort()).toEqual(['INR', 'USD']);
  });
});

describe('getGroupList', () => {
  it("lists every group Alice belongs to, with her net position", async () => {
    const list = await getGroupList(db, FIXTURE_IDS.users.alice);
    expect(list.map((g) => g.groupId).sort()).toEqual(
      [FIXTURE_IDS.groups.trio, FIXTURE_IDS.groups.pairAB, FIXTURE_IDS.groups.pairAC].sort()
    );

    const pairAB = list.find((g) => g.groupId === FIXTURE_IDS.groups.pairAB);
    expect(pairAB?.isPair).toBe(true);
    expect(pairAB?.netPosition).toEqual([{ currency: 'INR', amountMinorUnits: 650 }]);
  });
});

describe('getGroupMembers', () => {
  it('returns every member of the three-person group', async () => {
    const members = await getGroupMembers(db, FIXTURE_IDS.groups.trio);
    expect(members.map((m) => m.userId).sort()).toEqual(Object.values(FIXTURE_IDS.users).sort());
  });
});

describe('getGroupDetail', () => {
  it('returns the fields a group invite QR needs', async () => {
    const detail = await getGroupDetail(db, FIXTURE_IDS.groups.pairAB);
    expect(detail).toEqual({
      groupId: FIXTURE_IDS.groups.pairAB,
      groupName: expect.any(String),
      crdtDocId: expect.any(String),
      defaultCurrency: expect.any(String),
      isPair: true,
    });
  });

  it('returns null for an unknown group', async () => {
    expect(await getGroupDetail(db, 'grp_nope')).toBeNull();
  });
});

describe('createGroupSkeleton', () => {
  const invite = {
    groupId: 'grp_invited',
    crdtDocId: 'crdt_grp_invited',
    groupName: 'Trip to Goa',
    defaultCurrency: 'INR',
    isPair: false,
    createdByDeviceId: 'dev_fixture',
  };

  it('creates crdt_docs and groups rows for a never-before-seen invite', async () => {
    await createGroupSkeleton(db, invite);

    const [doc] = await db.getAllAsync<{ scope: string }>(`SELECT scope FROM crdt_docs WHERE crdt_doc_id = ?`, [
      invite.crdtDocId,
    ]);
    expect(doc.scope).toBe('GROUP');

    const [group] = await db.getAllAsync<{ group_name: string; crdt_doc_id: string }>(
      `SELECT group_name, crdt_doc_id FROM groups WHERE group_id = ?`,
      [invite.groupId]
    );
    expect(group).toEqual({ group_name: 'Trip to Goa', crdt_doc_id: invite.crdtDocId });
  });

  it('is idempotent — accepting the same invite twice does not error or duplicate rows', async () => {
    await createGroupSkeleton(db, invite);
    await createGroupSkeleton(db, invite);

    const groups = await db.getAllAsync(`SELECT * FROM groups WHERE group_id = ?`, [invite.groupId]);
    expect(groups).toHaveLength(1);
  });
});
