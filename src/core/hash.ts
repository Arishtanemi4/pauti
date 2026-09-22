// FNV-1a: a small, fast, non-cryptographic hash. Used for statement_entries.source_row_hash,
// where the only requirement is that the same raw row always hashes the same way so the
// UNIQUE(user_id, source_row_hash) constraint makes re-importing an overlapping statement a
// no-op (docs/plan/EXECUTE.md Phase 6, task 6.5).

export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
