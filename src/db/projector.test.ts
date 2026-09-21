import { describe, expect, it, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { SqliteExecutor, runMigrations } from './migrations/runner';
import { migrations } from './migrations';
import { createNodeSqliteExecutor } from './testing/nodeSqliteExecutor';
import { createGroupDoc, TransactionHeader } from '../crdt/doc';
import { appendSettlement, createTransaction, setSplitSet } from '../crdt/write';
import { projectGroupDoc, rebuildFromLog, runProjector } from './projector';

const GROUP_ID = 'grp_trio';
const CRDT_DOC_ID = 'crdt_grp_trio';

async function seedGroupRow(db: SqliteExecutor): Promise<void> {
  await db.runAsync(`INSERT INTO crdt_docs (crdt_doc_id, scope) VALUES (?, 'GROUP')`, [CRDT_DOC_ID]);
  await db.runAsync(
    `INSERT INTO groups (group_id, group_name, is_pair, default_currency, crdt_doc_id, created_by_device_id)
     VALUES (?, 'Trio', 0, 'INR', ?, 'dev_bootstrap')`,
    [GROUP_ID, CRDT_DOC_ID]
  );
  for (const userId of ['usr_alice', 'usr_bob', 'usr_carol']) {
    await db.runAsync(`INSERT INTO users (user_id, username, created_by_device_id) VALUES (?, ?, 'dev_bootstrap')`, [
      userId,
      userId,
    ]);
  }
}

/** Records the doc's full state as one crdt_updates row — equivalent for replay purposes to
 * logging every intermediate operation individually, since Yjs updates are idempotent. */
async function pushDocUpdate(db: SqliteExecutor, doc: Y.Doc, originDeviceId: string): Promise<void> {
  const payload = Y.encodeStateAsUpdate(doc);
  await db.runAsync(
    `INSERT INTO crdt_updates (crdt_doc_id, payload, origin_device_id) VALUES (?, ?, ?)`,
    [CRDT_DOC_ID, payload, originDeviceId]
  );
}

function makeHeader(overrides: Partial<TransactionHeader> = {}): TransactionHeader {
  return {
    trxnId: 'trx_1',
    groupId: GROUP_ID,
    payerUserId: 'usr_alice',
    ownerDeviceId: 'dev_alice',
    storeId: null,
    paymentModeId: null,
    trxnDate: '2026-01-05',
    description: null,
    totalAmount: 9000,
    currency: 'INR',
    detailLevel: 'HEADER_ONLY',
    sourceType: 'MANUAL',
    createdAt: '2026-01-05',
    updatedAt: '2026-01-05',
    deletedAt: null,
    ...overrides,
  };
}

let db: SqliteExecutor;

beforeEach(async () => {
  db = createNodeSqliteExecutor();
  await runMigrations(db, migrations);
  await seedGroupRow(db);
});

describe('projectGroupDoc', () => {
  it('projects a transaction and its split into transaction_header and expense_splits', async () => {
    const doc = createGroupDoc();
    createTransaction(doc, 'dev_alice', makeHeader());
    setSplitSet(doc, 'dev_alice', {
      scopeKey: 'trx_1',
      trxnId: 'trx_1',
      lineId: null,
      shares: [
        { debtorId: 'usr_alice', owedAmount: 3000, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
        { debtorId: 'usr_bob', owedAmount: 3000, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
        { debtorId: 'usr_carol', owedAmount: 3000, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
      ],
      updatedAt: '2026-01-05',
      updatedByDeviceId: 'dev_alice',
    });

    await projectGroupDoc(db, GROUP_ID, doc);

    const [header] = await db.getAllAsync<{ total_amount: number }>(
      `SELECT total_amount FROM transaction_header WHERE trxn_id = 'trx_1'`
    );
    expect(header.total_amount).toBe(9000);

    const splits = await db.getAllAsync<{ owed_amount: number }>(
      `SELECT owed_amount FROM expense_splits WHERE scope_key = 'trx_1'`
    );
    expect(splits.reduce((sum, s) => sum + s.owed_amount, 0)).toBe(9000);
  });

  it('a re-split (new splitSet for the same scope) fully replaces the old rows — sums to the total, never a blend', async () => {
    const doc = createGroupDoc();
    createTransaction(doc, 'dev_alice', makeHeader({ totalAmount: 9000 }));
    setSplitSet(doc, 'dev_alice', {
      scopeKey: 'trx_1',
      trxnId: 'trx_1',
      lineId: null,
      shares: [
        { debtorId: 'usr_alice', owedAmount: 4500, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
        { debtorId: 'usr_bob', owedAmount: 4500, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
      ],
      updatedAt: '2026-01-05T10:00:00Z',
      updatedByDeviceId: 'dev_alice',
    });
    await projectGroupDoc(db, GROUP_ID, doc);

    // Re-split to three people.
    setSplitSet(doc, 'dev_alice', {
      scopeKey: 'trx_1',
      trxnId: 'trx_1',
      lineId: null,
      shares: [
        { debtorId: 'usr_alice', owedAmount: 3000, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
        { debtorId: 'usr_bob', owedAmount: 3000, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
        { debtorId: 'usr_carol', owedAmount: 3000, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
      ],
      updatedAt: '2026-01-05T10:00:01Z',
      updatedByDeviceId: 'dev_alice',
    });
    await projectGroupDoc(db, GROUP_ID, doc);

    const splits = await db.getAllAsync<{ debtor_id: string; owed_amount: number }>(
      `SELECT debtor_id, owed_amount FROM expense_splits WHERE scope_key = 'trx_1'`
    );
    expect(splits).toHaveLength(3); // old two-way split's rows are gone, not left behind
    expect(splits.reduce((sum, s) => sum + s.owed_amount, 0)).toBe(9000);
  });
});

describe('three-device convergence', () => {
  it('concurrent edits applied in different orders on each device converge to byte-identical SQLite state', async () => {
    // Three devices' independent copies of the same group doc.
    const deviceA = createGroupDoc(); // alice's device — owns trx_1
    const deviceB = createGroupDoc(); // bob's device
    const deviceC = createGroupDoc(); // carol's device

    createTransaction(deviceA, 'dev_alice', makeHeader());
    setSplitSet(deviceA, 'dev_alice', {
      scopeKey: 'trx_1',
      trxnId: 'trx_1',
      lineId: null,
      shares: [
        { debtorId: 'usr_alice', owedAmount: 3000, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
        { debtorId: 'usr_bob', owedAmount: 3000, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
        { debtorId: 'usr_carol', owedAmount: 3000, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
      ],
      updatedAt: '2026-01-05',
      updatedByDeviceId: 'dev_alice',
    });
    const updateA = Y.encodeStateAsUpdate(deviceA);

    appendSettlement(deviceB, {
      settlementId: 'stl_1',
      fromUserId: 'usr_bob',
      toUserId: 'usr_alice',
      amount: 3000,
      currency: 'INR',
      settledAt: '2026-01-06',
      method: 'cash',
      note: null,
      allocations: [{ scopeKey: 'trx_1', amount: 3000, currency: 'INR' }],
      createdByDeviceId: 'dev_bob',
      createdAt: '2026-01-06',
    });
    const updateB = Y.encodeStateAsUpdate(deviceB);

    appendSettlement(deviceC, {
      settlementId: 'stl_2',
      fromUserId: 'usr_carol',
      toUserId: 'usr_alice',
      amount: 3000,
      currency: 'INR',
      settledAt: '2026-01-07',
      method: 'upi',
      note: null,
      allocations: [{ scopeKey: 'trx_1', amount: 3000, currency: 'INR' }],
      createdByDeviceId: 'dev_carol',
      createdAt: '2026-01-07',
    });
    const updateC = Y.encodeStateAsUpdate(deviceC);

    // Apply in a DIFFERENT order on each device.
    Y.applyUpdate(deviceA, updateB);
    Y.applyUpdate(deviceA, updateC);

    Y.applyUpdate(deviceB, updateC);
    Y.applyUpdate(deviceB, updateA);

    Y.applyUpdate(deviceC, updateA);
    Y.applyUpdate(deviceC, updateB);

    // Project each device's converged doc into its own database.
    const dbA = createNodeSqliteExecutor();
    const dbB = createNodeSqliteExecutor();
    const dbC = createNodeSqliteExecutor();
    for (const d of [dbA, dbB, dbC]) {
      await runMigrations(d, migrations);
      await seedGroupRow(d);
    }

    await projectGroupDoc(dbA, GROUP_ID, deviceA);
    await projectGroupDoc(dbB, GROUP_ID, deviceB);
    await projectGroupDoc(dbC, GROUP_ID, deviceC);

    const dump = async (d: SqliteExecutor) => ({
      splits: await d.getAllAsync(`SELECT debtor_id, owed_amount FROM expense_splits ORDER BY debtor_id`),
      settlements: await d.getAllAsync(
        `SELECT settlement_id, from_user_id, amount FROM settlements ORDER BY settlement_id`
      ),
      allocations: await d.getAllAsync(
        `SELECT allocation_id, split_id, amount FROM settlement_allocations ORDER BY allocation_id`
      ),
    });

    const [dumpA, dumpB, dumpC] = await Promise.all([dump(dbA), dump(dbB), dump(dbC)]);
    expect(dumpA).toEqual(dumpB);
    expect(dumpA).toEqual(dumpC);

    // And it's the fully-merged state, not a partial one.
    expect(dumpA.settlements).toHaveLength(2);
  });
});

describe('runProjector', () => {
  it('projects only pending updates and marks them projected', async () => {
    const doc = createGroupDoc();
    createTransaction(doc, 'dev_alice', makeHeader());
    await pushDocUpdate(db, doc, 'dev_alice');

    await runProjector(db);

    const [header] = await db.getAllAsync<{ trxn_id: string }>(`SELECT trxn_id FROM transaction_header`);
    expect(header.trxn_id).toBe('trx_1');

    const [{ pending }] = await db.getAllAsync<{ pending: number }>(
      `SELECT COUNT(*) AS pending FROM crdt_updates WHERE projected = 0`
    );
    expect(pending).toBe(0);
  });
});

describe('rebuildFromLog', () => {
  it('reproduces the live database exactly', async () => {
    const doc = createGroupDoc();
    createTransaction(doc, 'dev_alice', makeHeader());
    setSplitSet(doc, 'dev_alice', {
      scopeKey: 'trx_1',
      trxnId: 'trx_1',
      lineId: null,
      shares: [
        { debtorId: 'usr_alice', owedAmount: 4500, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
        { debtorId: 'usr_bob', owedAmount: 4500, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
      ],
      updatedAt: '2026-01-05',
      updatedByDeviceId: 'dev_alice',
    });
    appendSettlement(doc, {
      settlementId: 'stl_1',
      fromUserId: 'usr_bob',
      toUserId: 'usr_alice',
      amount: 4500,
      currency: 'INR',
      settledAt: '2026-01-06',
      method: 'cash',
      note: null,
      allocations: [{ scopeKey: 'trx_1', amount: 4500, currency: 'INR' }],
      createdByDeviceId: 'dev_bob',
      createdAt: '2026-01-06',
    });
    await pushDocUpdate(db, doc, 'dev_alice');
    await runProjector(db);

    const dumpLive = {
      header: await db.getAllAsync(`SELECT * FROM transaction_header`),
      splits: await db.getAllAsync(`SELECT * FROM expense_splits ORDER BY debtor_id`),
      settlements: await db.getAllAsync(`SELECT * FROM settlements`),
      allocations: await db.getAllAsync(`SELECT * FROM settlement_allocations`),
    };

    await rebuildFromLog(db);

    const dumpRebuilt = {
      header: await db.getAllAsync(`SELECT * FROM transaction_header`),
      splits: await db.getAllAsync(`SELECT * FROM expense_splits ORDER BY debtor_id`),
      settlements: await db.getAllAsync(`SELECT * FROM settlements`),
      allocations: await db.getAllAsync(`SELECT * FROM settlement_allocations`),
    };

    expect(dumpRebuilt).toEqual(dumpLive);
  });
});
