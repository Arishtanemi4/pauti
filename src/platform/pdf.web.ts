// §1.3: web gets a throwing stub, not a silent no-op — the gap is explicit and type-checked.
// Real implementation (expo-pdf-text-extract, native only) lands in Phase 6.

export async function extractPdfText(_fileUri: string): Promise<never> {
  throw new Error('extractPdfText is not implemented on web');
}
