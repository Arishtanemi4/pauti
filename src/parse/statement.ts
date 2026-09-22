// Bank statement text/CSV -> structured draft (docs/plan/EXECUTE.md Phase 6, task 6.3/6.4).
// No React, no SQLite, no I/O — pure text in, draft entries out. Nothing here writes to
// statement_entries directly; everything returned is a draft for the review screen (§5.6) to
// accept or edit before it reaches the ledger.
//
// The PDF-text algorithm is ported from ml/statement_parser_dev.py, validated there against
// the 3 real fixture statements (ml/README.md). expo-pdf-text-extract hands the app plain
// text with no word coordinates (PDFBox/PDFKit), so parsing is line-based, matching what was
// validated in ml/.

export interface StatementDraftEntry {
  readonly date: string; // ISO-8601
  readonly description: string;
  /** Signed minor units: positive = credit (paid in), negative = debit (paid out). */
  readonly amountMinorUnits: number;
  readonly balanceAfterMinorUnits: number | null;
  /** False when the credit/debit sign could not be resolved with confidence — flag for review. */
  readonly signResolved: boolean;
}

export interface ParsedStatement {
  readonly entries: StatementDraftEntry[];
  readonly unresolvedCount: number;
}

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

const DATE_LINE_RE = /^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{2})\s*(.*)$/;
const TRAILING_AMOUNTS_RE = /^(.*?)\s*([\d,]+\.\d{2})(?:\s+([\d,]+\.\d{2}))?\s*$/;
const CARRIED_FORWARD_RE = /^BALANCE(CARRIED|BROUGHT)FORWARD\s*\.?\s*([\d,]+\.\d{2})$/;
const HEADER_LINE_RE = /^Date Payment type and details/;
const OPENING_BALANCE_RE = /OpeningBalance\s*£([\d,]+\.\d{2})/;
const FURNITURE_RE = /^[A-Za-z0-9.]{1,2}$/;

function toMinorUnits(text: string): number {
  return Math.round(parseFloat(text.replace(/,/g, '')) * 100);
}

function toIsoDate(day: string, mon: string, yr2: string): string {
  const year = 2000 + Number(yr2);
  return `${String(year).padStart(4, '0')}-${String(MONTHS[mon]).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`;
}

interface RawEntry {
  date: string;
  description: string;
  amountMinorUnits: number; // unsigned magnitude, as printed
  balanceAfterMinorUnits: number | null;
}

interface OpenTxn {
  date: string;
  desc: string[];
  amount: number | null;
  balance: number | null;
}

function closeIfAmounts(text: string): { prefix: string; amount: number; balance: number | null } | null {
  const m = TRAILING_AMOUNTS_RE.exec(text);
  if (!m) return null;
  const [, prefix, a1, a2] = m;
  return { prefix, amount: toMinorUnits(a1), balance: a2 !== undefined ? toMinorUnits(a2) : null };
}

/**
 * Groups linear statement text into dated transaction rows (step 1-2 of the ml/ algorithm):
 * a `DD Mon YY` line starts a transaction; continuation lines accumulate description text
 * until a line ends in 1-2 trailing amount figures. A repeated column heading re-opens the
 * table on a new page; `BALANCE CARRIED FORWARD` (page end) closes it, `BALANCE BROUGHT
 * FORWARD` (page start) does not, since transactions continue immediately below it.
 */
function groupIntoRawEntries(fullText: string): { entries: RawEntry[]; openingBalance: number | null } {
  const lines = fullText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const openingMatch = OPENING_BALANCE_RE.exec(fullText);
  const openingBalance = openingMatch ? toMinorUnits(openingMatch[1]) : null;

  const entries: RawEntry[] = [];
  let currentDate: string | null = null;
  let openTxn: OpenTxn | null = null;
  let inTable = false;

  const flush = () => {
    if (openTxn !== null && openTxn.amount !== null) {
      entries.push({
        date: openTxn.date,
        description: openTxn.desc.filter((p) => p.length > 0).join(' '),
        amountMinorUnits: openTxn.amount,
        balanceAfterMinorUnits: openTxn.balance,
      });
    }
    openTxn = null;
  };

  for (const raw of lines) {
    const line = raw.trim();

    const dateMatch = DATE_LINE_RE.exec(line);
    if (dateMatch) {
      const [, day, mon, yr, restRaw] = dateMatch;
      currentDate = toIsoDate(day, mon, yr);
      inTable = true;
      const rest = restRaw.trim();

      const cf = CARRIED_FORWARD_RE.exec(rest);
      if (cf) {
        flush();
        inTable = cf[1] === 'BROUGHT';
        continue;
      }
      if (rest === '') continue;

      flush();
      const closed = closeIfAmounts(rest);
      if (closed) {
        openTxn = { date: currentDate, desc: [closed.prefix], amount: closed.amount, balance: closed.balance };
        flush();
      } else {
        openTxn = { date: currentDate, desc: [rest], amount: null, balance: null };
      }
      continue;
    }

    if (HEADER_LINE_RE.test(line)) {
      inTable = true; // repeated column heading re-arms the table on a new page
      continue;
    }

    if (!inTable) continue; // header/account-summary boilerplate before the table starts

    const cf2 = CARRIED_FORWARD_RE.exec(line);
    if (cf2) {
      flush();
      inTable = cf2[1] === 'BROUGHT';
      continue;
    }

    if (currentDate === null) continue; // stray line before any transaction has started

    const closed = closeIfAmounts(line);
    if (openTxn === null) {
      if (closed) {
        openTxn = { date: currentDate, desc: [closed.prefix], amount: closed.amount, balance: closed.balance };
        flush();
      } else if (!FURNITURE_RE.test(line)) {
        openTxn = { date: currentDate, desc: [line], amount: null, balance: null };
      }
      // else: short page-furniture artifact (page letter/footer stray) — dropped.
    } else if (closed) {
      if (closed.prefix) openTxn.desc.push(closed.prefix);
      openTxn.amount = closed.amount;
      openTxn.balance = closed.balance;
      flush();
    } else {
      openTxn.desc.push(line);
    }
  }
  flush();

  return { entries, openingBalance };
}

/**
 * Returns the unique +/-1 sign assignment reproducing `target` within 1p, or null if there
 * are zero or multiple solutions. Batches are a handful of same-day entries, so brute force
 * over 2^n sign assignments is fine.
 */
function solveSigns(amounts: readonly number[], target: number): number[] | null {
  const n = amounts.length;
  if (n > 20) return null;
  let solution: number[] | null = null;
  for (let mask = 0; mask < 1 << n; mask++) {
    let total = 0;
    for (let j = 0; j < n; j++) {
      total += (mask >> j) & 1 ? amounts[j] : -amounts[j];
    }
    if (Math.abs(total - target) <= 1) {
      if (solution !== null) return null; // second solution found — genuinely ambiguous
      solution = Array.from({ length: n }, (_, j) => ((mask >> j) & 1 ? 1 : -1));
    }
  }
  return solution;
}

/**
 * Resolves each raw entry's credit/debit sign against the statement's own running balance
 * (step 3 of the ml/ algorithm). A batch is every entry between two known balance checkpoints;
 * most batches share one sign (checked against the checkpoint delta's magnitude), a minority
 * are genuinely mixed (e.g. a same-day credit among several debits) and need the exact
 * subset-sum search. A batch with no unique solution is left unresolved for manual review.
 */
function resolveSigns(rawEntries: readonly RawEntry[], openingBalance: number | null): ParsedStatement {
  const entries: StatementDraftEntry[] = [];
  let running = openingBalance ?? 0;
  let unresolvedCount = 0;

  let i = 0;
  while (i < rawEntries.length) {
    const batch: RawEntry[] = [rawEntries[i]];
    while (batch[batch.length - 1].balanceAfterMinorUnits === null && i + 1 < rawEntries.length) {
      i += 1;
      batch.push(rawEntries[i]);
    }
    const closingBalance = batch[batch.length - 1].balanceAfterMinorUnits;

    if (closingBalance === null) {
      // Last entry in the text with no trailing balance — cannot resolve.
      for (const e of batch) {
        entries.push({ ...e, amountMinorUnits: -e.amountMinorUnits, signResolved: false });
      }
      unresolvedCount += batch.length;
      i += 1;
      continue;
    }

    const delta = closingBalance - running;
    const amounts = batch.map((e) => e.amountMinorUnits);
    const totalMagnitude = amounts.reduce((a, b) => a + b, 0);

    let signs: number[];
    let resolved = true;
    if (Math.abs(Math.abs(delta) - totalMagnitude) <= 1) {
      signs = amounts.map(() => (delta > 0 ? 1 : -1));
    } else {
      const solved = solveSigns(amounts, delta);
      if (solved) {
        signs = solved;
      } else {
        signs = amounts.map(() => (delta > 0 ? 1 : -1)); // best-effort fallback
        resolved = false;
        unresolvedCount += batch.length;
      }
    }

    batch.forEach((e, idx) => {
      entries.push({ ...e, amountMinorUnits: signs[idx] * e.amountMinorUnits, signResolved: resolved });
    });
    running = closingBalance;
    i += 1;
  }

  return { entries, unresolvedCount };
}

/** Parses the plain text of a bank statement PDF (as handed back by src/platform/pdf.ts). */
export function parseStatementText(fullText: string): ParsedStatement {
  const { entries, openingBalance } = groupIntoRawEntries(fullText);
  return resolveSigns(entries, openingBalance);
}

const CSV_HEADER_ALIASES = {
  date: ['date', 'transaction date', 'posting date'],
  description: ['description', 'details', 'narrative', 'payment type and details', 'memo'],
  amount: ['amount'],
  debit: ['debit', 'paid out', 'money out', 'withdrawal'],
  credit: ['credit', 'paid in', 'money in', 'deposit'],
  balance: ['balance', 'running balance'],
} as const;

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

function findColumn(headers: string[], aliases: readonly string[]): number {
  return headers.findIndex((h) => aliases.includes(h.trim().toLowerCase()));
}

function csvAmountToMinorUnits(text: string): number | null {
  const trimmed = text.trim().replace(/,/g, '').replace(/^£|^\$|^€/, '');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** ISO passes through; `DD/MM/YYYY` (the common UK bank export format) is converted. Anything
 * else is left as-is for the review screen's editable date field to fix by hand. */
function normalizeCsvDate(text: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (m) {
    const [, day, month, year] = m;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return text;
}

/**
 * Parses a bank CSV export (task 6.4) — strictly more reliable than the PDF parser, since the
 * amount's sign (or a Debit/Credit column pair) is already explicit; no checkpoint-based sign
 * resolution is needed, so every entry comes back resolved.
 */
export function parseStatementCsv(csvText: string): ParsedStatement {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { entries: [], unresolvedCount: 0 };

  const headers = parseCsvLine(lines[0]);
  const dateCol = findColumn(headers, CSV_HEADER_ALIASES.date);
  const descCol = findColumn(headers, CSV_HEADER_ALIASES.description);
  const amountCol = findColumn(headers, CSV_HEADER_ALIASES.amount);
  const debitCol = findColumn(headers, CSV_HEADER_ALIASES.debit);
  const creditCol = findColumn(headers, CSV_HEADER_ALIASES.credit);
  const balanceCol = findColumn(headers, CSV_HEADER_ALIASES.balance);

  if (dateCol === -1 || descCol === -1 || (amountCol === -1 && debitCol === -1 && creditCol === -1)) {
    throw new Error('Unrecognised CSV columns: expected Date, Description and Amount (or Debit/Credit)');
  }

  const entries: StatementDraftEntry[] = [];
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    const date = fields[dateCol]?.trim();
    const description = fields[descCol]?.trim();
    if (!date || !description) continue;

    let amountMinorUnits: number | null = null;
    if (amountCol !== -1) {
      amountMinorUnits = csvAmountToMinorUnits(fields[amountCol] ?? '');
    } else {
      const debit = debitCol !== -1 ? csvAmountToMinorUnits(fields[debitCol] ?? '') : null;
      const credit = creditCol !== -1 ? csvAmountToMinorUnits(fields[creditCol] ?? '') : null;
      if (credit) amountMinorUnits = credit;
      else if (debit) amountMinorUnits = -debit;
    }
    if (amountMinorUnits === null) continue;

    const balanceAfterMinorUnits = balanceCol !== -1 ? csvAmountToMinorUnits(fields[balanceCol] ?? '') : null;

    entries.push({ date: normalizeCsvDate(date), description, amountMinorUnits, balanceAfterMinorUnits, signResolved: true });
  }

  return { entries, unresolvedCount: 0 };
}
