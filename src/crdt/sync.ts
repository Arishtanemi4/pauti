// Applies an update received from a sync file or a LAN peer (docs/architecture.md ADR-014) to a
// group's CRDT op-log. Deliberately separate from store.ts, which is specifically about *local*
// mutation (it calls mutate(doc) and encodes the diff itself) — this path only ever appends
// bytes someone else already produced, so it never touches a Y.Doc directly.
//
// payload_hash (migration 0002) makes ingestion idempotent: replaying the same sync file or the
// same LAN update twice is a no-op rather than a duplicate row, via
// ON CONFLICT(crdt_doc_id, payload_hash) DO NOTHING.

import { SqliteExecutor } from '../db/migrations/runner';
import { runProjector } from '../db/projector';
import { fnv1a } from '../core/hash';

function hashPayload(payload: Uint8Array): string {
  let hex = '';
  for (const byte of payload) hex += byte.toString(16).padStart(2, '0');
  return fnv1a(hex);
}

/**
 * Records one remote update for `crdtDocId` and re-projects. `crdtDocId` must already have a
 * `crdt_docs` row (crdt_updates.crdt_doc_id is a foreign key) — for a brand-new group invite
 * (Phase 8.5), createGroupSkeleton (src/db/queries/groups.ts) creates that row first.
 */
export async function ingestRemoteUpdate(
  db: SqliteExecutor,
  crdtDocId: string,
  payload: Uint8Array,
  originDeviceId: string
): Promise<void> {
  await db.runAsync(
    `INSERT INTO crdt_updates (crdt_doc_id, payload, origin_device_id, payload_hash)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(crdt_doc_id, payload_hash) DO NOTHING`,
    [crdtDocId, payload, originDeviceId, hashPayload(payload)]
  );
  await runProjector(db);
}
