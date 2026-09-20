// Phase 3.1 spike — NOT the real CRDT layer. This only proves the merge algebra Yjs is
// expected to provide (docs/plan/EXECUTE.md Phase 3.1, ADR-002). It runs under Node/vitest,
// which validates the JS-level semantics but NOT Hermes engine compatibility — that half of
// the spike still has to run on an actual Android dev build before doc.ts/write.ts/
// projector.ts (3.2-3.5) are written. Per architecture.md ADR-002: "Phase 3 spikes Yjs on a
// real device before anything is built on top of it."

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

describe('yjs spike', () => {
  it('two docs with concurrent edits to different keys converge to the same state', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    docA.getMap('splitSets').set('scope_1', { alice: 100, bob: 200 });
    docB.getMap('splitSets').set('scope_2', { carol: 300 });

    const updateFromA = Y.encodeStateAsUpdate(docA);
    const updateFromB = Y.encodeStateAsUpdate(docB);

    Y.applyUpdate(docB, updateFromA);
    Y.applyUpdate(docA, updateFromB);

    expect(docA.getMap('splitSets').toJSON()).toEqual(docB.getMap('splitSets').toJSON());
    expect(docA.getMap('splitSets').toJSON()).toEqual({
      scope_1: { alice: 100, bob: 200 },
      scope_2: { carol: 300 },
    });
  });

  it('a concurrent re-split (same scope, both devices offline) is a clean last-write-wins, not a merge of fields', () => {
    const docA = new Y.Doc();
    const updateInitial = Y.encodeStateAsUpdate(docA);

    const docB = new Y.Doc();
    Y.applyUpdate(docB, updateInitial);

    // Both devices independently re-split the same bill while offline.
    docA.getMap('splitSets').set('scope_1', { alice: 500, bob: 500 });
    docB.getMap('splitSets').set('scope_1', { alice: 300, bob: 400, carol: 300 });

    const updateFromA = Y.encodeStateAsUpdate(docA);
    const updateFromB = Y.encodeStateAsUpdate(docB);
    Y.applyUpdate(docB, updateFromA);
    Y.applyUpdate(docA, updateFromB);

    // Converged — and critically, to one of the two whole splits, never a blend of both
    // (e.g. never {alice: 500, bob: 400, carol: 300}, which wouldn't sum to any real total).
    const resolved = docA.getMap('splitSets').toJSON();
    expect(resolved).toEqual(docB.getMap('splitSets').toJSON());
    const isWholeA = JSON.stringify(resolved.scope_1) === JSON.stringify({ alice: 500, bob: 500 });
    const isWholeB = JSON.stringify(resolved.scope_1) === JSON.stringify({ alice: 300, bob: 400, carol: 300 });
    expect(isWholeA || isWholeB).toBe(true);
  });

  it('settlements is append-only: concurrent appends from both devices are both retained', () => {
    const docA = new Y.Doc();
    const updateInitial = Y.encodeStateAsUpdate(docA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, updateInitial);

    docA.getArray('settlements').push([{ from: 'alice', to: 'bob', amount: 500 }]);
    docB.getArray('settlements').push([{ from: 'bob', to: 'carol', amount: 300 }]);

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    expect(docA.getArray('settlements').toJSON()).toHaveLength(2);
    expect(docA.getArray('settlements').toJSON()).toEqual(docB.getArray('settlements').toJSON());
  });

  it('encodeStateAsUpdate / applyUpdate round-trip through a Uint8Array (the shape file/QR transports need)', () => {
    const doc = new Y.Doc();
    doc.getMap('meta').set('group_name', 'Trio');

    const update = Y.encodeStateAsUpdate(doc);
    expect(update).toBeInstanceOf(Uint8Array);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, update);
    expect(restored.getMap('meta').get('group_name')).toBe('Trio');
  });
});
