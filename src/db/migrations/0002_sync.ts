import { Migration } from './runner';

// Phase 8 (docs/plan/EXECUTE.md) — local-only sync. payload_hash lets a sync-file import or a
// LAN peer replay the same crdt_updates row twice without duplicating it, mirroring the
// source_row_hash idempotency pattern statement import already uses. NULL for every
// locally-authored row (src/crdt/store.ts never sets it) — SQLite treats NULL as distinct in a
// UNIQUE index, so local writes need no hash and this adds no cost to the existing write path.
// Keep this in sync with ../schema.sql; schema.sql.test.ts asserts the two never drift apart.
export const migration0002Sync: Migration = {
  version: 2,
  sql: `
-- --------------------------------------------------------------------------
-- Sync (Phase 8). payload_hash de-duplicates crdt_updates rows ingested from
-- a sync file or a LAN peer (src/crdt/sync.ts). Locally-authored rows leave
-- it NULL and are exempt, since SQLite treats NULL as distinct in a UNIQUE
-- index.
-- --------------------------------------------------------------------------
ALTER TABLE crdt_updates ADD COLUMN payload_hash TEXT;
CREATE UNIQUE INDEX ux_crdt_updates_dedup ON crdt_updates(crdt_doc_id, payload_hash);

-- getOrCreateDeviceKeypair (src/platform/crypto/deviceKeys.ts) is the first code outside dev
-- fixtures to insert a self device row; guard against a concurrent double-run the same way
-- ux_users_self already guards users.
CREATE UNIQUE INDEX ux_devices_self ON devices(is_self) WHERE is_self = 1;
`,
};
