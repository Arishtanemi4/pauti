import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { SqliteExecutor, runMigrations } from '../../db/migrations/runner';
import { migrations } from '../../db/migrations';
import { createNodeSqliteExecutor } from '../../db/testing/nodeSqliteExecutor';
import { upsertMember } from '../../crdt/write';
import { generateKeypair, ready } from '../crypto/sodium';
import { buildEnvelope, importEnvelope, parseEnvelope } from './envelope';

const CRDT_DOC_ID = 'crdt_grp_trio';
const GROUP_ID = 'grp_trio';
const SENDER_DEVICE_ID = 'dev_bob';

let db: SqliteExecutor;
let sender: ReturnType<typeof generateKeypair>;
let recipient: ReturnType<typeof generateKeypair>;

beforeAll(ready);

beforeEach(async () => {
  db = createNodeSqliteExecutor();
  await runMigrations(db, migrations);
  sender = generateKeypair();
  recipient = generateKeypair();

  await db.runAsync(`INSERT INTO crdt_docs (crdt_doc_id, scope) VALUES (?, 'GROUP')`, [CRDT_DOC_ID]);
  await db.runAsync(
    `INSERT INTO groups (group_id, group_name, is_pair, default_currency, crdt_doc_id, created_by_device_id)
     VALUES (?, 'Trio', 0, 'INR', ?, 'dev_bootstrap')`,
    [GROUP_ID, CRDT_DOC_ID]
  );
  await db.runAsync(`INSERT INTO users (user_id, username, created_by_device_id) VALUES ('usr_bob', 'Bob', 'dev_bootstrap')`);

  const doc = new Y.Doc();
  upsertMember(doc, { userId: 'usr_bob', role: 'member', joinedAt: '2026-01-05', deletedAt: null });
  await db.runAsync(`INSERT INTO crdt_updates (crdt_doc_id, payload, origin_device_id) VALUES (?, ?, ?)`, [
    CRDT_DOC_ID,
    Y.encodeStateAsUpdate(doc),
    SENDER_DEVICE_ID,
  ]);
});

describe('buildEnvelope / parseEnvelope', () => {
  it('round-trips a group history through encryption', async () => {
    const envelope = await buildEnvelope(db, [CRDT_DOC_ID], SENDER_DEVICE_ID, sender.privateKey, recipient.publicKey);

    const { senderDeviceId, docs } = parseEnvelope(envelope, sender.publicKey, recipient.privateKey);
    expect(senderDeviceId).toBe(SENDER_DEVICE_ID);
    expect(docs).toHaveLength(1);
    expect(docs[0].crdtDocId).toBe(CRDT_DOC_ID);
    expect(docs[0].updates).toHaveLength(1);
  });

  it('rejects decryption with the wrong keypair', async () => {
    const envelope = await buildEnvelope(db, [CRDT_DOC_ID], SENDER_DEVICE_ID, sender.privateKey, recipient.publicKey);
    const impostor = generateKeypair();
    expect(() => parseEnvelope(envelope, impostor.publicKey, recipient.privateKey)).toThrow();
  });

  it('rejects garbage input', () => {
    expect(() => parseEnvelope('not json', sender.publicKey, recipient.privateKey)).toThrow('Not a Pauti sync file');
  });
});

describe('importEnvelope', () => {
  it('ingests every update and projects them, keyed to the paired sender device', async () => {
    await db.runAsync(`INSERT INTO devices (device_id, device_name, public_key, is_self) VALUES (?, 'Bob''s phone', ?, 0)`, [
      SENDER_DEVICE_ID,
      sender.publicKey,
    ]);

    const envelope = await buildEnvelope(db, [CRDT_DOC_ID], SENDER_DEVICE_ID, sender.privateKey, recipient.publicKey);
    const result = await importEnvelope(db, envelope, recipient.privateKey);

    expect(result).toEqual({ senderDeviceId: SENDER_DEVICE_ID, importedDocs: 1 });

    const members = await db.getAllAsync<{ user_id: string }>(`SELECT user_id FROM group_members WHERE group_id = ?`, [
      GROUP_ID,
    ]);
    expect(members).toEqual([{ user_id: 'usr_bob' }]);
  });

  it('refuses a file from a device that has not been paired with', async () => {
    const envelope = await buildEnvelope(db, [CRDT_DOC_ID], SENDER_DEVICE_ID, sender.privateKey, recipient.publicKey);
    await expect(importEnvelope(db, envelope, recipient.privateKey)).rejects.toThrow(
      'you have not paired with yet'
    );
  });
});
