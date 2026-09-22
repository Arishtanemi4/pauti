# ml/ — parser R&D

Python lab for developing and validating parsers against the fixture documents in
`ml/tests/fixtures/` before their logic is ported to TypeScript under `src/parse/`. Nothing
here ships; see `docs/plan/EXECUTE.md` §2 and §6.

Fixtures are real personal financial documents and are gitignored (`ml/tests/fixtures/{receipts,
bank-statements,extracts}/`). Scripts in this directory must never print their contents, and any
intermediate extraction output they write belongs under `ml/tests/fixtures/extracts/`, not
committed.

## Statement parser (Phase 6, task 6.1)

`statement_parser_dev.py` develops the algorithm ported to `src/parse/statement.ts`: split
PDFBox/`pdfplumber`-style linear text (line breaks, no column coordinates — this is what
`expo-pdf-text-extract` actually hands the app at runtime) into dated transaction rows, then
resolve each row's paid-in/paid-out sign against the statement's own printed running balance.

It self-validates against the statement's own summary numbers (OpeningBalance / Payments In /
Payments Out / ClosingBalance, and every "BALANCE CARRIED/BROUGHT FORWARD" checkpoint at page
breaks) rather than a hand-transcribed ground truth, so fixture content never has to be copied
out of the PDFs to check the parser's work.

**Algorithm.**

1. Group lines into transactions: a line beginning `DD Mon YY` starts one; continuation lines
   accumulate description text until a line ends in one or two trailing amount figures, which
   closes it (one figure = paid amount only; two = paid amount + running balance).
2. A repeated `Date Payment type and details ...` heading re-opens the table on a new page.
   `BALANCE CARRIED FORWARD` (page end) closes it again; `BALANCE BROUGHT FORWARD` (page start,
   restating the running balance) does not — transactions continue immediately below it with no
   date prefix of their own.
3. Sign resolution: transactions between two known balance checkpoints form a batch. If the
   batch's total magnitude matches the checkpoint delta, every entry in the batch shares that
   delta's sign (the common case — one transaction per checkpoint). Where several transactions
   share a date and only the last carries a balance, an exact subset-sum search over the batch
   (batches are a handful of entries; brute force is fine) finds the unique sign assignment
   reproducing the delta — this is what correctly separates a same-day credit from several
   debits. A batch with more than one subset-sum solution (e.g. two transactions of the same
   amount, either of which could be the credit) is left unresolved and flagged.

**Measured accuracy**, run 2026-09-22 against the 3 fixture statements (`python
ml/statement_parser_dev.py`):

| Statement | Entries | Sign-unresolved | Paid-in/out totals match | Closing balance matches |
|---|---|---|---|---|
| 2025-10-21 | 7 | 0 | yes | yes |
| 2025-11-21 | 65 | 0 | yes | yes |
| 2025-12-21 | 49 | 5 (one batch, two equal-valued same-day entries) | no | yes |

Aggregate: **116/121 entries (95.9%)** resolve automatically with a checkpoint-verified sign;
every statement's closing balance reconciles exactly. The one unresolved batch is a genuine
ambiguity in the source document (two transactions of the same amount on the same day, only one
of which is the credit) rather than a parser defect — it is exactly the case the mandatory
review screen (`docs/plan/EXECUTE.md` §5.6) exists for. Unlike Phase 7, Phase 6 has no accuracy
gate; this figure is recorded for visibility, not as a go/no-go bar.

A handful of short (1-2 character) page-furniture artifacts per statement (running total: 4
across the 3 fixtures) are recognised and dropped rather than mis-parsed as transactions.
