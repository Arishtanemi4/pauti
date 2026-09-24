// Native receipt OCR (docs/plan/EXECUTE.md Phase 7, task 7.1; ADR-009). ML Kit Text
// Recognition v2 is pretrained and fully on-device via expo-mlkit-ocr. ocr.web.ts throws
// instead, matching the pattern in src/platform/pdf.ts.
//
// Returns the full recognition result, not flattened text: item names and prices sit in
// separate spatial blocks (two columns on one row), so src/parse/receipt.ts needs each
// line's bounding box to re-pair them.

import { recognizeText, type RecognitionResult } from 'expo-mlkit-ocr';

export async function scanReceipt(imageUri: string): Promise<RecognitionResult> {
  return recognizeText(imageUri);
}
