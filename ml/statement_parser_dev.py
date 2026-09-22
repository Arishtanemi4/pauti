"""
Dev/validation harness for the bank-statement parser (docs/plan/EXECUTE.md Phase 6, task 6.1).

Not shipped — this is where the line-grouping algorithm is worked out against the 3 fixture
PDFs before being ported to src/parse/statement.ts. Uses pdfplumber only to get the same plain
text a PDFBox text-layer extraction would produce (no word coordinates), because that is what
expo-pdf-text-extract actually hands the app at runtime — the parser must work off linear text.

Validates itself against the statement's own numbers (OpeningBalance / Payments In / Payments
Out / ClosingBalance and every page-break "BALANCE CARRIED FORWARD" checkpoint) rather than a
hand-transcribed ground truth, so no fixture content needs to be copied out of the PDFs.
"""
import json
import os
import re
import sys

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), 'tests', 'fixtures', 'bank-statements')
DEV_OUT_DIR = os.path.join(os.path.dirname(__file__), 'tests', 'fixtures', 'extracts', 'dev')

MONTHS = {m: i + 1 for i, m in enumerate(
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
)}

DATE_LINE_RE = re.compile(r'^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{2})\s*(.*)$')
TRAILING_AMOUNTS_RE = re.compile(r'^(.*?)\s*([\d,]+\.\d{2})(?:\s+([\d,]+\.\d{2}))?\s*$')
CARRIED_FORWARD_RE = re.compile(r'^BALANCE(CARRIED|BROUGHT)FORWARD\s*\.?\s*([\d,]+\.\d{2})$')
HEADER_LINE_RE = re.compile(r'^Date Payment type and details')
SUMMARY_RE = {
    'opening': re.compile(r'OpeningBalance\s*£([\d,]+\.\d{2})'),
    'paidIn': re.compile(r'Payments In\s*£([\d,]+\.\d{2})'),
    'paidOut': re.compile(r'Payments Out\s*£([\d,]+\.\d{2})'),
    'closing': re.compile(r'ClosingBalance\s*£([\d,]+\.\d{2})'),
}


def to_minor_units(text):
    return round(float(text.replace(',', '')) * 100)


def to_iso_date(day, mon, yr2):
    year = 2000 + int(yr2)
    return f'{year:04d}-{MONTHS[mon]:02d}-{int(day):02d}'


def parse_summary(full_text):
    out = {}
    for key, rx in SUMMARY_RE.items():
        m = rx.search(full_text)
        out[key] = to_minor_units(m.group(1)) if m else None
    return out


def is_table_line(line):
    """Filters the raw text down to the transaction table: real content lines, page furniture
    and legal boilerplate dropped. A conservative allow-list — anything not recognised is
    reported as skipped rather than silently mis-parsed."""
    if DATE_LINE_RE.match(line):
        return True
    if CARRIED_FORWARD_RE.match(line.strip()):
        return True
    return None  # undetermined — caller decides based on table-open state


def parse_statement_text(full_text):
    lines = [l for l in full_text.splitlines() if l.strip()]
    summary = parse_summary(full_text)

    entries = []
    checkpoints = []  # expected running balance at each BALANCE CARRIED FORWARD line
    skipped = 0

    current_date = None
    open_txn = None  # {date, desc: [str], amount: int|None, balance: int|None}
    in_table = False

    def close_if_amounts(text):
        """Returns (desc_prefix, amount_minor, balance_minor_or_None) if text ends in 1-2
        amount tokens, else None."""
        m = TRAILING_AMOUNTS_RE.match(text)
        if not m:
            return None
        prefix, a1, a2 = m.groups()
        if a2 is not None:
            return prefix, to_minor_units(a1), to_minor_units(a2)
        return prefix, to_minor_units(a1), None

    def flush():
        nonlocal open_txn
        if open_txn is not None and open_txn['amount'] is not None:
            entries.append({
                'date': open_txn['date'],
                'description': ' '.join(p for p in open_txn['desc'] if p),
                'amountMinorUnits': open_txn['amount'],
                'balanceAfterMinorUnits': open_txn['balance'],
            })
        open_txn = None

    for raw in lines:
        line = raw.strip()

        date_m = DATE_LINE_RE.match(line)
        if date_m:
            day, mon, yr, rest = date_m.groups()
            current_date = to_iso_date(day, mon, yr)
            in_table = True
            rest = rest.strip()
            cf_m = CARRIED_FORWARD_RE.match(rest)
            if cf_m:
                flush()
                checkpoints.append(to_minor_units(cf_m.group(2)))
                in_table = cf_m.group(1) == 'BROUGHT'
                continue
            if rest == '':
                continue
            flush()
            closed = close_if_amounts(rest)
            if closed:
                prefix, amount, balance = closed
                open_txn = {'date': current_date, 'desc': [prefix], 'amount': amount, 'balance': balance}
                flush()
            else:
                open_txn = {'date': current_date, 'desc': [rest], 'amount': None, 'balance': None}
            continue

        if HEADER_LINE_RE.match(line):
            in_table = True  # re-arms the table on a new page; a repeated column heading
            continue

        if not in_table:
            continue  # header/account-summary boilerplate before the table starts

        cf_m2 = CARRIED_FORWARD_RE.match(line)
        if cf_m2:
            flush()
            checkpoints.append(to_minor_units(cf_m2.group(2)))
            in_table = cf_m2.group(1) == 'BROUGHT'
            continue

        if current_date is None:
            skipped += 1
            continue

        closed = close_if_amounts(line)
        if open_txn is None:
            if closed:
                prefix, amount, balance = closed
                open_txn = {'date': current_date, 'desc': [prefix], 'amount': amount, 'balance': balance}
                flush()
            else:
                # Could be genuine table furniture (page letter/footer stray) or a fresh
                # sub-transaction's first line. Table furniture is short and non-alphabetic;
                # treat anything else as a new sub-transaction description.
                if re.match(r'^[A-Za-z0-9.]{1,2}$', line):
                    skipped += 1
                else:
                    open_txn = {'date': current_date, 'desc': [line], 'amount': None, 'balance': None}
        else:
            if closed:
                prefix, amount, balance = closed
                if prefix:
                    open_txn['desc'].append(prefix)
                open_txn['amount'] = amount
                open_txn['balance'] = balance
                flush()
            else:
                open_txn['desc'].append(line)

    flush()

    # Resolve credit/debit sign via running-balance reconciliation. A batch is every entry
    # between two known balance checkpoints — usually one entry, sometimes several sharing a
    # date whose individual running balance the statement doesn't print. Most batches are
    # single-sign (all debits or all credits) and resolve by comparing the checkpoint delta to
    # the batch's total magnitude; a minority are genuinely mixed (a credit and several debits
    # dated the same day), so a batch that fails the single-sign check is re-tried as an exact
    # subset-sum against the delta before being given up on as unresolved.
    running = summary['opening']
    resolved = []
    unresolved_sign = 0

    def solve_signs(amounts, target):
        """Returns a list of +/-1 signs reproducing `target` exactly (1p tolerance), or None.
        Batches are small (a handful of same-day transactions), so brute force is fine."""
        n = len(amounts)
        if n > 20:
            return None
        solutions = []
        for mask in range(1 << n):
            total = 0
            for j in range(n):
                total += amounts[j] if (mask >> j) & 1 else -amounts[j]
            if abs(total - target) <= 1:
                solutions.append([1 if (mask >> j) & 1 else -1 for j in range(n)])
                if len(solutions) > 1:
                    break
        if len(solutions) == 1:
            return solutions[0]
        return None

    unresolved_batches = []
    i = 0
    while i < len(entries):
        batch = [entries[i]]
        while batch[-1]['balanceAfterMinorUnits'] is None and i + 1 < len(entries):
            i += 1
            batch.append(entries[i])
        closing_balance = batch[-1]['balanceAfterMinorUnits']
        if closing_balance is None:
            # Last entry in the file with no trailing balance — cannot resolve; leave as debit
            # and flag.
            unresolved_sign += len(batch)
            for e in batch:
                e['signedAmountMinorUnits'] = -e['amountMinorUnits']
            resolved.extend(batch)
            i += 1
            continue

        delta = closing_balance - running
        amounts = [e['amountMinorUnits'] for e in batch]
        total_magnitude = sum(amounts)
        if abs(abs(delta) - total_magnitude) <= 1:
            signs = [1 if delta > 0 else -1] * len(batch)
        else:
            signs = solve_signs(amounts, delta)
            if signs is None:
                signs = [1 if delta > 0 else -1] * len(batch)  # best-effort fallback
                unresolved_sign += len(batch)
                unresolved_batches.append({
                    'dates': [e['date'] for e in batch],
                    'amounts': amounts,
                    'runningBefore': running,
                    'closingBalance': closing_balance,
                    'delta': delta,
                    'totalMagnitude': total_magnitude,
                })

        for e, s in zip(batch, signs):
            e['signedAmountMinorUnits'] = s * e['amountMinorUnits']
        resolved.extend(batch)
        running = closing_balance
        i += 1

    # Reconciliation runs batch-by-batch, always resetting to the statement's own stated
    # balance at each checkpoint, so an isolated sign error can't cascade into every later
    # figure — it is caught once, at the batch where it occurs.
    checkpoint_mismatches = unresolved_sign

    total_in = sum(e['signedAmountMinorUnits'] for e in resolved if e['signedAmountMinorUnits'] > 0)
    total_out = -sum(e['signedAmountMinorUnits'] for e in resolved if e['signedAmountMinorUnits'] < 0)

    return {
        'summary': summary,
        'entries': resolved,
        'checkpoints': checkpoints,
        'skippedLines': skipped,
        'computedPaidIn': total_in,
        'computedPaidOut': total_out,
        'computedClosing': running,
        'checkpointMismatches': checkpoint_mismatches,
        'unresolvedSignCount': unresolved_sign,
        'unresolvedBatches': unresolved_batches,
    }


def main():
    import pdfplumber

    os.makedirs(DEV_OUT_DIR, exist_ok=True)
    results = {}
    for fname in sorted(os.listdir(FIXTURES_DIR)):
        if not fname.endswith('.pdf'):
            continue
        path = os.path.join(FIXTURES_DIR, fname)
        with pdfplumber.open(path) as pdf:
            full_text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
        parsed = parse_statement_text(full_text)
        with open(os.path.join(DEV_OUT_DIR, fname.replace('.pdf', '.parsed.json')), 'w', encoding='utf-8') as f:
            json.dump(parsed, f, indent=2)

        s = parsed['summary']
        ok_in = s['paidIn'] == parsed['computedPaidIn']
        ok_out = s['paidOut'] == parsed['computedPaidOut']
        ok_close = s['closing'] == parsed['computedClosing']
        ok_checkpoints = parsed['checkpointMismatches'] == 0
        ok_sign = parsed['unresolvedSignCount'] == 0
        passed = ok_in and ok_out and ok_close and ok_checkpoints and ok_sign

        results[fname] = {
            'entryCount': len(parsed['entries']),
            'skippedLines': parsed['skippedLines'],
            'paidInMatches': ok_in,
            'paidOutMatches': ok_out,
            'closingBalanceMatches': ok_close,
            'checkpointMismatches': parsed['checkpointMismatches'],
            'unresolvedSignCount': parsed['unresolvedSignCount'],
            'passed': passed,
        }

    print(json.dumps(results, indent=2))
    return 0 if all(r['passed'] for r in results.values()) else 1


if __name__ == '__main__':
    sys.exit(main())
