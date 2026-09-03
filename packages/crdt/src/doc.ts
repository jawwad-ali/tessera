import * as Y from 'yjs';

/**
 * Board document construction, and the local cache namespace.
 *
 * Both of the values here are decisions that cannot be retrofitted, which is why they are
 * constants in code rather than sentences in a document.
 */

/**
 * Decision **D2**: garbage collection on.
 *
 * Deleted content is discarded at every transaction rather than retained, which is what keeps
 * a long-lived board from growing without bound. The cost is that version history is not
 * merely absent, it is impossible — `Y.snapshot` on a `gc: true` document returns a snapshot
 * whose content is already gone, and the flag cannot be flipped once a board is persisted.
 */
export const DOC_OPTIONS = { gc: true } as const;

/**
 * The IndexedDB store name for one epoch of one board.
 *
 * Embedding the epoch is what makes recovery from a rebuild structural rather than
 * procedural. A client refused at the handshake reloads, looks for a store named for the new
 * epoch, finds nothing, and syncs from the server — instead of reading a pre-rebuild cache
 * and merging state whose struct ids no longer relate to the document. Relying on a
 * `clearData()` call at the right moment would work exactly until someone forgot.
 *
 * The epoch is left legible in the name because that is what a human reads when debugging a
 * client's cache in devtools.
 */
export const idbStoreName = (roomId: string, epoch: number): string =>
  `board:${roomId}:e${String(epoch)}`;

/** A board document, constructed with the decided options. */
export const createBoardDoc = (): Y.Doc => new Y.Doc(DOC_OPTIONS);
