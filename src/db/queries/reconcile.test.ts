import { describe, expect, it, beforeEach } from 'vitest';
import { SqliteExecutor, runMigrations } from '../migrations/runner';
import { migrations } from '../migrations';
import { createNodeSqliteExecutor } from '../testing/nodeSqliteExecutor';
import {
  computeMatchSuggestions,
  confirmMatch,
  getStatementEntriesByIds,
  ignoreMatch,
} from './reconcile';

let db: SqliteExecutor;
const device = 'dev_test';
const userId = 'usr_self';

async function seedUserAndGroup() {
  await db.runAsync(`INSERT INTO devices (device_id, device_name, public_key, is_self) VALUES (?, 'Test device', x'00', 1)`, [device]);
  await db.runAsync(
    `INSERT INTO users (user_id, username, default_currency, is_self, created_by_device_id) VALUES (?, 'self', 'INR', 1, ?)`,
    [userId, device]
  );
  await db.runAsync(`INSERT INTO crdt_docs (crdt_doc_id, scope) VALUES ('crdt_g1', 'GROUP')`);
  await db.runAsync(
    `INSERT INTO groups (group_id, group_name, is_pair, default_currency, crdt_doc_id, created_by_device_id)
     VALUES ('grp_g1', 'G1', 0, 'INR', 'crdt_g1', ?)`,
    [device]
  );
}

async function insertTransaction(trxnId: string, amount: number, date: string, description = 'Test txn') {
  await db.runAsync(
    `INSERT INTO transaction_header
       (trxn_id, group_id, payer_user_id, trxn_date, description, total_amount, currency, created_by_device_id)
     VALUES (?, 'grp_g1', ?, ?, ?, ?, 'INR', ?)`,
    [trxnId, userId, date, description, amount, device]
  );
}

async function insertStatementEntry(entryId: string, amount: number, date: string, description = 'Statement row') {
  await db.runAsync(
    `INSERT INTO statement_entries
       (entry_id, user_id, statement_date, description, amount, currency, source_file_reference, source_row_hash)
     VALUES (?, ?, ?, ?, ?, 'INR', 'file.pdf', ?)`,
    [entryId, userId, date, description, amount, entryId]
  );
}

beforeEach(async () => {
  db = createNodeSqliteExecutor();
  await runMigrations(db, migrations);
  await seedUserAndGroup();
});

describe('computeMatchSuggestions', () => {
  it('suggests the one clear candidate for a debit entry', async () => {
    await insertTransaction('trx_1', 5000, '2026-01-10');
    await insertStatementEntry('stm_1', -5000, '2026-01-10');

    await computeMatchSuggestions(db, userId, 'INR');

    const [entry] = await getStatementEntriesByIds(db, ['stm_1']);
    expect(entry.matchStatus).toBe('SUGGESTED');
    expect(entry.matchedTrxnId).toBe('trx_1');
  });

  it('surfaces an ambiguous pair as SUGGESTED rather than auto-matching either candidate', async () => {
    // Two transactions of the same amount on the same date — either could be the match.
    await insertTransaction('trx_a', 3000, '2026-02-01', 'Candidate A');
    await insertTransaction('trx_b', 3000, '2026-02-01', 'Candidate B');
    await insertStatementEntry('stm_2', -3000, '2026-02-01');

    await computeMatchSuggestions(db, userId, 'INR');

    const [entry] = await getStatementEntriesByIds(db, ['stm_2']);
    expect(entry.matchStatus).toBe('SUGGESTED');
    expect(['trx_a', 'trx_b']).toContain(entry.matchedTrxnId);
  });

  it('does not suggest a match for a credit entry', async () => {
    await insertTransaction('trx_3', 2000, '2026-03-01');
    await insertStatementEntry('stm_3', 2000, '2026-03-01'); // positive = credit

    await computeMatchSuggestions(db, userId, 'INR');

    const [entry] = await getStatementEntriesByIds(db, ['stm_3']);
    expect(entry.matchStatus).toBe('UNMATCHED');
  });
});

describe('confirmMatch / ignoreMatch', () => {
  it('confirming links both sides: statement_entries.match_status and transaction_header.reconciled_entry_id', async () => {
    await insertTransaction('trx_4', 1500, '2026-04-01');
    await insertStatementEntry('stm_4', -1500, '2026-04-01');

    await confirmMatch(db, 'stm_4', 'trx_4');

    const [entry] = await getStatementEntriesByIds(db, ['stm_4']);
    expect(entry.matchStatus).toBe('CONFIRMED');
    expect(entry.matchedTrxnId).toBe('trx_4');

    const [row] = await db.getAllAsync<{ reconciled_entry_id: string | null }>(
      `SELECT reconciled_entry_id FROM transaction_header WHERE trxn_id = 'trx_4'`
    );
    expect(row.reconciled_entry_id).toBe('stm_4');
  });

  it('ignoring sets match_status to IGNORED without touching any transaction', async () => {
    await insertStatementEntry('stm_5', 999, '2026-05-01');

    await ignoreMatch(db, 'stm_5');

    const [entry] = await getStatementEntriesByIds(db, ['stm_5']);
    expect(entry.matchStatus).toBe('IGNORED');
  });
});
