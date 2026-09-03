/**
 * What a connection is allowed to do, expressed as independent facets rather than a single
 * role check.
 *
 * The shape follows YHub (the official Yjs backend), which gates each message by its own
 * facet and — importantly — keeps a **separate awareness mask** from the document mask.
 * That separation is not incidental: a read-only connection with awareness write still
 * broadcasts its cursor, so a viewer can be visibly present in a room without being able
 * to change it. Collapsing the two into one boolean would silently make viewers invisible,
 * which reads as a broken app rather than a permission decision.
 *
 * Note the limit this cannot express, and say it out loud rather than implying otherwise:
 * `doc.read` is all-or-nothing. The sync protocol ships whole state via
 * `encodeStateAsUpdate` with no per-field filter, so a viewer necessarily receives the
 * entire document. "Viewer" is a *write* restriction. Genuinely hidden content needs a
 * subdocument with its own room and its own facets (ARCHITECTURE.md §1).
 */

export interface Facet {
  readonly read: boolean;
  readonly write: boolean;
}

export interface Facets {
  /** The Y.Doc: `read` permits sync at all, `write` permits Step2 and Update frames. */
  readonly doc: Facet;
  /** Presence: `read` receives others' cursors, `write` broadcasts your own. */
  readonly awareness: Facet;
}

export const Role = {
  Owner: 'owner',
  Editor: 'editor',
  /** Reads the document, and is present — but cannot change anything. */
  Viewer: 'viewer',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

const RW: Facet = { read: true, write: true };
const RO: Facet = { read: true, write: false };

const BY_ROLE: Readonly<Record<Role, Facets>> = {
  [Role.Owner]: { doc: RW, awareness: RW },
  [Role.Editor]: { doc: RW, awareness: RW },
  // Reads the document and participates in presence. The awareness write is the deliberate
  // part: a viewer whose cursor nobody can see looks like a bug to everyone in the room.
  [Role.Viewer]: { doc: RO, awareness: RW },
};

/**
 * Facets for a role.
 *
 * Resolve the role at ticket-issue time from the membership tables, never from a
 * long-lived token: roles change and tokens do not (ARCHITECTURE.md §9).
 */
export const facetsFor = (role: Role): Facets => {
  return BY_ROLE[role];
};

/**
 * A connection that may do nothing at all.
 *
 * The default a socket holds between `upgrade` and successful ticket redemption, so that a
 * gap in the handshake path fails closed rather than open.
 */
export const NO_ACCESS: Facets = {
  doc: { read: false, write: false },
  awareness: { read: false, write: false },
};
