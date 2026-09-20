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
