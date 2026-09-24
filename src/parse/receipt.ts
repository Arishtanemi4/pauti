// Receipt OCR result -> structured draft (docs/plan/EXECUTE.md Phase 7, task 7.1). No React,
// no SQLite, no I/O — pure data in, draft out, same shape as src/parse/statement.ts. Nothing
// here writes to the ledger; the review screen (§5.6) is the only path in.
//
// Layout assumed (validated against the 14 fixture receipts, all one template): item names and
// their prices sit in the same visual row but ML Kit's block detection puts them in separate
// text blocks (a name column, a price column), so flat OCR text interleaves the two out of
// row order. Pairing instead uses each line's bounding box: every money-pattern line is matched
// to the nearest non-money line to its left at roughly the same height (its row label). A label
// of "TOTAL" gives the receipt total; other known labels (CARD, SALES, VAT, ...) and negative
// amounts (e.g. a "Price Cut" discount against the item above it) are dropped; everything else
// is a line item.

import type { RecognitionResult } from 'expo-mlkit-ocr';

export interface ReceiptDraftItem {
  readonly name: string;
  readonly priceMinorUnits: number;
}

export interface ParsedReceipt {
  readonly storeName: string | null;
  readonly date: string | null; // ISO-8601, when resolved
  readonly totalMinorUnits: number | null;
  readonly items: ReceiptDraftItem[];
}

interface FlatLine {
  readonly text: string;
  readonly x: number;
  readonly yCenter: number;
  readonly height: number;
}

const MONEY_LINE_RE = /^(-?\d+\.\d{2})(?:\s*[A-Z])?$/;
const TOTAL_LABEL_RE = /^total$/i;
const NON_ITEM_LABEL_RE = /(total|card|cash|change|subtotal|sales|vat|amount|discount|price cut|copy|verified|contactless|auth|approved)/i;
// VAT-rate breakdown table rows ("A", "0 %", "B 20 %") sit in the same name column as items.
const RATE_CODE_LABEL_RE = /^[A-Z]?\s*\d*\s*%?$/i;
const DATE_RE = /^Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{2})/i;
const PRODUCT_CODE_RE = /\s+\d{6,}$/; // trailing SKU, e.g. "Garlic 0082706"

function toMinorUnits(text: string): number {
  return Math.round(parseFloat(text) * 100);
}

function flattenLines(ocr: RecognitionResult): FlatLine[] {
  const out: FlatLine[] = [];
  for (const block of ocr.blocks) {
    for (const line of block.lines) {
      const text = line.text.trim();
      if (text.length === 0) continue;
      const { x, y, height } = line.boundingBox;
      out.push({ text, x, yCenter: y + height / 2, height });
    }
  }
  return out;
}

// The row label for a money line: the nearest line to its left at roughly the same height.
function findRowLabel(moneyLine: FlatLine, candidates: FlatLine[]): FlatLine | null {
  let best: FlatLine | null = null;
  let bestYDist = Infinity;
  for (const c of candidates) {
    if (c.x >= moneyLine.x) continue;
    const yDist = Math.abs(c.yCenter - moneyLine.yCenter);
    const tolerance = Math.max(c.height, moneyLine.height) * 0.75;
    if (yDist > tolerance) continue;
    if (yDist < bestYDist) {
      bestYDist = yDist;
      best = c;
    }
  }
  return best;
}

export function parseReceiptOcr(ocr: RecognitionResult): ParsedReceipt {
  const lines = flattenLines(ocr);

  const storeName = lines.some((l) => /lidl/i.test(l.text)) ? 'Lidl' : null;

  let date: string | null = null;
  for (const line of lines) {
    const m = DATE_RE.exec(line.text);
    if (m) {
      const [, dd, mm, yy] = m;
      date = `20${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
      break;
    }
  }

  const moneyLines: { line: FlatLine; minorUnits: number }[] = [];
  const labelLines: FlatLine[] = [];
  for (const line of lines) {
    const m = MONEY_LINE_RE.exec(line.text);
    if (m) {
      moneyLines.push({ line, minorUnits: toMinorUnits(m[1]) });
    } else {
      labelLines.push(line);
    }
  }

  let totalMinorUnits: number | null = null;
  const items: ReceiptDraftItem[] = [];
  for (const { line: moneyLine, minorUnits } of moneyLines) {
    const label = findRowLabel(moneyLine, labelLines);
    if (!label) continue;
    if (TOTAL_LABEL_RE.test(label.text)) {
      if (totalMinorUnits === null) totalMinorUnits = minorUnits;
      continue;
    }
    if (NON_ITEM_LABEL_RE.test(label.text) || RATE_CODE_LABEL_RE.test(label.text)) continue;
    if (minorUnits < 0) continue; // e.g. "Price Cut" — discount, not a line item
    const name = label.text.replace(PRODUCT_CODE_RE, '').trim();
    items.push({ name, priceMinorUnits: minorUnits });
  }

  return { storeName, date, totalMinorUnits, items };
}
