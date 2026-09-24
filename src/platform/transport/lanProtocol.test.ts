import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { SqliteExecutor, runMigrations } from '../../db/migrations/runner';
import { migrations } from '../../db/migrations';
import { createNodeSqliteExecutor } from '../../db/testing/nodeSqliteExecutor';
import { upsertMember } from '../../crdt/write';
import { generateKeypair, ready } from '../crypto/sodium';
import { computeDiffsToSend, computeStateVectors, openFrame, persistStateVector, sealFrame } from './lanProtocol';

const CRDT_DOC_ID = 'crdt_grp_trio';
const GROUP_ID = 'grp_trio';
const MY_DEVICE_ID = 'dev_self';
const PEER_DEVICE_ID = 'dev_bob';

let db: SqliteExecutor;
let me: ReturnType<typeof generateKeypair>;
let peer: ReturnType<typeof generateKeypair>;

beforeAll(ready);

beforeEach(async () => {
  db = createNodeSqliteExecutor();
  await runMigrations(db, migrations);
  me = generateKeypair();
  peer = generateKeypair();

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
    MY_DEVICE_ID,
  ]);
});

describe('sealFrame / openFrame', () => {
  it('round-trips a message, identifying the sender from a paired device row', async () => {
    await db.runAsync(`INSERT INTO devices (device_id, device_name, public_key, is_self) VALUES (?, 'Peer', ?, 0)`, [
      PEER_DEVICE_ID,
      peer.publicKey,
    ]);

    const line = sealFrame({ type: 'hello' }, PEER_DEVICE_ID, me.publicKey, peer.privateKey);
    const { senderDeviceId, message } = await openFrame(line, db, me.privateKey);

    expect(senderDeviceId).toBe(PEER_DEVICE_ID);
    expect(message).toEqual({ type: 'hello' });
  });

  it('rejects a frame from an unpaired device', async () => {
    const line = sealFrame({ type: 'hello' }, PEER_DEVICE_ID, me.publicKey, peer.privateKey);
    await expect(openFrame(line, db, me.privateKey)).rejects.toThrow('not a paired device');
  });
});

describe('computeStateVectors / computeDiffsToSend', () => {
  it('reports a state vector for every local crdt_doc', async () => {
    const vectors = await computeStateVectors(db);
    expect(vectors).toHaveLength(1);
    expect(vectors[0].crdtDocId).toBe(CRDT_DOC_ID);
    expect(vectors[0].stateVector).not.toBeNull();
  });

  it('sends the full history when the peer has nothing (null state vector)', async () => {
    const diffs = await computeDiffsToSend(db, [{ crdtDocId: CRDT_DOC_ID, stateVector: null }]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].crdtDocId).toBe(CRDT_DOC_ID);
  });

  it('sends nothing once the peer already has everything this device has', async () => {
    const myVectors = await computeStateVectors(db);
    const diffs = await computeDiffsToSend(db, myVectors);
    expect(diffs).toHaveLength(0);
  });

  it('sends nothing for a doc this device has never heard of', async () => {
    const diffs = await computeDiffsToSend(db, [{ crdtDocId: 'crdt_unknown', stateVector: null }]);
    expect(diffs).toHaveLength(0);
  });
});

describe('persistStateVector', () => {
  it('writes the doc’s current state vector into crdt_docs', async () => {
    await persistStateVector(db, CRDT_DOC_ID);
    const [row] = await db.getAllAsync<{ state_vector: Uint8Array | null }>(
      `SELECT state_vector FROM crdt_docs WHERE crdt_doc_id = ?`,
      [CRDT_DOC_ID]
    );
    expect(row.state_vector).not.toBeNull();
  });
});
