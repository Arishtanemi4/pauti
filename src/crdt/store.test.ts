import { describe, expect, it, beforeEach } from 'vitest';
import { SqliteExecutor, runMigrations } from '../db/migrations/runner';
import { migrations } from '../db/migrations';
import { createNodeSqliteExecutor } from '../db/testing/nodeSqliteExecutor';
import { createTransaction, setSplitSet } from './write';
import { TransactionHeader } from './doc';
import { writeToGroup } from './store';

const GROUP_ID = 'grp_trio';
const CRDT_DOC_ID = 'crdt_grp_trio';
const DEVICE_ID = 'dev_alice';

async function seedGroupRow(db: SqliteExecutor): Promise<void> {
  await db.runAsync(`INSERT INTO crdt_docs (crdt_doc_id, scope) VALUES (?, 'GROUP')`, [CRDT_DOC_ID]);
  await db.runAsync(
    `INSERT INTO groups (group_id, group_name, is_pair, default_currency, crdt_doc_id, created_by_device_id)
     VALUES (?, 'Trio', 0, 'INR', ?, 'dev_bootstrap')`,
    [GROUP_ID, CRDT_DOC_ID]
  );
  for (const userId of ['usr_alice', 'usr_bob']) {
    await db.runAsync(`INSERT INTO users (user_id, username, created_by_device_id) VALUES (?, ?, 'dev_bootstrap')`, [
      userId,
      userId,
    ]);
  }
}

function makeHeader(overrides: Partial<TransactionHeader> = {}): TransactionHeader {
  return {
    trxnId: 'trx_1',
    groupId: GROUP_ID,
    payerUserId: 'usr_alice',
    ownerDeviceId: DEVICE_ID,
    storeId: null,
    paymentModeId: null,
    trxnDate: '2026-01-05',
    description: null,
    totalAmount: 1000,
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

describe('writeToGroup', () => {
  it('mutates the doc, logs an update, and projects it into the read model', async () => {
    await writeToGroup(db, CRDT_DOC_ID, DEVICE_ID, (doc) => {
      createTransaction(doc, DEVICE_ID, makeHeader());
    });

    const [header] = await db.getAllAsync<{ trxn_id: string; total_amount: number }>(
      `SELECT trxn_id, total_amount FROM transaction_header WHERE trxn_id = 'trx_1'`
    );
    expect(header.total_amount).toBe(1000);

    const [{ pending }] = await db.getAllAsync<{ pending: number }>(
      `SELECT COUNT(*) AS pending FROM crdt_updates WHERE projected = 0`
    );
    expect(pending).toBe(0);
  });

  it('a later write on the same doc sees the earlier one (full-state log is cumulative, not overwritten)', async () => {
    await writeToGroup(db, CRDT_DOC_ID, DEVICE_ID, (doc) => {
      createTransaction(doc, DEVICE_ID, makeHeader());
    });

    await writeToGroup(db, CRDT_DOC_ID, DEVICE_ID, (doc) => {
      setSplitSet(doc, DEVICE_ID, {
        scopeKey: 'trx_1',
        trxnId: 'trx_1',
        lineId: null,
        shares: [
          { debtorId: 'usr_alice', owedAmount: 500, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
          { debtorId: 'usr_bob', owedAmount: 500, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
        ],
        updatedAt: '2026-01-05',
        updatedByDeviceId: DEVICE_ID,
      });
    });

    const splits = await db.getAllAsync<{ owed_amount: number }>(
      `SELECT owed_amount FROM expense_splits WHERE scope_key = 'trx_1'`
    );
    expect(splits.reduce((sum, s) => sum + s.owed_amount, 0)).toBe(1000);
  });
});
