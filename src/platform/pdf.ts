// Native PDF text-layer extraction (docs/plan/EXECUTE.md Phase 6, task 6.2; ADR-009). Bank
// statements carry a text layer already, so this is exact extraction, not OCR — PDFBox on
// Android, PDFKit on iOS, via expo-pdf-text-extract. pdf.web.ts throws instead.

import { extractText } from 'expo-pdf-text-extract';

export async function extractPdfText(fileUri: string): Promise<string> {
  return extractText(fileUri);
}
