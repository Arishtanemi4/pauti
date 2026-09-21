// §1.3: web gets a throwing stub, not a silent no-op — the gap is explicit and type-checked.
// Real implementation (expo-mlkit-ocr, native only) lands in Phase 7.

export async function scanReceipt(_imageUri: string): Promise<never> {
  throw new Error('scanReceipt is not implemented on web');
}
