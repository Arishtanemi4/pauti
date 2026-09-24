# Receipt OCR

Status: **shipping in v0.1.0** (Phase 7 gate passed — see [ADR-009](../architecture.md#adr-009--native-ocr-with-deterministic-parsers-and-mandatory-review)).
Last measured: 2026-09-24.

This document covers the receipt-scanning pipeline only. Bank statement import
(`src/parse/statement.ts`) does not use OCR — statement PDFs carry a text layer, read directly
via `expo-pdf-text-extract` — and is out of scope here.

---

## 1. TL;DR

- Text recognition is **ML Kit Text Recognition v2**, a pretrained Google model running fully
  on-device. Nobody trained or fine-tuned a model for this project — there is no model work here,
  only parser engineering around a fixed third-party model.
- `src/platform/ocr.ts` calls it via `expo-mlkit-ocr` and returns the full result, bounding boxes
  included.
- `src/parse/receipt.ts` turns that result into a structured draft (store, date, total, line
  items) using the bounding boxes, not the flattened text — see §3 for why.
- Measured **98.7% line-item accuracy** (75/76) across the 14 real fixture receipts, against a
  90% bar the user set. **Nothing reaches the ledger without passing through a mandatory human
  review screen first** — that screen, not the parser's precision, is what actually keeps bad
  extractions out of the ledger (§6).

---

## 2. Pipeline

```
 camera / picker            expo-mlkit-ocr              src/parse/receipt.ts         review screen
┌───────────────┐        ┌────────────────────┐        ┌──────────────────┐        ┌───────────────┐
│  receipt image │ ─uri──▶│ ML Kit Text Rec. v2 │ ─────▶ │  parseReceiptOcr  │ ─────▶ │ human edits,  │ ─────▶ ledger
│                │        │  (on-device, native) │ result │  (pure function)  │  draft │ confirms      │  write
└───────────────┘        └────────────────────┘        └──────────────────┘        └───────────────┘
```

- **Recognition** (`src/platform/ocr.ts`): native only. `ocr.web.ts` throws — receipt scanning
  isn't available on web (ADR-003, ADR-009).
- **Parsing** (`src/parse/receipt.ts`): pure, synchronous, no I/O, no React, no SQLite. Same
  shape of module as `src/parse/statement.ts`.
- **Review** (`app/review/[artifactId].tsx`, §5.6 in `EXECUTE.md` — not yet built, task 7.2):
  the *only* path from a parsed draft into the ledger. This is a hard architectural rule, not a
  suggestion — see ADR-009.

---

## 3. How recognition works

`expo-mlkit-ocr`'s `recognizeText(uri)` returns:

```ts
interface RecognitionResult {
  text: string;                 // the whole thing, flattened, reading-order-ish
  blocks: TextBlock[];
}
interface TextBlock  { text: string; boundingBox: Box; lines: TextLine[] }
interface TextLine   { text: string; boundingBox: Box; elements: TextElement[] }
interface TextElement{ text: string; boundingBox: Box }
interface Box { x: number; y: number; width: number; height: number }
```

ML Kit groups recognised text into spatial **blocks** — roughly, clusters of nearby lines — before
flattening it all into `.text`. On this receipt template, an item's name (left-aligned) and its
price (right-aligned, separated by a wide gap) sit on the **same visual row**, but because the
gap is wide and consistent, ML Kit puts every item *name* into one block and every item *price*
into a separate block. `.text` then interleaves two independently-ordered columns, so a
same-line regex over flat text (the original approach) reconstructs nothing — it was measured at
**0% line-item extraction** before this was diagnosed.

The fix: `src/parse/receipt.ts` ignores `.text` entirely and works from `blocks[].lines[]`,
each of which carries its own `boundingBox`. Row membership is reconstructed from geometry
instead of assumed from text order.

---

## 4. How parsing works (`src/parse/receipt.ts`)

1. **Flatten.** Every line from every block becomes `{ text, x, yCenter, height }`
   (`flattenLines`). Block boundaries are discarded — only geometry survives.
2. **Split into money lines and label lines.** `MONEY_LINE_RE` (`/^(-?\d+\.\d{2})(?:\s*[A-Z])?$/`)
   matches a line that is *only* a price, optionally followed by a VAT-rate letter (this receipt
   template prints each price as its own OCR line). Everything else is a candidate label.
3. **Pair each money line with its row.** `findRowLabel` picks the nearest label line that sits
   to its *left* (`label.x < money.x`) and within a height-scaled y-tolerance
   (`0.75 × max(line heights)`) — i.e. "the closest text roughly on the same row, to the left".
   This is a **greedy nearest-neighbour** match, not a global optimum (see §5 for what that
   costs).
4. **Classify the pair:**
   - Label reads `TOTAL` → that money value is `totalMinorUnits` (first match wins).
   - Label matches a stoplist of receipt furniture — `total`, `card`, `cash`, `change`,
     `subtotal`, `sales`, `vat`, `amount`, `discount`, `price cut`, `copy`, `verified`,
     `contactless`, `auth`, `approved` — or a bare VAT-rate code (`A`, `0 %`, `B 20 %` — this
     receipt template prints a VAT-rate breakdown table in the same left column as items) →
     dropped.
   - Money value is negative → dropped (e.g. a "Price Cut" discount line adjusting the item
     above it — not a line item of its own).
   - Otherwise → a line item. The label text has any trailing SKU digit-run stripped
     (`PRODUCT_CODE_RE`, e.g. a trailing `0082706`) and becomes the item name.
5. **Store name and date** are found independently by scanning the flattened lines for `lidl`
   (case-insensitive, anywhere) and a `Date: DD/MM/YY` line — these don't depend on row-pairing.

None of this is a model. It's a deterministic function: same `RecognitionResult` in, same
`ParsedReceipt` out, every time — which is exactly why it's unit-testable (§9) and why "training"
doesn't apply to it (§5).

---

## 5. "How it was trained" — it wasn't (and what was)

**The recognition model (ML Kit Text Recognition v2) is not trained, fine-tuned, or touched by
this project.** It's a fixed, pretrained, closed-weights model shipped by Google inside ML Kit.
`expo-mlkit-ocr` exposes it; nothing in this repo adjusts its weights, and the on-device SDK does
not expose a training or fine-tuning API. This was a deliberate decision (ADR-009): no on-device
LLM, no model training, in v1.

**The parser (`src/parse/receipt.ts`) is hand-written, not learned** — it's the regexes and
geometry rules in §4, arrived at by inspecting real OCR output against real receipts, not by
fitting parameters to data.

**What *did* involve a model** is a separate, unshipped prototype in `ml/app/services/`:
`ocr_engine.py` (Tesseract + regex, an earlier discarded attempt) and `ocr_llm.py`
(Tesseract → a local Llama model via Ollama, prompted to extract the same JSON shape
`parseReceiptOcr` produces). `ocr_llm.py` is what generated
`ml/tests/fixtures/extracts/all_receipts.json` — **the ground truth this whole document's
accuracy figure is measured against.** It survives in `ml/` only as an offline labelling aid used
once to build that fixture file; it does not ship, is not called from the app, and was never
itself validated against the app's flow. See the caveat in §6.

---

## 6. How accuracy was measured

**Corpus:** all 14 real receipt images in `ml/tests/fixtures/receipts/` — one store, one
receipt template (Lidl UK, digital/emailed receipts, not photographed paper). This is a small,
narrow sample, not a representative cross-section of "the long tail of crumpled, folded,
thermal-faded real receipts" that ADR-009 explicitly calls the unbounded, unsolved part of this
problem.

**Ground truth:** `ml/tests/fixtures/extracts/all_receipts.json`, one record per receipt with
`store_name`, `date`, `total_amount`, and an `items[]` array of `{ name, price }`. **Important
caveat:** this file was itself produced by `ocr_llm.py` (§5) — a different OCR+LLM pipeline, not
manually transcribed from the physical receipts by a human. It is the best label set available,
not an independently verified one. The reported accuracy is therefore *agreement with an
LLM-generated label set*, which is a reasonable proxy but not a ground truth in the strict sense.

**Method:** for each receipt, sort the ground-truth items' prices and the parsed items' prices
(both in integer minor units — no float comparison), then greedily match parsed prices to
ground-truth prices one-for-one. A ground-truth item counts as extracted if some parsed item has
the exact same price and hasn't already been claimed by an earlier match. This matches on
**price only, not on name text** — item names in the ground truth are normalised differently
(e.g. parenthesised weights) than the parser's stripped-SKU names, and price is the value that
actually needs to be correct for the ledger.

**Result, across all 14 fixtures:**

| Metric | Value |
|---|---|
| Line items in ground truth | 76 |
| Line items correctly extracted | 75 |
| Recall (extracted / ground truth) | 98.7% |
| Precision (extracted / all parsed) | 98.7% |
| F1 | 98.7% |
| Receipt totals matched exactly | 14 / 14 (100%) |
| Receipts with zero item errors | 13 / 14 |

Bar set by the user at Phase 7 start (2026-09-22): **90%** line-item extraction accuracy,
timeboxed to **1–2 hours**. **98.7% clears the bar.** Full detail, including the pre-fix 0%
baseline and the diagnosis that led to the bounding-box rewrite, is in ADR-009.

The per-receipt breakdown and the raw OCR output used to compute this table are **not** in this
repository — they're derived from the private fixture receipts and were kept in a local
scratch directory outside the repo, per the fixtures-privacy rule (§10).

---

## 7. Where it's failing

**Fixed during Phase 7** (historical, kept here so the failure mode isn't rediscovered):
flat-text parsing assumed same-line adjacency between an item's name and its price. ML Kit's
block segmentation breaks that assumption on this receipt template (§3) — the original parser
measured **0/76** before the bounding-box rewrite.

**Still present, 1 miss in 76:**

- **Row-pairing mismatch under vertical crowding.** `findRowLabel` (§4 step 3) is a *greedy*
  nearest-neighbour match — each money line independently claims the closest label within
  tolerance, with no global check that the resulting assignment is consistent. On one receipt,
  two rows sat closer together vertically than the `0.75 × height` tolerance could reliably
  separate, and an item's price was paired with the label from an adjacent row instead of its
  own. The item's *price* ended up attached to the *wrong name* — the price itself was still a
  real value from the receipt, just associated with the wrong row.
- **Character-level OCR misreads that don't touch price.** ML Kit occasionally confuses visually
  similar glyphs in a product name — a leading capital `O` read as digit `0`, for instance. Prices
  (pure digits and a decimal point) are far less ambiguous than mixed-case product names, so this
  class of error tends to corrupt the item *name* without affecting extraction accuracy as
  measured (price-only matching, §6) — but it does mean a name a user sees on the review screen
  won't always exactly match the receipt.
- **Single template, digital receipts only.** All 14 fixtures are one store's clean, digital
  receipt layout. Thermal print fading, creases, skew, and other stores' layouts (different
  column widths, multi-line item names, tax/discount table placement) are entirely untested —
  this 98.7% says nothing about how the parser behaves outside this template.
- **Ground truth uncertainty (§6).** Since the label set itself came from an LLM pipeline rather
  than manual verification, a small number of "correct" matches could in principle be two
  independent misreads of the same slightly-wrong value agreeing with each other. Not observed,
  but not ruled out either.

---

## 8. Getting to 99.99%

Straight talk: **99.99% is not a realistic target for the OCR+parser layer alone**, across an
open-ended set of real-world receipts, crumpled paper, faded thermal print, and unseen store
templates. Pretrained OCR has an irreducible error rate on degraded input, and receipt layouts
are not standardised. Chasing four nines here would mean re-litigating ADR-009's decision to
avoid an on-device LLM or custom-trained model, which was made deliberately.

What actually gets ledger data to near-100% correctness in this app is **the mandatory human
review screen** (§5.6, ADR-009) — every OCR result is edited/confirmed by the person who took
the photo before it touches the database. That's the real mechanism, not an aspirational parser
accuracy number. The extraction layer's job is to make review *fast* (most fields already right)
rather than to be perfect.

That said, concrete, bounded improvements to the extraction layer itself, roughly in order of
effort:

1. **Fix the greedy-matching failure mode (§7).** Replace per-money-line nearest-neighbour
   matching with a proper one-to-one assignment across all label/money candidates on nearby rows
   (e.g. minimum-cost bipartite matching on y-distance) so two close-together rows can't steal
   each other's pairing. This directly targets the one known miss in the current corpus.
2. **Grow the fixture corpus.** 14 receipts, one template, is enough to catch a systemic bug
   (which it did) but not enough to characterise real-world accuracy. Add receipts from other
   stores, paper (not digital) receipts, and deliberately degraded photos (skewed, creased,
   poorly lit) before trusting this number for anything beyond "the happy path works".
3. **Independently verify the ground truth.** Have a human check `all_receipts.json` (or a
   sample of it) against the actual receipt images, rather than relying solely on the `ocr_llm.py`
   label set (§6).
4. **Column-consistency checks.** Item prices on this template are right-aligned to a consistent
   x-position; a pass that verifies all matched money lines share a common right edge (within
   tolerance) would catch mispairings that pull a value from an unrelated column.
5. **Small, template-specific OCR-correction dictionary** for known glyph confusions
   (`0`/`O`, `1`/`I`/`l`, `5`/`S`) applied only to name text, never to money-pattern lines (where
   the stricter regex already limits ambiguity).
6. **Image preprocessing before recognition** — deskew, contrast normalisation, upscaling — for
   photographed (as opposed to digital) receipts, which this corpus doesn't yet include.

None of these need a different model or any training — they're refinements to the deterministic
parser and the input corpus, consistent with ADR-009's decision to keep this layer simple,
testable, and reviewed rather than "smart".

---

## 9. Testing status

**No automated tests exist for `src/parse/receipt.ts` yet.** This is a gap, not a decision — task
7.2 (building the capture flow, review screen, and ledger write) is expected to add golden-file
tests over the 14 fixtures per `EXECUTE.md`'s Phase 7 verify criterion, mirroring the existing
pattern for `src/parse/statement.ts` (`statement.test.ts`). Because the fixture receipts and their
ground truth are gitignored (§10), any such test needs to skip gracefully when the fixtures
aren't present locally (e.g. CI), rather than asserting against synthetic data that wouldn't
catch real-layout regressions.

`src/platform/ocr.web.ts`'s throwing stub *is* covered, in `src/platform/web-stubs.test.ts`.

---

## 10. Privacy: the fixtures are real personal data

`ml/tests/fixtures/receipts/` and `ml/tests/fixtures/extracts/` contain **real personal financial
documents** (actual purchases, actual dates, actual amounts) and are gitignored. Rules that apply
to anyone working in this area of the codebase:

- Never commit anything under those paths, or move them outside the gitignored location.
- Never paste their contents — item names, dates, totals, transaction numbers — into a commit
  message, a log, or a checked-in document. This document deliberately describes failure modes
  in generic terms (§7) rather than citing the specific items/dates involved.
- Any data *derived* from them at runtime (OCR text, parsed JSON, accuracy breakdowns) should be
  treated the same way — written to a local scratch location outside the repo, never committed,
  deleted once no longer needed.

---

## 11. File map

| File | Role |
|---|---|
| `src/platform/ocr.ts` | Native recognition. Calls `expo-mlkit-ocr`, returns the full `RecognitionResult`. |
| `src/platform/ocr.web.ts` | Web stub — throws, receipt scanning is native-only. |
| `src/parse/receipt.ts` | Pure parser: `RecognitionResult` → `ParsedReceipt`. No I/O. |
| `ml/app/services/ocr_llm.py` | Offline labelling aid (Tesseract + local Llama via Ollama). Not shipped. Produced the ground-truth fixture used in §6. |
| `ml/app/services/ocr_engine.py` | Earlier, discarded Tesseract+regex prototype. Not shipped, not used. |
| `ml/tests/fixtures/receipts/` | 14 real receipt images. Gitignored (§10). |
| `ml/tests/fixtures/extracts/all_receipts.json` | Ground truth for the 14 fixtures. Gitignored (§10). |
| `docs/architecture.md` — ADR-009 | The architectural decision, the gate, and the measured figure. |
| `docs/plan/EXECUTE.md` — Phase 7 | The task checklist this work is tracked against. |

---

## 12. Glossary

- **Block / line / element** — ML Kit's own hierarchy: a block is a cluster of nearby lines, a
  line is a line of text, an element is roughly a word. This parser only uses lines.
- **Row pairing** — reconstructing which name and which price belong on the same physical
  receipt row, using bounding-box geometry rather than text order (§3–4).
- **Rate-code label** — a VAT-rate table entry (`A`, `0 %`, `B 20 %`) that sits in the same
  left-hand column as item names but isn't an item (§4 step 4).
- **Line-item extraction accuracy** — the metric this whole document is about: the fraction of
  a receipt's real line items the parser correctly pulls out, measured by price match (§6).
- **The gate** — Phase 7's rule that the accuracy bar decides whether receipt OCR ships in
  v0.1.0 or is deferred, but never blocks the release either way (ADR-009).
