# Pauti — EXECUTE.md

**This is a build script, not a design document.** It tells you *what* to build and *how to
know it worked*. Every "why" lives in [`../architecture.md`](../architecture.md) as a numbered
ADR. If you find yourself reasoning about design while executing, stop and read the ADR instead.

- Product requirements: [`../REQUIREMENTS.md`](../REQUIREMENTS.md)
- Design rationale: [`../architecture.md`](../architecture.md)
- Release history: [`../../CHANGELOG.md`](../../CHANGELOG.md)

Target of this document: **v0.1.0, Android**.

---

## 0. How to execute this document

### 0.1 Rules

1. **One phase per session.** Do not begin a phase until the previous phase's **Verify** block
   passes in full. A partially passing Verify block is a failing Verify block.
2. **Every task names its file path and its acceptance criterion.** If a task seems to need a
   file not named anywhere in this document, that is a STOP (§0.2).
3. **Do not hand-pin dependency versions.** Install with `npx expo install <pkg>`, which
   resolves the version matching the installed Expo SDK. Commit the lockfile. Only §3's
   allow-list may be installed.
4. **No network calls in application code. Ever.** Not for exchange rates, not for telemetry,
   not for crash reporting, not for a font. This is requirement 3 and ADR-007. Build-time and
   dev-time network use (npm install, EAS builds) is fine; shipped runtime code makes zero
   requests. If a library you install opens a socket at runtime, that is a STOP.
5. **Never write to the derived SQLite tables directly.** All writes go through `src/crdt`'s
   write API and reach SQLite via the projector (ADR-001). The only code that may `INSERT`,
   `UPDATE` or `DELETE` on derived tables is `src/db/projector.ts`.
6. **Commit per task**, conventional commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).
   At each phase boundary, tag `v0.1.0-alpha.<phase>` — e.g. `v0.1.0-alpha.3`.
7. **Fixtures are real personal financial documents.** Never commit them, never move them
   outside a gitignored path, never paste their contents into a commit message or a log.

### 0.2 STOP and ask the user

Halt and ask before doing any of these. Do not proceed on a best guess.

- Installing a dependency that is not in §3.
- Changing anything in §4 (the schema) — including "just adding a column".
- Deviating from any ADR in `../architecture.md`.
- Writing code that performs a network request.
- Deleting or relocating anything under a fixtures path, or any file you did not create.
- **The Phase 7 OCR gate** (§6, Phase 7). The accuracy bar and the timebox are the user's call.
- Any point where two readings of this document would produce materially different code.

### 0.3 Definition of done, per task

A task is done when its acceptance criterion is demonstrably met — a test passes, a command
exits zero, a screen renders the expected number. "It should work" is not done. If you cannot
demonstrate it, say so plainly rather than marking it complete.

---

## 1. Scope and versioning

### 1.1 What v0.1.0 means

v0.1.0 = **every phase in §6 complete, with Android as the verified target.** It does not mean
"Android release" as opposed to some other release — the version describes the feature set, not
the platform (ADR-011).

### 1.2 Version mechanics

| Field | Where | Behaviour |
|---|---|---|
| `version` | `package.json`, `app.json` | **One value, shared by all targets.** Semver. |
| `android.versionCode` | `app.json` | Integer, increments on every Play upload, independent |
| `ios.buildNumber` | `app.json` | String, increments on every TestFlight upload, independent |
| Web | — | No build number; deployed per commit |

**Never encode a platform in the version number.** Platform support is a separate axis, tracked
as a matrix line in `CHANGELOG.md`:

```markdown
## [0.1.0] - YYYY-MM-DD
Platforms: Android ✓ | iOS — | Web —
```

When iOS is later verified, that is a CHANGELOG entry at whatever version happens to be current.
No version is reserved for a platform in advance.

### 1.3 Platform order

**Android → iOS → Web.** Only Android is built, run or verified during v0.1.0 (ADR-003).

- iOS requires **no** scaffolding. The same `.ts` files serve it; it is simply not built yet.
- Web requires `.web.ts` stubs that **throw** `not implemented on web`, for OCR, PDF extraction
  and LAN sync. This makes the web gap explicit and type-checked rather than a silent runtime
  failure. Stubs only — do not attempt web parity.

---

## 2. Target structure

A **flat single Expo app**. Not a monorepo: one `package.json`, one `tsconfig.json`, no
workspace resolution to debug (CLAUDE.md, "Simplicity First"; ADR-011).

```
pauti/
  app/                      Expo Router routes
    (tabs)/
      index.tsx             Home / dashboard
      chat.tsx              Contact list
      add.tsx               Add Expense  (a screen, not a modal — ADR-012)
      groups.tsx            Group list
    chat/[userId].tsx       Conversation thread
    groups/[groupId].tsx    Group detail
    split/[trxnId].tsx      Item-level split editor
    review/[artifactId].tsx OCR / import review
  src/
    core/                   Pure TypeScript. No React, no SQLite, no I/O. Vitest.
      money/                minor units, rounding, remainder distribution, read-time FX
      split/                EQUAL | EXACT | PERCENT | SHARES + partial item shares
      balance/              netting, roll-up, debt simplification
      reconcile/            statement <-> receipt matcher
    db/
      schema.sql            §4.3 verbatim
      migrations/           forward-only
      projector.ts          CRDT update -> SQL rows. The ONLY writer of derived tables.
      queries/              typed query helpers, one module per screen
    crdt/
      doc.ts                Y.Doc schema
      write.ts              ownership-checked write API
    parse/
      receipt.ts            receipt text -> structured draft
      statement.ts          statement text -> structured draft
    platform/               the ONLY place platform APIs may be imported
      ocr.ts / ocr.web.ts
      pdf.ts / pdf.web.ts
      transport/
      crypto/
    ui/
      theme/                tokens ported from the old web/ stub
      components/
  assets/
  ml/                       Python lab: parser R&D, fixture evaluation. Does not ship.
    tests/fixtures/         gitignored — real receipts and statements
  docs/
  CHANGELOG.md
```

Platform variance uses React Native's extension resolution (`.android.ts`, `.ios.ts`, `.web.ts`)
and is **confined to `src/platform/`**. No file outside that directory may import a platform API.

---

## 3. Stack and dependencies

Install with `npx expo install`. This list is the allow-list; anything else is a STOP (§0.2).

| Package | Purpose |
|---|---|
| `expo`, `expo-router` | app framework, file-based routing |
| `expo-sqlite` | on-device SQLite |
| `yjs` | CRDT engine — pure JS, runs under Hermes (ADR-002) |
| `expo-mlkit-ocr` | ML Kit Text Recognition v2, on-device, pretrained (Phase 7) |
| `expo-pdf-text-extract` | native PDF text layer — PDFBox on Android (Phase 6) |
| `expo-document-picker` | statement file selection |
| `expo-camera` | receipt capture, QR scanning |
| `expo-file-system` | sync file read/write |
| `react-native-qrcode-svg` | QR generation for pairing |
| a libsodium binding | device keypair, sync-file encryption (Phase 8) |
| `typescript` | — |
| `vitest` | `src/core` unit and property tests |

### 3.1 Dev build required, from Phase 0

`expo-mlkit-ocr` and `expo-pdf-text-extract` are native modules. **Expo Go cannot run this
app** (ADR-003). Phase 0 runs `npx expo prebuild` and produces an Android dev build via
`npx expo run:android`. Do this at the start, not when Phase 6 needs it — discovering it late
means rebuilding the workflow around an app that already exists.

---

## 4. Schema — SQLite read model

### 4.1 Defects in schema v1, and their fixes

| Defect (schema v1) | Fix |
|---|---|
| `products.product_category_id` FKs `product_categories`, a table that does not exist | Two real taxonomies: `product_categories` and `store_categories` |
| A single `categories` table conflates store type with product type (Tesco is a *Groceries store*; Jack Daniels bought there is an *Alcohol product*) | Split as above; each gets a nullable `parent_category_id` reserved now, so adding hierarchy later needs no device migration |
| `owned_amount` — misspelling of *owed* | Renamed `owed_amount` |
| `owned_amount_gbp` hardcodes a currency into the schema | Integer minor units + ISO-4217 `currency` column; conversion derived at read time |
| Amounts are bare integers with no documented unit; `expenses_create.sql` used `REAL` for money | **Minor units everywhere. No floats touch money — ever.** |
| `expense_splits` carries both `trxn_id` and `line_id` with no constraint; the two can disagree | `trxn_id NOT NULL`, `line_id` nullable (NULL means header scope), `scope_key` CHECKed to equal `COALESCE(line_id, trxn_id)` |
| `is_settled BOOLEAN` loses who settled, when, and how much | Removed. `settlements` + `settlement_allocations` (many-to-many); status derived |
| `is_reconciled BOOLEAN` records that a match happened but not to what | `reconciled_entry_id` FK into `statement_entries` |
| **No table for bank statement entries at all**, despite reconciliation being a core feature | `statement_entries` |
| No audit columns anywhere | `created_at`, `updated_at`, `created_by_device_id`, `deleted_at` on every synced table |

### 4.2 Conventions

- Text UUID primary keys with type prefixes, continuing the existing `usr_` / `cat_` convention
  from `backend/app/models.py`: `usr_ cnt_ dev_ grp_ trx_ lin_ splt_ stl_ alc_ stm_ prd_ str_
  pcat_ scat_ pay_ fxr_ ocr_`.
- **Money: integer minor units + a 3-letter ISO-4217 `currency` column.** Never a float, never a
  currency baked into a column name.
- **Ratios are rationals, not floats** — `_num` / `_den` integer pairs for quantities, split
  weights and exchange rates. A design that bans floats for money cannot smuggle them back in
  through rates.
- Soft delete via `deleted_at`; tombstones must survive so that deletions converge.
- Dates are ISO-8601 strings (SQLite has no date type).
- The FKs between `transaction_header` and `statement_entries` are mutually circular. SQLite
  resolves foreign keys at DML time, not DDL time, so declaration order does not matter.

### 4.3 DDL

```sql
-- ===========================================================================
-- Pauti — SQLite read model, v2
-- Materialised from the Yjs op-log. Disposable: droppable and rebuildable
-- from crdt_updates at any time. Do not write to these tables directly;
-- all writes go through core/crdt and arrive here via the projector.
-- ===========================================================================
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------------------------
-- CRDT persistence — the actual source of truth. Everything below is derived.
-- --------------------------------------------------------------------------
CREATE TABLE crdt_docs (
  crdt_doc_id       TEXT PRIMARY KEY,
  scope             TEXT NOT NULL CHECK (scope IN ('GROUP','PRIVATE')),
  state_vector      BLOB,
  last_projected_at TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE crdt_updates (
  update_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  crdt_doc_id      TEXT NOT NULL REFERENCES crdt_docs(crdt_doc_id),
  payload          BLOB NOT NULL,          -- Y.encodeStateAsUpdate output
  origin_device_id TEXT NOT NULL,
  received_at      TEXT NOT NULL DEFAULT (datetime('now')),
  projected        INTEGER NOT NULL DEFAULT 0 CHECK (projected IN (0,1))
);
CREATE INDEX ix_crdt_updates_pending ON crdt_updates(crdt_doc_id, projected);

-- --------------------------------------------------------------------------
-- Identity. users is ledger identity (syncs); contacts and devices are local.
-- --------------------------------------------------------------------------
CREATE TABLE devices (
  device_id      TEXT PRIMARY KEY,
  device_name    TEXT NOT NULL,
  public_key     BLOB NOT NULL,
  is_self        INTEGER NOT NULL DEFAULT 0 CHECK (is_self IN (0,1)),
  last_synced_at TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  user_id              TEXT PRIMARY KEY,
  username             TEXT NOT NULL,
  firstname            TEXT,
  lastname             TEXT,
  email                TEXT,
  contact_number       TEXT,
  default_currency     TEXT NOT NULL DEFAULT 'INR' CHECK (length(default_currency) = 3),
  is_self              INTEGER NOT NULL DEFAULT 0 CHECK (is_self IN (0,1)),
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_device_id TEXT NOT NULL,
  deleted_at           TEXT
);
CREATE UNIQUE INDEX ux_users_self ON users(is_self) WHERE is_self = 1;

-- Private address-book metadata. Never enters a shared document.
CREATE TABLE contacts (
  contact_id   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(user_id),
  display_name TEXT NOT NULL,
  avatar_uri   TEXT,
  device_id    TEXT REFERENCES devices(device_id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
);

-- --------------------------------------------------------------------------
-- Reference data. Two taxonomies, each hierarchy-ready.
-- --------------------------------------------------------------------------
CREATE TABLE product_categories (
  category_id          TEXT PRIMARY KEY,
  category_name        TEXT NOT NULL,
  parent_category_id   TEXT REFERENCES product_categories(category_id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_device_id TEXT NOT NULL,
  deleted_at           TEXT
);

CREATE TABLE store_categories (
  category_id          TEXT PRIMARY KEY,
  category_name        TEXT NOT NULL,
  parent_category_id   TEXT REFERENCES store_categories(category_id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_device_id TEXT NOT NULL,
  deleted_at           TEXT
);

CREATE TABLE stores (
  store_id             TEXT PRIMARY KEY,
  store_name           TEXT NOT NULL,
  store_category_id    TEXT REFERENCES store_categories(category_id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_device_id TEXT NOT NULL,
  deleted_at           TEXT
);

CREATE TABLE products (
  product_id           TEXT PRIMARY KEY,
  product_name         TEXT NOT NULL,
  product_category_id  TEXT REFERENCES product_categories(category_id),  -- v1 FK bug fixed
  std_metric           TEXT NOT NULL DEFAULT 'unit',
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_device_id TEXT NOT NULL,
  deleted_at           TEXT
);

CREATE TABLE payment_modes (
  payment_mode_id      TEXT PRIMARY KEY,
  payment_mode_name    TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_device_id TEXT NOT NULL,
  deleted_at           TEXT
);

-- --------------------------------------------------------------------------
-- Groups. A 1:1 relationship is a group with two members and is_pair = 1.
-- --------------------------------------------------------------------------
CREATE TABLE groups (
  group_id             TEXT PRIMARY KEY,
  group_name           TEXT NOT NULL,
  is_pair              INTEGER NOT NULL DEFAULT 0 CHECK (is_pair IN (0,1)),
  is_private           INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0,1)),
  default_currency     TEXT NOT NULL CHECK (length(default_currency) = 3),
  crdt_doc_id          TEXT NOT NULL UNIQUE REFERENCES crdt_docs(crdt_doc_id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_device_id TEXT NOT NULL,
  deleted_at           TEXT
);

CREATE TABLE group_members (
  group_id             TEXT NOT NULL REFERENCES groups(group_id),
  user_id              TEXT NOT NULL REFERENCES users(user_id),
  role                 TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at            TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_device_id TEXT NOT NULL,
  deleted_at           TEXT,
  PRIMARY KEY (group_id, user_id)
);

-- --------------------------------------------------------------------------
-- Transactions.
--   detail_level answers requirement 1: a statement-only expense is
--   HEADER_ONLY with zero lines; attaching a receipt later promotes it to
--   PARTIAL or ITEMIZED without changing its identity or its existing splits.
--   sum(lines.line_amount) <= header.total_amount is LEGAL. The difference is
--   the unitemized remainder and is splittable at header scope.
-- --------------------------------------------------------------------------
CREATE TABLE transaction_header (
  trxn_id              TEXT PRIMARY KEY,
  group_id             TEXT NOT NULL REFERENCES groups(group_id),
  payer_user_id        TEXT NOT NULL REFERENCES users(user_id),
  store_id             TEXT REFERENCES stores(store_id),
  payment_mode_id      TEXT REFERENCES payment_modes(payment_mode_id),
  trxn_date            TEXT NOT NULL,
  description          TEXT,
  total_amount         INTEGER NOT NULL CHECK (total_amount >= 0),   -- minor units
  currency             TEXT NOT NULL CHECK (length(currency) = 3),
  detail_level         TEXT NOT NULL DEFAULT 'HEADER_ONLY'
                         CHECK (detail_level IN ('HEADER_ONLY','PARTIAL','ITEMIZED')),
  source_type          TEXT NOT NULL DEFAULT 'MANUAL'
                         CHECK (source_type IN ('MANUAL','RECEIPT_OCR','STATEMENT_IMPORT')),
  source_reference     TEXT,
  reconciled_entry_id  TEXT REFERENCES statement_entries(entry_id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_device_id TEXT NOT NULL,
  deleted_at           TEXT
);
CREATE INDEX ix_trxn_date  ON transaction_header(trxn_date);
CREATE INDEX ix_trxn_group ON transaction_header(group_id, trxn_date);
CREATE INDEX ix_trxn_payer ON transaction_header(payer_user_id);

CREATE TABLE transaction_lines (
  line_id              TEXT PRIMARY KEY,
  trxn_id              TEXT NOT NULL REFERENCES transaction_header(trxn_id) ON DELETE CASCADE,
  line_no              INTEGER NOT NULL,
  product_id           TEXT REFERENCES products(product_id),
  product_name         TEXT NOT NULL,
  quantity_num         INTEGER NOT NULL DEFAULT 1,      -- 1.5 kg is stored as 3/2
  quantity_den         INTEGER NOT NULL DEFAULT 1 CHECK (quantity_den > 0),
  metric               TEXT NOT NULL DEFAULT 'unit',
  unit_price           INTEGER,                          -- minor units, header currency
  line_amount          INTEGER NOT NULL CHECK (line_amount >= 0),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_device_id TEXT NOT NULL,
  deleted_at           TEXT,
  UNIQUE (trxn_id, line_no)
);
CREATE INDEX ix_lines_trxn ON transaction_lines(trxn_id);

-- --------------------------------------------------------------------------
-- Splits.
--   scope_key = COALESCE(line_id, trxn_id) and is the CRDT splitSets key.
--   UNIQUE(scope_key, debtor_id) enforces one share per person per scope,
--   matching the atomic split-set model exactly.
--   weight_num/weight_den express partial item shares (requirement 2):
--   "Alice takes a third of the wine" is 1/3, not 0.3333.
--   There is no is_settled column. Settlement is derived.
-- --------------------------------------------------------------------------
CREATE TABLE expense_splits (
  split_id             TEXT PRIMARY KEY,
  trxn_id              TEXT NOT NULL REFERENCES transaction_header(trxn_id) ON DELETE CASCADE,
  line_id              TEXT REFERENCES transaction_lines(line_id) ON DELETE CASCADE,
  scope_key            TEXT NOT NULL,
  debtor_id            TEXT NOT NULL REFERENCES users(user_id),
  owed_amount          INTEGER NOT NULL CHECK (owed_amount >= 0),   -- minor units
  currency             TEXT NOT NULL CHECK (length(currency) = 3),
  split_mode           TEXT NOT NULL CHECK (split_mode IN ('EQUAL','EXACT','PERCENT','SHARES')),
  weight_num           INTEGER NOT NULL DEFAULT 1,
  weight_den           INTEGER NOT NULL DEFAULT 1 CHECK (weight_den > 0),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_device_id TEXT NOT NULL,
  deleted_at           TEXT,
  CHECK (scope_key = COALESCE(line_id, trxn_id)),
  UNIQUE (scope_key, debtor_id)
);
CREATE INDEX ix_splits_trxn   ON expense_splits(trxn_id);
CREATE INDEX ix_splits_debtor ON expense_splits(debtor_id);

-- --------------------------------------------------------------------------
-- Settlements. Event-sourced, many-to-many against splits, so one payment can
-- clear splits across several groups at once. This is the mechanism behind
-- requirement 5: settling in the chat screen and seeing it in the group are
-- the same rows, not a synchronisation.
-- --------------------------------------------------------------------------
CREATE TABLE settlements (
  settlement_id        TEXT PRIMARY KEY,
  from_user_id         TEXT NOT NULL REFERENCES users(user_id),
  to_user_id           TEXT NOT NULL REFERENCES users(user_id),
  amount               INTEGER NOT NULL CHECK (amount > 0),
  currency             TEXT NOT NULL CHECK (length(currency) = 3),
  settled_at           TEXT NOT NULL,
  method               TEXT,
  note                 TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_device_id TEXT NOT NULL,
  deleted_at           TEXT,
  CHECK (from_user_id <> to_user_id)
);
CREATE INDEX ix_settlements_parties ON settlements(from_user_id, to_user_id, settled_at);

CREATE TABLE settlement_allocations (
  allocation_id        TEXT PRIMARY KEY,
  settlement_id        TEXT NOT NULL REFERENCES settlements(settlement_id) ON DELETE CASCADE,
  split_id             TEXT NOT NULL REFERENCES expense_splits(split_id),
  amount               INTEGER NOT NULL CHECK (amount > 0),
  currency             TEXT NOT NULL CHECK (length(currency) = 3),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_device_id TEXT NOT NULL,
  deleted_at           TEXT,
  UNIQUE (settlement_id, split_id)
);
CREATE INDEX ix_alloc_split ON settlement_allocations(split_id);

-- --------------------------------------------------------------------------
-- Bank statements. Entirely absent from schema v1. Private: never shared.
--   source_row_hash + UNIQUE makes re-importing overlapping statement PDFs
--   idempotent, which real users will do constantly.
-- --------------------------------------------------------------------------
CREATE TABLE statement_entries (
  entry_id              TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(user_id),
  statement_date        TEXT NOT NULL,
  posted_date           TEXT,
  description           TEXT NOT NULL,
  amount                INTEGER NOT NULL,      -- minor units; negative = debit
  currency              TEXT NOT NULL CHECK (length(currency) = 3),
  balance_after         INTEGER,
  source_file_reference TEXT NOT NULL,
  source_row_hash       TEXT NOT NULL,
  matched_trxn_id       TEXT REFERENCES transaction_header(trxn_id),
  match_confidence      INTEGER CHECK (match_confidence BETWEEN 0 AND 100),
  match_status          TEXT NOT NULL DEFAULT 'UNMATCHED'
                          CHECK (match_status IN ('UNMATCHED','SUGGESTED','CONFIRMED','IGNORED')),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at            TEXT,
  UNIQUE (user_id, source_row_hash)
);
CREATE INDEX ix_stmt_unmatched ON statement_entries(match_status, statement_date);

-- --------------------------------------------------------------------------
-- OCR artefacts. Private: images and raw text never leave the device and
-- never enter a shared document. review_status gates writes into the ledger.
-- --------------------------------------------------------------------------
CREATE TABLE ocr_artifacts (
  artifact_id   TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('RECEIPT','STATEMENT')),
  file_uri      TEXT NOT NULL,
  file_hash     TEXT NOT NULL UNIQUE,
  raw_text      TEXT,
  parsed_json   TEXT,
  review_status TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (review_status IN ('PENDING','ACCEPTED','REJECTED')),
  trxn_id       TEXT REFERENCES transaction_header(trxn_id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

-- --------------------------------------------------------------------------
-- Exchange rates. Rational, not float. Conversion happens at read time and is
-- never stored on a transaction. Under strict local-only there is no rate
-- fetch: source is 'manual' (user-entered) or 'bundled' (shipped snapshot).
-- --------------------------------------------------------------------------
CREATE TABLE exchange_rates (
  rate_id       TEXT PRIMARY KEY,
  from_currency TEXT NOT NULL CHECK (length(from_currency) = 3),
  to_currency   TEXT NOT NULL CHECK (length(to_currency) = 3),
  rate_date     TEXT NOT NULL,
  rate_num      INTEGER NOT NULL CHECK (rate_num > 0),
  rate_den      INTEGER NOT NULL CHECK (rate_den > 0),
  source        TEXT NOT NULL CHECK (source IN ('manual','bundled')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (from_currency, to_currency, rate_date, source)
);

-- --------------------------------------------------------------------------
-- Derived views. Netting and debt simplification live in core/balance, not
-- here, so one implementation serves the chat screen and the group screen.
-- --------------------------------------------------------------------------
CREATE VIEW v_split_outstanding AS
SELECT s.split_id,
       s.trxn_id,
       s.line_id,
       h.group_id,
       s.debtor_id,
       h.payer_user_id AS creditor_id,
       s.currency,
       s.owed_amount,
       COALESCE(a.allocated, 0)                  AS settled_amount,
       s.owed_amount - COALESCE(a.allocated, 0)  AS outstanding_amount
FROM expense_splits s
JOIN transaction_header h ON h.trxn_id = s.trxn_id
LEFT JOIN (
    SELECT split_id, SUM(amount) AS allocated
    FROM settlement_allocations
    WHERE deleted_at IS NULL
    GROUP BY split_id
) a ON a.split_id = s.split_id
WHERE s.deleted_at IS NULL
  AND h.deleted_at IS NULL
  AND s.debtor_id <> h.payer_user_id;

CREATE VIEW v_directed_balance AS
SELECT creditor_id, debtor_id, currency, SUM(outstanding_amount) AS gross_amount
FROM v_split_outstanding
GROUP BY creditor_id, debtor_id, currency;
```

---

## 5. Screens

**Four** screens in the tab bar: **Home · Chat · Add · Groups**.

### 5.1 Home — `app/(tabs)/index.tsx`

- **One** period component, switchable Daily / Weekly / Monthly / Yearly. Requirement 8a is
  explicit that this is a single space-saving component, not four separate ones.
- Period spend total with a category breakdown beneath it.
- Owed / lent / net tiles, from `src/core/balance`.
- Recent activity list.

### 5.2 Chat — `app/(tabs)/chat.tsx`, thread at `app/chat/[userId].tsx`

- Contact list, WhatsApp style. Each row shows the **net** balance with that person, coloured by
  direction, summed across every group plus direct expenses.
- Thread: shared expenses and settlement events with that person, chronological.
- Settle-up action. Allocation is **oldest-outstanding-first** across `v_split_outstanding` for
  the pair, regardless of which group each split belongs to. This is why requirement 5's "settle
  here, reflects in the group" needs no extra code (ADR-006).

### 5.3 Add Expense — `app/(tabs)/add.tsx`

A full route with durable state, not a modal (ADR-012). Three steps on one screen:

1. **Details** — payer, group, date, amount, currency, store, payment mode.
2. **Items** — optional line items. Leaving this empty yields `detail_level = HEADER_ONLY`,
   which is the correct and expected state for a statement-only expense (requirement 1).
3. **Split** — opens `app/split/[trxnId].tsx`.

This screen also hosts the entry points for **Scan receipt** (Phase 7) and **Import statement**
(Phase 6), which is what makes those phases a screen extension rather than new navigation.

### 5.4 Groups — `app/(tabs)/groups.tsx`, detail at `app/groups/[groupId].tsx`

- Group list with per-group net position.
- Detail: members, expenses, per-member balances, simplified debts.
- Add member by QR (Phase 8).

### 5.5 Split editor — `app/split/[trxnId].tsx`

The product's differentiator. Per-line assignment with partial shares: tap an item, choose who
shares it, set weights as fractions. Header-scope split for the unitemized remainder. A live
**"remaining to allocate"** readout that must read exactly zero before Save enables.

### 5.6 Review — `app/review/[artifactId].tsx`

Mandatory gate for every OCR and import result (Phase 6, Phase 7). Editable draft of what was
extracted. Nothing reaches the ledger without passing through here.

---

## 6. Phases

Ten phases. Each ends with a **Verify** block. Do not start the next phase until it passes.

---

### Phase 0 — Restructure and bootstrap

Tag on completion: `v0.1.0-alpha.0`

- [x] **0.1** Create branch `build/v0.1.0` off `main`. (Current work sits on
      `hackathon/ethoxford`; do not build on top of it.)
- [x] **0.2** Untrack files that patterns already cover but git still tracks:
      `git rm --cached backend/.env backend/pauti.db backend/db/pauti.db "backend/{DB_PATH}"`
- [x] **0.3** Delete the `backend/{DB_PATH}` directory. It is a folder literally named after an
      unsubstituted template string — a bug artefact from `backend/app/models.py`.
- [x] **0.4** Move `backend/` to `ml/`. **Delete**: `app/routers/`, `app/database.py`,
      `main.py`, `schemas.py`, `app/services/split_logic.py`, `app/services/create_user.py`,
      `pauti.yml`, all `.db` files, all `__pycache__/`.
      **Keep**: `app/services/ocr_engine.py`, `app/services/ocr_llm.py`, `db/json_read.py`.
- [x] **0.5** Move fixtures to `ml/tests/fixtures/{receipts,bank-statements,extracts}/`.
      Confirm each destination is gitignored **before** moving anything.
- [x] **0.6** Move `backend/db/PautiUML.drawio` and `.png` to `docs/diagrams/` as
      `PautiUML-v1.*`. They depict the superseded schema; `architecture.md` already says so.
- [x] **0.7** Port design tokens out of `web/src/styles/variables.css` and
      `web/src/context/ThemeContext.jsx` into `src/ui/theme/`. **Then delete `web/`.** Also
      delete the empty `mobile/` and `shared/` directories.
- [x] **0.8** Initialise the Expo app. The repo root is not empty, so scaffold into a temporary
      directory and move the generated files in — do not run the scaffolder over existing files.
      TypeScript template, Expo Router.
- [x] **0.9** `npx expo prebuild`, then `npx expo run:android`. See §3.1 — this is required now,
      not at Phase 6.
- [x] **0.10** Create `CHANGELOG.md` (Keep a Changelog) with an `[Unreleased]` section carrying
      `Platforms: Android ✓ | iOS — | Web —`. Set `version` to `0.1.0` in `package.json` and
      `app.json`; set `android.versionCode` to `1`.
- [x] **0.11** Configure `tsconfig.json` path aliases for `src/*`, and `vitest.config.ts`
      scoped to `src/core/**`.

**Verify.** `git status` shows no `.db`, `.env`, `__pycache__`, or `node_modules`.
`git ls-files docs/` lists `plan/EXECUTE.md`. `git check-ignore --no-index` reports every path
under `ml/tests/fixtures/` as ignored. The Android dev build launches on a device or emulator
and renders the default route. `npx tsc --noEmit` and `npx vitest run` both exit zero.

---

### Phase 1 — Core domain, pure TypeScript

Tag: `v0.1.0-alpha.1` · Location: `src/core/` · No React, no SQLite, no I/O.

This is where the correctness that everything else depends on lives. Build it before anything
can call it.

- [x] **1.1** `src/core/money/` — minor-unit arithmetic, currency-aware formatting, and
      **deterministic remainder distribution**. Splitting 100 three ways gives 34/33/33 with a
      stable, reproducible rule for who absorbs the extra unit. Every device computes this
      independently from the same CRDT state, so the rule must not depend on iteration order,
      locale, or wall-clock time.
- [x] **1.2** `src/core/split/` — `EQUAL`, `EXACT`, `PERCENT`, `SHARES`, plus partial item shares
      as rationals (`weight_num`/`weight_den`). "Alice takes a third of the wine" is `1/3`,
      never `0.3333`.
- [x] **1.3** `src/core/balance/` — pair netting, roll-up across groups, multi-hop debt
      simplification.
- [x] **1.4** `src/core/reconcile/` — candidate matching on amount equality plus date proximity.
      Returns **scored candidates**, not a single answer; the caller decides what to do with a
      tie.

**Verify.** `npx vitest run` exits zero, including property-based tests asserting: (a) split
components always sum back to the scope total, for randomised amounts and participant counts;
(b) balances net to zero across all participants; (c) remainder distribution is identical under
input reordering.

---

### Phase 2 — SQLite read model

Tag: `v0.1.0-alpha.2` · Location: `src/db/`

- [x] **2.1** `src/db/schema.sql` — §4.3, verbatim. Do not edit it while transcribing; a change
      here is a STOP (§0.2).
- [x] **2.2** `src/db/migrations/` — forward-only runner writing to `schema_migrations`.
- [x] **2.3** `src/db/queries/` — typed helpers, one module per screen in §5. **No ad-hoc SQL in
      components.**
- [x] **2.4** A fixture dataset covering: a `HEADER_ONLY` statement expense; an `ITEMIZED`
      receipt with a partial item split; a three-person group; a pair; a settlement spanning two
      groups; a multi-currency expense.

**Verify.** Migrations apply cleanly from an empty database. The seeded database answers the
Home, Chat-list and Group-detail queries with numbers **identical** to what `src/core` derives
from the same fixtures.

---

### Phase 3 — CRDT layer and projector

Tag: `v0.1.0-alpha.3` · Location: `src/crdt/`, `src/db/projector.ts`

- [x] **3.1** **Spike first.** Confirm `yjs` loads and merges correctly under Hermes on the
      Android dev build before writing anything that depends on it. This is the plan's largest
      technical assumption (ADR-002). If it fails, STOP — do not work around it.
- [x] **3.2** `src/crdt/doc.ts` — the document schema from ADR-004: `meta`, `members`,
      `transactions`, `lines`, `splitSets` (atomic LWW register per scope), `settlements`
      (append-only).
- [x] **3.3** `src/crdt/write.ts` — the ownership-checked write API (ADR-005). Violations are
      **rejected with an error**, never silently merged.
- [x] **3.4** `src/db/projector.ts` — Yjs update to SQL rows, driven off `crdt_updates`. The only
      writer of derived tables (§0.1 rule 5).
- [x] **3.5** Full rebuild path: drop derived tables, replay the op-log, arrive at identical
      state.

**Verify.** A simulated three-device test in which concurrent edits applied in **different
orders** on each device converge to byte-identical SQLite state. Concurrent re-splits of one
bill still sum to the bill total. An ownership-violating write is rejected. Rebuild-from-log
reproduces the live database exactly.

---

### Phase 4 — Android app shell and the four screens

Tag: `v0.1.0-alpha.4`

- [x] **4.1** Expo Router tab navigator: Home · Chat · Add · Groups, themed from `src/ui/theme/`.
- [x] **4.2** Home (§5.1) — including the single switchable D/W/M/Y component.
- [x] **4.3** Chat list and thread (§5.2).
- [x] **4.4** Groups list and detail (§5.4).
- [x] **4.5** Add Expense shell (§5.3) — layout and navigation only; entry logic is Phase 5.
- [x] **4.6** `.web.ts` throwing stubs for `src/platform/ocr` and `src/platform/pdf` (§1.3).

All screens read real data through `src/db/queries/`.

**Verify.** The Android dev build runs all four screens against the Phase 2 fixture set, and
every displayed figure matches what `src/core` derives. `npx tsc --noEmit` exits zero.

**Known issue (cosmetic, not a Verify blocker — every figure is correct and legible).** List-row
labels clip in a few places: Home's recent-activity descriptions (`Expense` → `Expens`), Chat's
contact names (`carol` → `caro`), Groups' group names (`Trio` → `Tri`, `Alice & Bob` → `Alice &`).
The label `Text` in each row needs `flexShrink: 1` (and probably `numberOfLines={1}` with
`ellipsizeMode`) — currently only the amount `Text` is sized correctly. Affects
`app/(tabs)/index.tsx`, `app/(tabs)/chat.tsx`, `app/(tabs)/groups.tsx`. Fix whenever this is
picked back up; not worth a rebuild cycle on its own.

---

### Phase 5 — Entry, splitting and settlement

Tag: `v0.1.0-alpha.5`

- [ ] **5.1** Manual expense entry, all three steps of §5.3.
- [ ] **5.2** `app/split/[trxnId].tsx` — the item-level split editor with partial shares and the
      "remaining to allocate" readout (§5.5).
- [ ] **5.3** Header-level equal and unequal split, including the unitemized remainder.
- [ ] **5.4** Settle-up from the chat thread **and** from the group screen, both writing
      `settlements` + `settlement_allocations`.

**Verify.** End to end on device: create a group bill, split one item three ways unequally,
settle from the chat screen, and confirm the group screen reflects it **without a second
write**. Confirm an expense saved with no line items lands as `detail_level = HEADER_ONLY`.

---

### Phase 6 — Statement import and reconciliation

Tag: `v0.1.0-alpha.6` · **In scope for v0.1.0.**

Bank statements need no OCR. Typical bank PDFs carry a text layer, which
`expo-pdf-text-extract` reads natively via PDFBox on Android — fast and exact (ADR-009).

- [ ] **6.1** In `ml/`: develop the statement parser against the 3 fixture PDFs. Record the
      resulting field-level accuracy in `ml/README.md`.
- [ ] **6.2** `src/platform/pdf.ts` — text-layer extraction. `pdf.web.ts` throws.
- [ ] **6.3** `src/parse/statement.ts` — extracted text to structured draft. Port from the
      validated `ml/` parser.
- [ ] **6.4** CSV import as well as PDF. Most banks export CSV, and it is strictly more reliable
      than any parser.
- [ ] **6.5** Review screen (§5.6), then write to `statement_entries`. `source_row_hash` +
      the `UNIQUE` constraint make re-importing overlapping statements idempotent, which real
      users do constantly.
- [ ] **6.6** Reconciliation: `src/core/reconcile` links a statement entry to a transaction and
      sets `reconciled_entry_id` and `match_status`.

**Verify.** Golden-file tests over the 3 fixture statements with a recorded accuracy figure.
Importing the same statement twice creates no duplicate rows. A clear match links correctly; a
deliberately ambiguous pair is surfaced as `SUGGESTED` for the user rather than auto-matched.
Nothing reaches `statement_entries` without passing through review.

---

### Phase 7 — Receipt OCR (gated)

Tag: `v0.1.0-alpha.7` · **Inclusion in v0.1.0 is decided by the gate below.**

There is **no model to train or fine-tune.** ML Kit Text Recognition v2 is pretrained, free,
fully on-device, and covers Latin and Devanagari. The work here is parser engineering, and it is
bounded by the 14 fixture receipts (ADR-009).

- [ ] **7.0** **STOP — ask the user for the accuracy bar and the timebox** before starting.
      Record both in `architecture.md` under ADR-009.
- [ ] **7.1** Spike, within the timebox: `expo-mlkit-ocr` → `src/parse/receipt.ts`, evaluated
      against all 14 fixtures. Measure **line-item extraction accuracy** and write the number
      into ADR-009 whether it passes or fails.
- [ ] **7.2** **Gate.**
      - **Meets the bar** → finish: capture flow, review screen (§5.6), write to the ledger,
        link to a statement entry where one matches. Ships in v0.1.0.
      - **Misses the bar** → stop work here. Record the measured figure and the decision in
        ADR-009, note the deferral in `CHANGELOG.md`, ship manual entry, revisit in v0.2.0.
      - Either outcome: **Phase 8 proceeds.** This gate never blocks the release.

**Verify.** The measured accuracy figure is recorded in ADR-009 regardless of outcome. If
shipped: golden-file tests over the 14 fixtures, and no OCR result can reach the database
without passing review.

---

### Phase 8 — Local-only sync

Tag: `v0.1.0-alpha.8` · Location: `src/platform/transport/`, `src/platform/crypto/`

- [ ] **8.1** `crypto/` — libsodium device keypair and sync-file encryption.
- [ ] **8.2** `transport/qr.ts` — QR handshake for pairing.
- [ ] **8.3** `transport/file.ts` — encrypted sync-file export and import.
- [ ] **8.4** `transport/lan.ts` — LAN peer sync, Android implementation. All three sit behind
      one interface so a relay could replace them later without touching `src/crdt` (ADR-007).
- [ ] **8.5** Group invite and member-add over QR.

**Verify.** Two physical Android devices reach identical state over each transport with
**airplane mode on**. Confirm zero network egress by inspecting traffic — do not assume it
because no URL appears in the source.

---

### Phase 9 — Multi-currency, polish, release

Tag: `v0.1.0`

- [ ] **9.1** Read-time FX from `exchange_rates`; home-currency vs native-currency toggle.
- [ ] **9.2** Manual rate entry plus a bundled historical snapshot. **No rate fetch** — there is
      no network (ADR-007, ADR-008).
- [ ] **9.3** README with the local-first architecture write-up.
- [ ] **9.4** Move `CHANGELOG.md`'s `[Unreleased]` to `[0.1.0]` with the date and the platform
      matrix `Android ✓ | iOS — | Web —`. Tag `v0.1.0`.

**Verify.** A GBP expense displays correctly in INR at the transaction-date rate, and totals
reconcile across both display modes. A release build installs and runs on a clean device.

---

## 7. Requirements traceability

| Req | Mechanism | Phase |
|---|---|---|
| 1 — per-item and per-bill, tolerant of missing detail | `detail_level`; `sum(lines) <= total` legal; remainder splittable at header scope | 2, 5 |
| 2 — split, share, settle; item-level; equal/unequal; partial | `scope_key` + `split_mode` + `weight_num/den`; split editor §5.5 | 1, 5 |
| 3 — local only, CRDT | Yjs op-log; offline-only transports; no network code at all | 3, 8 |
| 4 — groups | `groups` / `group_members`; one Y.Doc per group | 2, 4 |
| 5 — 1:1 chat, group roll-up, settlement reflection | `is_pair` groups; balances derived from the same rows | 1, 5 |
| 6 — statement OCR | PDF text layer, no OCR needed; `statement_entries` | 6 |
| 7 — receipt OCR with linking | ML Kit → review → ledger; `reconciled_entry_id` | 7 (gated) |
| 8 — screens | Home, Chat, Groups (§5) + Add Expense (ADR-012) | 4, 5 |

---

## 8. Risks

- **Yjs under Hermes.** Pure JS, so it should be fine — but task 3.1 spikes it on a device
  before the projector depends on it. Cheap to test early, expensive to discover late.
- **Dev build required from day one.** Both native modules rule out Expo Go (§3.1). Handled by
  moving `expo prebuild` into Phase 0.
- **Receipt parser long tail, not model quality.** The risk is that crumpled real-world receipts
  need endless parser special-casing — not that the OCR model is weak. Phase 7's timebox and
  gate bound the exposure; the review screen means low accuracy degrades to "annoying" rather
  than "wrong data silently in your ledger".
- **Strict local-only sync will feel worse than Splitwise** for anyone not physically present.
  An accepted product cost of requirement 3, not a defect (ADR-007). The transport interface is
  the hedge.
- **No cross-device migration story yet.** Getting §4 right in Phase 2 is worth slowing down
  for. The nullable `parent_category_id` and settlements-as-events are cheap insurance already
  bought against expensive migrations later.
- **Fixtures are real personal financial documents** and the repo is intended to be public.
  They stay gitignored; see §0.1 rule 7.
