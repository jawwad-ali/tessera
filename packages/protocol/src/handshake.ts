import { CloseCode, defaultReason } from './close-codes.ts';

/**
 * Epoch admission at the handshake.
 *
 * A board's epoch changes only when the document is rebuilt into a fresh `Y.Doc` — the one
 * operation that resets struct count and client-id cardinality, and which gives every shape
 * new struct ids. A client holding state from a different epoch cannot merge: doing so
 * resurrects deleted shapes and duplicates array entries, and every replica converges on the
 * result, so nothing appears broken.
 *
 * Runs before any document is instantiated, which is the point — this decision costs no
 * `Y.Doc`.
 */

export interface EpochQuery {
  /** The epoch the connecting client believes its cached state belongs to. */
  readonly clientEpoch: number;
  /** The epoch the room is actually serving. */
  readonly roomEpoch: number;
}

export type EpochVerdict =
  | { readonly action: 'accept' }
  | { readonly action: 'deny'; readonly code: CloseCode; readonly reason: string };

const ACCEPT: EpochVerdict = { action: 'accept' };

/**
 * Admit a connection only when its epoch matches the room's exactly.
 *
 * A *newer* client epoch is refused as firmly as an older one. It means the relay was
 * restored from a backup predating the last rebuild, so the client's cache is not stale but
 * from a future the room no longer has — and admitting it would merge state the room cannot
 * reconcile.
 *
 * The denial is permanent by construction: `CloseCode.EpochStale` sits in the 4400-4499 range
 * that the reference provider treats as terminal, so the client stops retrying and can clear
 * its cache and reload. A non-permanent code would leave it reconnecting every ~2.5s, with no
 * jitter, forever.
 */
export const resolveEpoch = ({ clientEpoch, roomEpoch }: EpochQuery): EpochVerdict =>
  clientEpoch === roomEpoch
    ? ACCEPT
    : {
        action: 'deny',
        code: CloseCode.EpochStale,
        reason: defaultReason(CloseCode.EpochStale),
      };
