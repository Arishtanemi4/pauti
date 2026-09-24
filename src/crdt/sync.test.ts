import { describe, expect, it, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { SqliteExecutor, runMigrations } from '../db/migrations/runner';
import { migrations } from '../db/migrations';
import { createNodeSqliteExecutor } from '../db/testing/nodeSqliteExecutor';
import { upsertMember } from './write';
import { ingestRemoteUpdate } from './sync';

const CRDT_DOC_ID = 'crdt_grp_trio';
const GROUP_ID = 'grp_trio';
const REMOTE_DEVICE_ID = 'dev_bob';

function makeUpdate(): Uint8Array {
  const doc = new Y.Doc();
  upsertMember(doc, { userId: 'usr_bob', role: 'member', joinedAt: '2026-01-05', deletedAt: null });
  return Y.encodeStateAsUpdate(doc);
}

let db: SqliteExecutor;

beforeEach(async () => {
  db = createNodeSqliteExecutor();
  await runMigrations(db, migrations);
  await db.runAsync(`INSERT INTO crdt_docs (crdt_doc_id, scope) VALUES (?, 'GROUP')`, [CRDT_DOC_ID]);
  await db.runAsync(
    `INSERT INTO groups (group_id, group_name, is_pair, default_currency, crdt_doc_id, created_by_device_id)
     VALUES (?, 'Trio', 0, 'INR', ?, 'dev_bootstrap')`,
    [GROUP_ID, CRDT_DOC_ID]
  );
  await db.runAsync(`INSERT INTO users (user_id, username, created_by_device_id) VALUES ('usr_bob', 'Bob', 'dev_bootstrap')`);
});

describe('ingestRemoteUpdate', () => {
  it('records the update and projects it', async () => {
    await ingestRemoteUpdate(db, CRDT_DOC_ID, makeUpdate(), REMOTE_DEVICE_ID);

    const rows = await db.getAllAsync(`SELECT * FROM crdt_updates WHERE crdt_doc_id = ?`, [CRDT_DOC_ID]);
    expect(rows).toHaveLength(1);

    const members = await db.getAllAsync<{ user_id: string }>(`SELECT user_id FROM group_members WHERE group_id = ?`, [
      GROUP_ID,
    ]);
    expect(members).toEqual([{ user_id: 'usr_bob' }]);
  });

  it('is idempotent — re-ingesting the same payload does not duplicate the row', async () => {
    const payload = makeUpdate();

    await ingestRemoteUpdate(db, CRDT_DOC_ID, payload, REMOTE_DEVICE_ID);
    await ingestRemoteUpdate(db, CRDT_DOC_ID, payload, REMOTE_DEVICE_ID);

    const rows = await db.getAllAsync(`SELECT * FROM crdt_updates WHERE crdt_doc_id = ?`, [CRDT_DOC_ID]);
    expect(rows).toHaveLength(1);
  });
});
