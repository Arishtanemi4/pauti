# Local-only sync

Status: **shipping in v0.1.0** (Phase 8 — see [ADR-014](../architecture.md#adr-014--sync-device-identity-mutual-qr-pairing-one-recipient-encryption)).
Last measured: 2026-09-24.

This document covers how a device gets an identity, how two devices come to trust each other,
and how CRDT history actually moves between them once they do. It does not cover the CRDT
op-log itself (`src/crdt/`) or the projector (`src/db/projector.ts`) — those are transport-
agnostic and already documented in `docs/plan/EXECUTE.md` §4.

---

## 1. TL;DR

- Every device generates one X25519 keypair (`react-native-libsodium`) on first run. The private
  key lives only in `expo-secure-store`; the public key is a normal SQLite column
  (`devices.public_key`) that travels with the app's own sync data.
- Two devices trust each other only after **each has scanned the other's QR code** — a single
  scan is one-directional. `app/pair.tsx` runs the identical flow on both sides.
- Every sync payload — a sync file or a LAN frame — is `crypto_box`'d to one specific,
  already-paired recipient, never a shared group secret. The sender's device id rides alongside
  in cleartext so the receiver knows whose public key to decrypt with.
- Three transports, one shared ingestion path: `src/crdt/sync.ts`'s `ingestRemoteUpdate` is what
  both sync-file import and LAN sync call once a payload is decrypted. It's idempotent
  (`payload_hash` + `UNIQUE`), so replaying the same file or the same LAN update twice is a
  no-op.
- No network code anywhere in this layer (ADR-007). LAN sync is a direct TCP socket between two
  devices on the same Wi-Fi, with a manually-typed IP address — no discovery service, no relay.

---

## 2. Identity (`src/platform/crypto/`)

```
sodium.ts            deviceKeys.ts                 app/onboarding.tsx
┌────────────────┐   ┌─────────────────────────┐   ┌───────────────────────┐
│ react-native-   │──▶│ getOrCreateDeviceKeypair │◀──│ first-run name field  │
│ libsodium       │   │ (expo-secure-store +     │   │ → createSelfUser +    │
│ box/openBox     │   │  devices row)            │   │   the call at left    │
└────────────────┘   └─────────────────────────┘   └───────────────────────┘
```

- **`sodium.ts`** is the only file that may import `react-native-libsodium` (the established
  "one file may import X" boundary — see `platform/sqlite.ts`, `platform/ocr.ts`). It wraps
  `crypto_box_keypair`/`crypto_box_easy`/`crypto_box_open_easy` and base64 helpers. `crypto_box`
  (X25519 + XSalsa20-Poly1305) was picked over a signing-only keypair because it's authenticated
  encryption in one primitive — a successful decrypt is cryptographically tied to the sender's
  private key, so pairing needs no separate signature scheme.
- **`deviceKeys.ts`** is the only file that may import `expo-secure-store`. Its
  `getOrCreateDeviceKeypair(db, deviceName)` is idempotent and safe to call on every app start:
  reads the private key from secure storage and the public key from the `devices` row where
  `is_self = 1`; generates+persists both on first call; if the two storage systems have desynced
  (a restored SQLite backup with no matching Keystore entry, for instance) it rotates the public
  key on the existing row rather than creating a second self device.
- **`app/onboarding.tsx`** is shown by a `Gate` component in `app/_layout.tsx` whenever
  `DatabaseContext` finds no self user — the only place besides dev fixtures
  (`src/db/fixtures.ts`, `__DEV__`-only) that creates one. A single display-name field calls
  `createSelfUser` then `getOrCreateDeviceKeypair`.

---

## 3. Pairing (`src/platform/transport/qr.ts`, `app/pair.tsx`)

A camera scan only tells the scanning device who the other side is — it says nothing back. So
pairing is **two scans**, not one: `app/pair.tsx` is a single screen both devices open, and both
do the same two things (show their own QR, then scan the other's), in whichever order suits the
two people involved. There is no "host" or "joiner" role.

The QR payload (`qr.ts`, pure — no native import, unit-tested directly):

```ts
interface PairingPayload {
  v: 1;
  userId: string;
  deviceId: string;
  deviceName: string;
  displayName: string;
  publicKey: string; // base64
}
```

Scanning one calls `upsertKnownPerson` (`src/db/queries/devices.ts`), which upserts `users`,
`contacts` and `devices` together — the minimal "I just met this person" write. There's no
separate contacts-management screen; meeting someone via pairing or a group invite is the only
way a `users` row is created outside fixtures.

A **group invite** is the same payload with `{ groupId, crdtDocId, groupName, defaultCurrency,
isPair }` appended (`GroupInvitePayload`), reached via `app/groups/[groupId].tsx`'s "Add member"
button. Scanning an invite additionally calls `createGroupSkeleton` (idempotent —
`ON CONFLICT DO NOTHING`) so the group exists locally with zero history, ready to receive it over
a sync-file or LAN sync. When the *inviter's* device then scans the invitee's plain pairing code
back, it calls `upsertMember` on the group's CRDT doc.

---

## 4. Getting bytes across: three transports, one ingestion path

```
                          ┌─────────────────────────────┐
  sync file (8.3)  ──────▶│                              │
                          │  ingestRemoteUpdate(db,       │──▶ crdt_updates (payload_hash,
  LAN peer (8.4)   ──────▶│    crdtDocId, payload,        │     UNIQUE(crdt_doc_id, payload_hash))
                          │    originDeviceId)             │──▶ runProjector(db)
  group invite (8.5) ────▶│  (src/crdt/sync.ts)           │
  (bootstraps the doc,     └─────────────────────────────┘
   carries no history)
```

`ingestRemoteUpdate` is deliberately separate from `src/crdt/store.ts`, which is specifically
about *local* mutation (it calls `mutate(doc)` and encodes its own diff). This path only ever
appends bytes someone else already produced. Both transports funnel into it, so a future relay
transport (ADR-007's stated extension point) would only need to produce the same
`(crdtDocId, payload, originDeviceId)` triple.

### 4.1 Sync file (`src/platform/transport/envelope.ts` + `file.ts`)

Export gathers a chosen set of groups' full `crdt_updates.payload` history, wraps it in
`{ v: 1, docs: [{ crdtDocId, updates: string[] }] }`, and `box`'s it to one recipient's public
key:

```ts
interface SyncFileEnvelope { v: 1; senderDeviceId: string; nonce: string; ciphertext: string; }
```

`senderDeviceId` rides in cleartext — the recipient needs it to look up *which* public key to
decrypt with, and does so from its own `devices` table, so an unpaired sender is rejected before
decryption is attempted (`importEnvelope` throws "This sync file is from a device you have not
paired with yet.").

Import decrypts, then calls `ingestRemoteUpdate` once per update. Re-importing the same file is
free — `payload_hash` conflicts, `ON CONFLICT DO NOTHING`.

**Native/pure split.** `expo-file-system`, `expo-sharing`, and `expo-document-picker` all pull in
React Native internals that use Flow syntax, which Vitest's transform can't parse — importing any
of them breaks the whole test file (`RolldownError: Parse failure: Flow is not supported`), the
same failure mode `deviceKeys.ts`'s `expo-secure-store` import hit first. So the envelope
format/crypto (`envelope.ts` — DB + `sodium.ts` only) is a separate file from the actual file I/O
(`file.ts` — `writeSyncFile`/`shareSyncFile`/`pickSyncFile`, the sole importer of those three
native packages, `export * from './envelope'` so `app/sync.tsx` has one import surface). Only
`envelope.ts` has a unit test; `file.ts` is verified on-device, same convention as
`platform/ocr.ts`.

### 4.2 LAN sync (`src/platform/transport/lanProtocol.ts` + `lan.ts`, Android only)

**Discovery is manual IP entry, not mDNS.** One device calls `getLocalIpAddress()`
(`expo-network`) and shows it; the other types it into `app/lan.tsx` and connects. This was a
deliberate simplification (Simplicity First) over adding `react-native-zeroconf` or similar for
auto-discovery — one new native networking dependency (`react-native-tcp-socket`) instead of two.

Handshake, once a raw TCP socket is open (either device can be the one that dialed — the protocol
itself is symmetric):

1. Each side computes its state vector per locally-known `crdt_doc_id`
   (`Y.encodeStateVector(doc)`) and sends `{ type: 'stateVectors', vectors }`.
2. On receiving the peer's vectors, each side computes what the peer is missing
   (`Y.encodeStateAsUpdate(doc, theirVector)`) and sends one `{ type: 'update', crdtDocId,
   payload }` per non-empty diff, then `{ type: 'done' }`. A doc the peer mentions that this
   device has never seen diffs against `Y.encodeStateVector(new Y.Doc())` — not `new
   Uint8Array()`, which is not a validly encoded Yjs state vector and fails to decode — so a
   fresh group invite still gets its full history.
3. Each received `update` goes through `ingestRemoteUpdate`, then `crdt_docs.state_vector` (a
   column reserved since an earlier schema phase but unused until now) is persisted so the next
   sync only diffs what changed since.
4. The socket closes once both sides have sent and received `done`.

Every frame is newline-delimited JSON, `crypto_box`'d exactly like the sync-file envelope:

```ts
interface LanFrame { senderDeviceId: string; nonce: string; ciphertext: string; }
```

**Native/pure split**, same reasoning as 4.1: `lanProtocol.ts` (state-vector diffing, frame
seal/open — `sodium.ts` and DB only) is unit-tested directly; `lan.ts` (the sole importer of
`react-native-tcp-socket` and `expo-network`) owns the actual socket and buffering, verified
on-device. `lan.web.ts` is a throwing stub (§1.3 convention) — LAN sync is Android-only.

---

## 5. Idempotency

`crdt_updates` gained one nullable column in migration `0002_sync.ts`:

```sql
ALTER TABLE crdt_updates ADD COLUMN payload_hash TEXT;
CREATE UNIQUE INDEX ... ON crdt_updates(crdt_doc_id, payload_hash) WHERE payload_hash IS NOT NULL;
```

Locally-authored updates (`store.ts`) never populate it — only `ingestRemoteUpdate` does, via
`fnv1a` (`src/core/hash.ts`) over the update's hex-encoded bytes. This mirrors the
`source_row_hash` pattern statement import already uses: replaying the same sync file, or the
same LAN update after a dropped connection retried the handshake, inserts nothing twice.

---

## 6. Testing status

Unit-tested directly (no native import to break under Vitest): `src/crdt/sync.ts`,
`src/platform/transport/qr.ts`, `src/platform/transport/envelope.ts`,
`src/platform/transport/lanProtocol.ts`, `src/db/queries/devices.ts`, `src/db/queries/groups.ts`
(`getGroupDetail`/`createGroupSkeleton`), migration `0002_sync.ts`.

Verified on-device only (native wrappers with no unit test, per the `platform/sqlite.ts`/
`platform/ocr.ts` convention): `src/platform/crypto/sodium.ts`, `src/platform/crypto/
deviceKeys.ts`, `src/platform/transport/file.ts`, `src/platform/transport/lan.ts`. The
two-physical-device, airplane-mode pairing/export/LAN/invite pass (`docs/plan/EXECUTE.md`
Phase 8's Verify block) is tracked there, not here.

---

## 7. File map

| File | Role |
|---|---|
| `src/platform/crypto/sodium.ts` | Only importer of `react-native-libsodium`. Keypair + `crypto_box` primitives. |
| `src/platform/crypto/deviceKeys.ts` | Only importer of `expo-secure-store`. This device's persisted identity. |
| `app/onboarding.tsx` | First-run self-user creation, gated in `app/_layout.tsx`. |
| `src/platform/transport/qr.ts` | Pure pairing/invite payload encode-decode. |
| `app/pair.tsx` | Two-sequential-scan pairing screen; also the group-invite entry point. |
| `src/crdt/sync.ts` | `ingestRemoteUpdate` — the shared, idempotent "apply a remote update" primitive. |
| `src/platform/transport/envelope.ts` | Pure sync-file build/parse/import. |
| `src/platform/transport/file.ts` | Only importer of `expo-file-system`/`expo-sharing`/`expo-document-picker` for sync. |
| `app/sync.tsx` | Export/import UI; entry point to LAN sync. |
| `src/platform/transport/lanProtocol.ts` | Pure state-vector diffing and LAN frame seal/open. |
| `src/platform/transport/lan.ts` | Only importer of `react-native-tcp-socket`/`expo-network`. Socket orchestration. |
| `src/platform/transport/lan.web.ts` | Throwing stub — LAN sync is Android-only. |
| `app/lan.tsx` | Manual-IP-entry LAN sync screen. |
| `src/db/migrations/0002_sync.ts` | Adds `crdt_updates.payload_hash` + its unique index. |
| `docs/architecture.md` — ADR-014 | The architectural decision this document explains in more detail. |

---

## 8. Glossary

- **Device vs. user.** A `users` row is a person; a `devices` row is one of their phones. Pairing
  exchanges both — the payload carries `userId` and `deviceId` together — but sync-file/LAN
  encryption always targets a specific *device*'s public key, never a user in the abstract.
- **Envelope / frame.** "Envelope" is the sync-file wrapper (`SyncFileEnvelope`); "frame" is one
  line of a LAN session (`LanFrame`). Same shape, same `crypto_box` sealing, different transport.
- **State vector.** Yjs's compact summary of "which updates a document already has", used to ask
  a peer for only what's missing rather than replaying full history every sync.
- **Payload hash.** `fnv1a` over a `crdt_updates.payload` row, making re-ingesting the same bytes
  a no-op (§5). Unrelated to the `crypto_box` nonce/ciphertext, which changes every time the same
  plaintext is sealed.
