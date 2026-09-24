// Sync-file envelope format: build, encrypt, decrypt, ingest (docs/plan/EXECUTE.md Phase 8.3,
// docs/architecture.md ADR-014). A sync file targets one specific already-paired recipient —
// it's `sodium.box`'d to their public key, not a shared group secret — so only that person's
// private key can open it.
//
// Deliberately free of any expo-file-system/expo-sharing/expo-document-picker import: those
// pull in react-native internals that don't load outside the RN/Expo runtime (confirmed the same
// way platform/crypto/deviceKeys.ts's expo-secure-store import was), which would make this whole
// module untestable under Vitest. The actual file I/O lives in file.ts instead, which imports
// this module rather than the other way around.

import { SqliteExecutor } from '../../db/migrations/runner';
import { ingestRemoteUpdate } from '../../crdt/sync';
import { box, fromBase64, openBox, toBase64 } from '../crypto/sodium';

export interface SyncFileEnvelope {
  v: 1;
  senderDeviceId: string; // unencrypted — the recipient needs it to look up the sender's public key
  nonce: string; // base64
  ciphertext: string; // base64
}

interface SyncFileContents {
  v: 1;
  docs: { crdtDocId: string; updates: string[] }[]; // updates are base64 crdt_updates.payload rows
}

/** Gathers each group's full crdt_updates history and encrypts it to one recipient. */
export async function buildEnvelope(
  db: SqliteExecutor,
  crdtDocIds: readonly string[],
  senderDeviceId: string,
  senderPrivateKey: Uint8Array,
  recipientPublicKey: Uint8Array
): Promise<string> {
  const docs: SyncFileContents['docs'] = [];
  for (const crdtDocId of crdtDocIds) {
    const rows = await db.getAllAsync<{ payload: Uint8Array }>(
      `SELECT payload FROM crdt_updates WHERE crdt_doc_id = ? ORDER BY update_id`,
      [crdtDocId]
    );
    docs.push({ crdtDocId, updates: rows.map((row) => toBase64(row.payload)) });
  }

  const contents: SyncFileContents = { v: 1, docs };
  const sealed = box(new TextEncoder().encode(JSON.stringify(contents)), recipientPublicKey, senderPrivateKey);
  const envelope: SyncFileEnvelope = {
    v: 1,
    senderDeviceId,
    nonce: toBase64(sealed.nonce),
    ciphertext: toBase64(sealed.ciphertext),
  };
  return JSON.stringify(envelope);
}

/** Decrypts a sync file. Throws if it isn't a valid envelope or the keys don't match. */
export function parseEnvelope(
  envelopeJson: string,
  senderPublicKey: Uint8Array,
  recipientPrivateKey: Uint8Array
): { senderDeviceId: string; docs: SyncFileContents['docs'] } {
  let envelope: SyncFileEnvelope;
  try {
    envelope = JSON.parse(envelopeJson);
  } catch {
    throw new Error('Not a Pauti sync file');
  }
  if (envelope.v !== 1) throw new Error(`Unsupported sync file version: ${envelope.v}`);

  const plaintext = openBox(
    { ciphertext: fromBase64(envelope.ciphertext), nonce: fromBase64(envelope.nonce) },
    senderPublicKey,
    recipientPrivateKey
  );
  const contents = JSON.parse(new TextDecoder().decode(plaintext)) as SyncFileContents;
  return { senderDeviceId: envelope.senderDeviceId, docs: contents.docs };
}

/**
 * Decrypts a sync file and ingests every update it carries. The sender must already be a known
 * device (paired via src/platform/transport/qr.ts) — that's where its public key came from.
 */
export async function importEnvelope(
  db: SqliteExecutor,
  envelopeJson: string,
  recipientPrivateKey: Uint8Array
): Promise<{ senderDeviceId: string; importedDocs: number }> {
  const raw = JSON.parse(envelopeJson) as SyncFileEnvelope;
  const [sender] = await db.getAllAsync<{ public_key: Uint8Array }>(
    'SELECT public_key FROM devices WHERE device_id = ?',
    [raw.senderDeviceId]
  );
  if (!sender) {
    throw new Error('This sync file is from a device you have not paired with yet.');
  }

  const { senderDeviceId, docs } = parseEnvelope(envelopeJson, sender.public_key, recipientPrivateKey);
  for (const doc of docs) {
    for (const update of doc.updates) {
      await ingestRemoteUpdate(db, doc.crdtDocId, fromBase64(update), senderDeviceId);
    }
  }
  return { senderDeviceId, importedDocs: docs.length };
}
