import { describe, expect, it } from 'vitest';
import type { RecognitionResult, TextBlock, TextLine } from 'expo-mlkit-ocr';
import { parseReceiptOcr } from './receipt';

// Synthetic receipt, structurally identical to the real fixtures validated in ml/ (§6,
// docs/ocr/OCR.md) but with an invented store, dates, items and prices — no real fixture
// content is ever copied into the committed test suite (docs/plan/EXECUTE.md rule 7).
//
// The layout mirrors what ML Kit actually returns: item names sit in one block (the left
// column), their prices in a separate block (the right column), paired only by row height.

function line(text: string, x: number, y: number, width = 80, height = 20): TextLine {
  return { text, boundingBox: { x, y, width, height }, elements: [] };
}

function block(lines: TextLine[]): TextBlock {
  const xs = lines.map((l) => l.boundingBox.x);
  const ys = lines.map((l) => l.boundingBox.y);
  return {
    text: lines.map((l) => l.text).join('\n'),
    boundingBox: { x: Math.min(...xs), y: Math.min(...ys), width: 200, height: 200 },
    lines,
  };
}

function makeResult(blocks: TextBlock[]): RecognitionResult {
  return { text: blocks.flatMap((b) => b.lines.map((l) => l.text)).join('\n'), blocks };
}

describe('parseReceiptOcr', () => {
  it('pairs same-row items split across a name block and a price block', () => {
    const nameBlock = block([
      line('Cornershop', 0, 0),
      line('Date: 03/04/26 12:00', 0, 30),
      line('Bread 0011223', 0, 60),
      line('Milk', 0, 90),
      line('TOTAL', 0, 120),
    ]);
    const priceBlock = block([
      line('1.20', 300, 60),
      line('0.85', 300, 90),
      line('2.05', 300, 120),
    ]);

    const result = parseReceiptOcr(makeResult([nameBlock, priceBlock]));

    expect(result.date).toBe('2026-04-03');
    expect(result.totalMinorUnits).toBe(205);
    expect(result.items).toEqual([
      { name: 'Bread', priceMinorUnits: 120 },
      { name: 'Milk', priceMinorUnits: 85 },
    ]);
  });

  it('drops VAT-rate breakdown rows and non-item labels, but keeps the first TOTAL', () => {
    const nameBlock = block([
      line('Eggs', 0, 0),
      line('A', 0, 30),
      line('B 20 %', 0, 60),
      line('SUBTOTAL', 0, 90),
      line('CARD', 0, 120),
      line('TOTAL', 0, 150),
    ]);
    const priceBlock = block([
      line('3.00', 300, 0),
      line('0.00', 300, 30),
      line('0.50', 300, 60),
      line('3.00', 300, 90),
      line('3.00', 300, 120),
      line('3.00', 300, 150),
    ]);

    const result = parseReceiptOcr(makeResult([nameBlock, priceBlock]));

    expect(result.items).toEqual([{ name: 'Eggs', priceMinorUnits: 300 }]);
    expect(result.totalMinorUnits).toBe(300);
  });

  it('drops a negative-amount line (e.g. a discount against the item above it)', () => {
    const nameBlock = block([line('Cheese', 0, 0), line('Price Cut', 0, 30)]);
    const priceBlock = block([line('2.50', 300, 0), line('-0.50', 300, 30)]);

    const result = parseReceiptOcr(makeResult([nameBlock, priceBlock]));

    expect(result.items).toEqual([{ name: 'Cheese', priceMinorUnits: 250 }]);
  });

  it('returns an empty draft when nothing matches the expected shape', () => {
    const result = parseReceiptOcr(makeResult([block([line('not a receipt', 0, 0)])]));

    expect(result.storeName).toBeNull();
    expect(result.date).toBeNull();
    expect(result.totalMinorUnits).toBeNull();
    expect(result.items).toEqual([]);
  });
});
