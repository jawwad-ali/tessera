import * as Y from 'yjs';
import { describe as group, expect, it } from 'vitest';

import { DOC_OPTIONS, createBoardDoc, idbStoreName } from './doc.ts';

/**
 * Scan bytes for an ASCII needle without `Buffer` or `TextDecoder`.
 *
 * This package declares no node types and no DOM lib on purpose — the binding runs in a
 * browser, in the relay and in a bare node test — so a platform global here is a boundary
 * violation that lint correctly refuses, even in a test.
 */
const containsAscii = (haystack: Uint8Array, needle: string): boolean => {
  const bytes = Array.from(needle, (character) => character.charCodeAt(0));
  const matchesAt = (start: number): boolean =>
    bytes.every((byte, offset) => haystack[start + offset] === byte);

  for (let index = 0; index + bytes.length <= haystack.length; index++) {
    if (matchesAt(index)) return true;
  }
  return false;
};

/**
 * The client whose board was rebuilt while it was away.
 *
 * Refusing a stale connection is only half the recovery. The other half is that the client's
 * *local* cache must not be readable after a rebuild — otherwise it reloads, reads its old
 * IndexedDB store, and merges pre-rebuild state into a document with entirely new struct ids.
 * Namespacing the store by epoch makes that structurally impossible rather than relying on
 * remembering to call `clearData()`.
 */
group('a rebuilt board cannot read its own stale cache', () => {
  it('gives each epoch of a board its own local store', () => {
    const before = idbStoreName('board-7', 2);
    const after = idbStoreName('board-7', 3);

    expect(before).not.toBe(after);
    // The epoch has to be visible in the name, because that is what a human debugging a
    // client's cache actually reads.
    expect(after).toContain('3');
  });

  it('keeps different boards apart at the same epoch', () => {
    expect(idbStoreName('board-a', 1)).not.toBe(idbStoreName('board-b', 1));
  });

  it('is stable for the same board and epoch, or a reload loses its own cache', () => {
    expect(idbStoreName('board-7', 2)).toBe(idbStoreName('board-7', 2));
  });
});

/**
 * Decision D2 — `gc: true`, pinned in code rather than asserted in prose.
 *
 * It cannot be reversed once a board is persisted: with gc on, deleted content is discarded
 * at every transaction, so history is not merely absent, it is gone. This test exists so the
 * flag cannot be changed without someone deliberately deleting an assertion that says why.
 */
group('the document is constructed with the decided options', () => {
  it('reclaims deleted content, which is decision D2', () => {
    expect(DOC_OPTIONS.gc).toBe(true);
  });

  it('actually discards deleted content, not just sets a flag', () => {
    // The behaviour the decision buys. Insert, delete, and the payload is gone from the
    // encoded state — which is also why version history is out of scope.
    const doc = createBoardDoc();
    const notes = doc.getMap<string>('notes');

    doc.transact(() => {
      for (let i = 0; i < 50; i++) notes.set(`n${String(i)}`, 'secret-content-'.repeat(8));
    });
    doc.transact(() => {
      for (let i = 0; i < 50; i++) notes.delete(`n${String(i)}`);
    });

    const encoded = Y.encodeStateAsUpdate(doc);
    expect(containsAscii(encoded, 'secret-content')).toBe(false);
  });

  it('produces a document that is usable for a board', () => {
    const doc = createBoardDoc();
    expect(doc).toBeInstanceOf(Y.Doc);
    expect(doc.getMap('shapes')).toBeInstanceOf(Y.Map);
  });
});
