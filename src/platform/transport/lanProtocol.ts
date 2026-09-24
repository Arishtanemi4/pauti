// Pure protocol logic for LAN sync (docs/plan/EXECUTE.md Phase 8.4, docs/architecture.md
// ADR-014): computing state vectors, diffing against a peer's, and sealing/opening the
// newline-delimited JSON frames lan.ts sends over the raw TCP stream. No
// react-native-tcp-socket import here, so — like envelope.ts — this is unit-tested directly;
// lan.ts is the thin native driver that owns the actual socket and frame buffering.

import * as Y from 'yjs';
import { SqliteExecutor } from '../../db/migrations/runner';
import { loadGroupDoc } from '../../db/projector';
import { box, fromBase64, openBox, toBase64 } from '../crypto/sodium';

export interface LanFrame {
  senderDeviceId: string; // cleartext — same pattern as envelope.ts's SyncFileEnvelope
  nonce: string; // base64
  ciphertext: string; // base64
}

export type LanMessage =
  | { type: 'hello' }
  | { type: 'stateVectors'; vectors: { crdtDocId: string; stateVector: string | null }[] }
  | { type: 'update'; crdtDocId: string; payload: string }
  | { type: 'done' };

const EMPTY_UPDATE_LENGTH = 2; // Y.encodeStateAsUpdate for "nothing new" is exactly [0, 0]

/** One line of newline-delimited JSON, sealed to the peer's public key. */
export function sealFrame(
  message: LanMessage,
  myDeviceId: string,
  peerPublicKey: Uint8Array,
  myPrivateKey: Uint8Array
): string {
  const sealed = box(new TextEncoder().encode(JSON.stringify(message)), peerPublicKey, myPrivateKey);
  const frame: LanFrame = {
    senderDeviceId: myDeviceId,
    nonce: toBase64(sealed.nonce),
    ciphertext: toBase64(sealed.ciphertext),
  };
  return JSON.stringify(frame);
}

/** Decrypts one frame. The sender must already be a paired device — that's where its public key came from. */
export async function openFrame(
  line: string,
  db: SqliteExecutor,
  myPrivateKey: Uint8Array
): Promise<{ senderDeviceId: string; message: LanMessage }> {
  const frame = JSON.parse(line) as LanFrame;
  const [sender] = await db.getAllAsync<{ public_key: Uint8Array }>(
    'SELECT public_key FROM devices WHERE device_id = ?',
    [frame.senderDeviceId]
  );
  if (!sender) throw new Error('LAN peer is not a paired device.');

  const plaintext = openBox(
    { ciphertext: fromBase64(frame.ciphertext), nonce: fromBase64(frame.nonce) },
    sender.public_key,
    myPrivateKey
  );
  const message = JSON.parse(new TextDecoder().decode(plaintext)) as LanMessage;
  return { senderDeviceId: frame.senderDeviceId, message };
}

/** This device's current state vector for every group it has locally, sent to the peer so it knows what to diff against. */
export async function computeStateVectors(
  db: SqliteExecutor
): Promise<{ crdtDocId: string; stateVector: string | null }[]> {
  const rows = await db.getAllAsync<{ crdt_doc_id: string }>('SELECT crdt_doc_id FROM crdt_docs');
  const vectors: { crdtDocId: string; stateVector: string | null }[] = [];
  for (const { crdt_doc_id: crdtDocId } of rows) {
    const doc = await loadGroupDoc(db, crdtDocId);
    vectors.push({ crdtDocId, stateVector: toBase64(Y.encodeStateVector(doc)) });
  }
  return vectors;
}

/**
 * For every group in `theirVectors` this device also has locally, the update it needs to send
 * so the peer catches up. A group the peer mentions that this device has never seen (a fresh
 * group invite, Phase 8.5) diffs against an empty local doc, so the full history goes out.
 */
export async function computeDiffsToSend(
  db: SqliteExecutor,
  theirVectors: { crdtDocId: string; stateVector: string | null }[]
): Promise<{ crdtDocId: string; payload: string }[]> {
  const diffs: { crdtDocId: string; payload: string }[] = [];
  for (const { crdtDocId, stateVector } of theirVectors) {
    const doc = await loadGroupDoc(db, crdtDocId);
    // A null stateVector means the peer has never seen this doc — diff against an empty doc's
    // vector (not new Uint8Array(), which isn't a valid encoded vector) to send everything.
    const theirStateVector = stateVector ? fromBase64(stateVector) : Y.encodeStateVector(new Y.Doc());
    const diff = Y.encodeStateAsUpdate(doc, theirStateVector);
    if (diff.length > EMPTY_UPDATE_LENGTH) diffs.push({ crdtDocId, payload: toBase64(diff) });
  }
  return diffs;
}

/** Persists the merged state vector once a doc's LAN sync is done, so the next sync only diffs what changed since. */
export async function persistStateVector(db: SqliteExecutor, crdtDocId: string): Promise<void> {
  const doc = await loadGroupDoc(db, crdtDocId);
  await db.runAsync(`UPDATE crdt_docs SET state_vector = ?, updated_at = datetime('now') WHERE crdt_doc_id = ?`, [
    Y.encodeStateVector(doc),
    crdtDocId,
  ]);
}
