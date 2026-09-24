# Pauti — Architecture Decisions

Why Pauti is built the way it is. Read this before changing how data flows between devices.
The build sequence itself lives in [`plan/EXECUTE.md`](plan/EXECUTE.md); the product goals live
in [`REQUIREMENTS.md`](REQUIREMENTS.md).

---

## ADR-001 — CRDT op-log as source of truth, SQL as a materialised read model

**Status:** accepted

**Context.** Requirement 3 mandates CRDT-based splitting logic. The obvious approach — add
version columns to the SQLite tables and merge row by row — fails for the case that matters
most: two people re-splitting the same bill while offline. Row-level merging can produce a set
of shares that individually look reasonable and collectively sum to the wrong total.

**Decision.** The CRDT operation log is the source of truth. SQLite is a **disposable
materialised view** projected from it. Every derived table can be dropped and rebuilt by
replaying `crdt_updates`. The UI reads SQL; all writes go through the CRDT write API.

**Consequences.** A projector bug is fixed by rebuilding, not by migrating. Reads stay fast and
relational. The cost is a projector to maintain and the discipline that nothing writes to the
derived tables directly. This is the pattern Actual Budget and similar local-first apps use.

---

## ADR-002 — Yjs, not Automerge

**Status:** accepted — departs from the original design discussion

**Context.** The design review that shaped this project recommended Automerge. Automerge 2 is
Rust compiled to WebAssembly. React Native on Hermes has no usable WASM path, and the target
(ADR-003) is a single codebase spanning iOS, Android and web.

**Decision.** Use Yjs. It is pure JavaScript, runs identically under Hermes and in the browser,
and `Y.encodeStateAsUpdate` / `Y.applyUpdate` yield `Uint8Array` — exactly the shape the file
and QR transports need.

**Consequences.** This is a platform decision, not a disagreement about CRDT design; every
structural conclusion from that discussion still holds. Yjs's merge semantics differ from
Automerge's, so the document schema in ADR-004 is written against Yjs types specifically.
Revisit only if the platform target changes. Phase 3 spikes Yjs on a real device before
anything is built on top of it.

---

## ADR-003 — Expo / React Native + TypeScript, Android first

**Status:** accepted

**Context.** The project targets web, Android and iOS. Candidates considered: Flutter (no
JS-native CRDT, discards the existing React work), Tauri v2 (strongest local-first story, newest
and riskiest mobile toolchain), a web-only PWA (weakest on-device OCR).

**Decision.** Expo with React Native and `react-native-web`, in TypeScript. **Android is the
only target built and verified for v0.1.0.** iOS follows; web last.

**Consequences.** One codebase for all three targets. On-device SQLite via `expo-sqlite`. Yjs
runs natively in the JS runtime with no bridge. The existing design tokens in
`web/src/styles/variables.css` and `web/src/context/ThemeContext.jsx` carry over.

Two further consequences of the platform order:

- **Expo Go is not a supported workflow.** `expo-mlkit-ocr` and `expo-pdf-text-extract` are
  native modules, so the app needs a dev build — `expo prebuild` then `expo run:android`. This
  is done in Phase 0 rather than when Phase 6 first needs it, because retrofitting a build
  workflow onto an app that already exists is strictly more work than starting with one.
- **iOS needs no scaffolding.** The same `.ts` files serve it; it is simply not built yet.
  **Web needs throwing `.web.ts` stubs** for OCR, PDF extraction and LAN sync, so the gap is
  explicit and type-checked rather than a silent runtime failure. Web will be the weakest of the
  three targets for OCR — accepted.

---

## ADR-004 — One document per group; sharing granularity equals document granularity

**Status:** accepted

**Decision.** One `Y.Doc` per group. A 1:1 relationship is a group with two members and
`is_pair = 1`. Personal spending lives in a private document that is never shared.

Within a document: `splitSets` is an **atomic last-write-wins register per scope**, replaced
wholesale rather than merged field by field, so a concurrent re-split always yields one coherent
split. `settlements` is an **append-only array**, so settlement status is derived from events
rather than stored as a boolean that two offline devices can flip against each other.

**Consequences.** You can only ever share a document with people already entitled to see its
contents — privacy follows from the data layout rather than from access checks. Requirement 5
has exactly one code path instead of a parallel 1:1 implementation. Bank statements, receipt
images and OCR drafts never enter a shared document at all. Losing a concurrent re-split is
acceptable; producing an incoherent one is not.

---

## ADR-005 — Ownership rules make most conflicts impossible

**Status:** accepted

**Decision.** The payer's device owns a transaction's header, lines and split sets. Either party
may append a settlement event. Group metadata and membership are shared. Writes that violate
these rules are rejected locally with an error, never silently merged.

**Consequences.** Most fields have exactly one authoritative writer, so the CRDT only has to
resolve genuine multi-writer cases. Conflict handling becomes a narrow, testable surface rather
than a property of the whole schema.

---

## ADR-006 — Balances are derived, never stored

**Status:** accepted

**Decision.** Every balance — per contact, per group, per screen — is computed from
`expense_splits` minus `settlement_allocations`. `settlement_allocations` is many-to-many, so a
single payment can clear splits across several groups at once.

**Consequences.** This is the whole of requirement 5. A group expense appears in the 1:1 chat
view because it is the same rows viewed twice, and settling from the chat screen shows up in the
group because there is nothing to propagate. No reconciliation job, no cache invalidation, no
class of bug where two screens disagree.

---

## ADR-007 — Strict local-only sync in v1

**Status:** accepted, with a known product cost

**Context.** Requirement 3 says no data ever touches an API. The design review argued this is
incompatible with usable multi-device sync and should soften to "no server I operate ever sees
plaintext", using an end-to-end-encrypted relay.

**Decision.** Take requirement 3 literally for v1. Offline transports only: QR handshake,
encrypted sync-file export/import, and LAN peer sync. No relay, no rate fetch, no telemetry — no
network code in the app at all.

**Consequences.** Sync requires proximity or a deliberate file exchange, which is genuinely
worse than Splitwise for a housemate who is travelling. This is an accepted product cost, not a
defect. The mitigation is structural: transports sit behind a single interface, so adding an
encrypted relay later touches `platform/transport` and nothing else. The CRDT layer is already
transport-agnostic.

The visible knock-on is exchange rates: with no network there is no ECB feed, so rates are
user-entered or come from a snapshot bundled with the app.

---

## ADR-008 — Money is integer minor units; ratios are rationals

**Status:** accepted

**Decision.** All monetary amounts are integers in minor units, paired with a 3-letter ISO-4217
`currency` column. No floats. Quantities, split weights and exchange rates are stored as integer
`_num` / `_den` pairs.

**Consequences.** No currency is ever baked into a column name — schema v1's
`owned_amount_gbp` would have forced a migration across every user device the first time someone
wanted a different home currency. Conversion is derived at read time from `exchange_rates` and
never written onto a transaction, so "show me this in INR at the transaction-date rate" and
"…at today's rate" are both answerable from the same stored data. Rationals for rates exist so
that a design which bans floats for money cannot smuggle them back in through conversion.

Remainder distribution (splitting 100 three ways) must be deterministic and identical on every
device, since each device computes it independently from the same CRDT state.

---

## ADR-009 — Native OCR with deterministic parsers and mandatory review

**Status:** accepted; receipt OCR gated on a measurement (see below)

**Context.** The existing prototype (`ocr_llm.py`) pipes Tesseract output through a local Llama
model via Ollama, and the initial assumption was that on-device extraction would mean training
a model from scratch or fine-tuning an existing one. **It does not.** ML Kit Text Recognition v2
is pretrained, free, fully on-device, and covers Latin and Devanagari; `expo-mlkit-ocr` exposes
it to Expo. There is no model work in this project.

**Decision.** ML Kit text recognition on native, feeding deterministic parsers, with a
**mandatory human review screen** before anything reaches the ledger. No on-device LLM in v1.

Statements and receipts are separated, because their costs are not comparable:

- **Bank statements bypass OCR entirely.** Typical bank PDFs carry a text layer;
  `expo-pdf-text-extract` reads it natively (PDFBox on Android, PDFKit on iOS) in roughly 100 ms
  for ten pages, and the result is exact rather than recognised. CSV export, which most banks
  offer, is more reliable still. **In scope for v0.1.0.**
- **Receipts are gated.** The recognition step is solved; the unbounded part is parser
  engineering against the long tail of crumpled, folded, thermal-faded real receipts.

**The gate.** Phase 7 spikes the `expo-mlkit-ocr` → `src/parse/receipt.ts` pipeline against the
14 receipt fixtures within an agreed timebox and measures line-item extraction accuracy. Meets
the bar → ship in v0.1.0. Misses → ship manual entry and defer to v0.2.0. Either way Phase 8
proceeds; the gate never blocks the release. The user sets the bar and the timebox at Phase 7
start.

> Measured line-item accuracy: **98.7%** (75/76 line items correctly extracted across the 14
> receipt fixtures; 14/14 totals matched exactly). Bar: **90%** line-item extraction accuracy
> across the 14 receipt fixtures. Timebox: **1–2 hours** for the spike. Set by the user at Phase 7
> start, 2026-09-22. **Outcome: met the bar.** Flat OCR text interleaves an item's name and price
> out of row order (ML Kit splits them into separate name-column and price-column blocks), so
> `src/parse/receipt.ts` pairs each money-pattern line to its row label by bounding-box y-proximity
> instead of text adjacency. One item (of 76) was mispaired with a neighbouring row's price.
> Phase 7 proceeds to task 7.2: capture flow, review screen, ledger write, statement linking.

**Consequences.** Smaller app, predictable performance, testable parsers with a golden-file
corpus and a measurable accuracy figure. Extraction quality will be lower than an LLM's; the
review screen means that degrades to "annoying" rather than "wrong data silently in your
ledger". The Ollama prototype survives in `ml/` as an offline labelling aid for building
fixtures — it does not ship.

---

## ADR-010 — Retire the FastAPI backend

**Status:** accepted

**Context.** `backend/` contained a FastAPI server with routers, SQLAlchemy models and an
`/expenses` HTTP API — an architecture in direct contradiction with a local-first app. It
predates the local-first decision.

**Decision.** Delete the server. Keep the OCR and parsing Python as an offline research lab
under `ml/`, together with the receipt and statement fixtures.

**Consequences.** The repository no longer implies a server to anyone reading it, including
coding agents. The Python work that has real value — parser development and fixture evaluation —
is kept and honestly named. The fixtures are real personal financial documents and stay
gitignored.

---

## ADR-011 — One repository, one version, platform support as a separate axis

**Status:** accepted

**Context.** With three platform targets, the obvious-looking options are separate repositories
or git submodules per platform, and a version number that encodes which platform a release is
for ("v0.1.0 is the Android one").

**Decision.** One repository, no submodules. One `version` field shared by `package.json` and
`app.json`. `android.versionCode` and `ios.buildNumber` increment independently, because the
app stores require monotonic per-platform build numbers and have nothing to do with each other.
Platform support is recorded as a matrix line in `CHANGELOG.md`:
`Platforms: Android ✓ | iOS — | Web —`.

**Consequences.** Submodules were rejected because they solve a problem this project does not
have: with Expo there is **one source tree**, and the platforms are build outputs, not
components. Submodules would add cross-repo version pinning to a codebase with nothing to pin.

The version number describes the **feature set**, not the platform. v0.1.0 means "every phase in
EXECUTE.md complete", and it happens to be verified on Android. When iOS is later verified, that
is a CHANGELOG entry at whatever version is current — no version is reserved for a platform in
advance. Encoding platforms in versions would mean a bug fix shipped to two platforms needs two
version numbers, which is a mess that compounds.

`src/core` is the only part with a plausible future as an extracted package, and not before
v1.x. It is kept import-free of React, SQLite and I/O partly for that reason, but mostly because
that is what makes it testable.

---

## ADR-012 — Add Expense is a screen, not a modal

**Status:** accepted

**Context.** The original plan had three tabs with expense entry as a modal, which is the
conventional shape.

**Decision.** Four tabs: Home · Chat · **Add** · Groups. Add Expense is `app/(tabs)/add.tsx`, a
full route with durable state.

**Consequences.** It is the app's highest-frequency action, and its flow is long — details, then
optional line items, then a split step that opens a separate editor. Modal lifetime is the wrong
fit for that: a dismissed modal loses a half-entered bill, and nesting the split editor inside a
modal makes navigation awkward on Android where the back gesture is ambiguous.

It also becomes the natural host for the **Scan receipt** and **Import statement** entry points,
which is what makes Phases 6 and 7 a screen extension rather than new navigation. The cost is
one more tab, which requirement 8 does not forbid — it specifies what the three listed screens
must contain, not that there may be no others.

---

## ADR-013 — EXECUTE.md is a build script; rationale lives here

**Status:** accepted

**Context.** `docs/plan/EXECUTE.md` is executed by a different model than the one that wrote it,
phase by phase across separate sessions. A document that mixes instruction with rationale
invites the executor to re-litigate decisions mid-build rather than carry them out.

**Decision.** EXECUTE.md states *what to build* and *how to know it worked* — paths, tasks,
acceptance criteria, verify blocks. Every *why* is an ADR in this file, cited by number.

**Consequences.** Edits land in the right file: a change to how something is built goes to
EXECUTE.md, a change to why goes here. EXECUTE.md's §0 contract can then be short and literal —
a STOP list, one phase per session, an explicit definition of done — because it does not have to
argue for anything. The duplication risk is real and the rule is one-directional: rationale may
be summarised in a single clause in EXECUTE.md with an ADR reference, never restated in full.

---

## Superseded

`docs/diagrams/PautiUML-v1.drawio` depicts schema v1. It is retained for history only. The
current schema is §4.3 of [`plan/EXECUTE.md`](plan/EXECUTE.md); §4.1 of that document lists
every defect in v1 and its fix.
