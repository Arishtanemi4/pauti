// Applies a local mutation to a group's Y.Doc and persists it (docs/plan/EXECUTE.md Phase 5).
// App code never touches src/crdt/write.ts's functions or crdt_updates directly — it goes
// through this one function: load the doc, mutate it (ownership-checked by write.ts), log the
// resulting state as a new crdt_updates row, then project immediately so the SQLite read
// model reflects the write without waiting for a sync tick.
//
// Logging the doc's full merged state (rather than an incremental diff) is deliberate and
// matches src/db/projector.test.ts's pushDocUpdate helper: Yjs updates are idempotent, so a
// full-state update replays identically to a sequence of incremental ones.

import * as Y from 'yjs';
import { SqliteExecutor } from '../db/migrations/runner';
import { loadGroupDoc, runProjector } from '../db/projector';

export async function writeToGroup(
  db: SqliteExecutor,
  crdtDocId: string,
  originDeviceId: string,
  mutate: (doc: Y.Doc) => void
): Promise<void> {
  const doc = await loadGroupDoc(db, crdtDocId);
  mutate(doc);
  const payload = Y.encodeStateAsUpdate(doc);
  await db.runAsync(`INSERT INTO crdt_updates (crdt_doc_id, payload, origin_device_id) VALUES (?, ?, ?)`, [
    crdtDocId,
    payload,
    originDeviceId,
  ]);
  await runProjector(db);
}
