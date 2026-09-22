// Local ID generation for CRDT-authored records (docs/plan/EXECUTE.md Phase 5). No central
// coordination needed: each id embeds a timestamp plus randomness, which is enough entropy
// to avoid collisions between devices without a network round-trip (ADR-007).

export function newId(prefix: string): string {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${time}${random}`;
}
