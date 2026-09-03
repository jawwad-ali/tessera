/**
 * WebSocket close codes, chosen so the client's own reconnect logic does the right thing
 * without any cooperation from us.
 *
 * y-websocket@3.1.0 ships:
 *
 *   const defaultShouldReconnect = (event) => !(event.code >= 4400 && event.code < 4500)
 *
 * (src/y-websocket.js:140). On a close in 4400-4499 the provider sets
 * `shouldConnect = false`, stops retrying, and emits a `'closed'` event. Outside that
 * range it retries with `min(2^attempts * 100, 2500)` and **no jitter**, so a 1008 leaves
 * every denied client hammering the relay every ~2.5 seconds, in lockstep, forever.
 *
 * That is why {@link CloseCode} has no generic "policy violation" member: on this stack the
 * choice of number *is* the reconnect policy, and the relay's lint rule rejects a raw 1xxx
 * code on a close call.
 */

export const CloseCode = {
  /**
   * The client sent a frame we cannot parse, or one only a server may send.
   *
   * Permanent, deliberately. A peer speaking a protocol we cannot read will not start
   * speaking one we can by retrying, and the reference server's habit of swallowing decode
   * errors into a `console.error` is how a hostile or broken client goes unnoticed while
   * `pendingStructs` grows. Better to shed it and count it.
   *
   * Not 1002 (`protocol error`): that is outside the permanent range, so the provider would
   * retry it every ~2.5s with no jitter, forever.
   */
  ProtocolError: 4400,

  /**
   * The ticket was absent, malformed, already redeemed, or expired — or an accepted
   * socket's token reached its `exp` while connected.
   *
   * Reconnecting with the *same* credential cannot help, so this must be permanent from the
   * provider's point of view. The client's recovery is to mint a fresh ticket and construct
   * a new provider, which is a deliberate act rather than an automatic retry.
   */
  Unauthenticated: 4401,

  /**
   * Authenticated, but not permitted: not a member of this room, or a viewer that attempted
   * a document write.
   *
   * Pair it with an `Auth`/`PermissionDenied` frame *before* closing — the provider's
   * default handler for that frame is `console.warn` and nothing more, so the frame alone
   * changes no behaviour and the close alone gives the user no reason.
   *
   * On receipt the client must also discard local state: it applied its rejected edits
   * optimistically before sending, `Y.applyUpdate` has no inverse, and y-indexeddb has
   * persisted them. Without a client-side reset the viewer keeps rendering content that
   * exists nowhere else, across reloads. See ARCHITECTURE.md §9.
   */
  PermissionDenied: 4403,

  /** The room does not exist, or was deleted while the socket was open. */
  RoomGone: 4404,

  /**
   * The client's document epoch is behind the room's.
   *
   * An epoch bump means the room was rebuilt into a fresh `Y.Doc` with new struct ids, so
   * the client's cached updates and state vector no longer relate to it and merging them
   * would resurrect content or duplicate array entries. The client must clear its
   * y-indexeddb store (whose name embeds the epoch) and reload. Permanent by construction:
   * retrying with the old epoch can never succeed.
   */
  EpochStale: 4409,

  /**
   * The connection exceeded its message-rate or byte-rate budget.
   *
   * Deliberately **not** in the permanent range — this is the one denial a client should
   * retry, because a burst is usually a bug or a bad network rather than an intent. The
   * provider's un-jittered backoff is a poor fit, so the relay states a suggested delay in
   * the reason string and the client is expected to honour it.
   */
  RateLimited: 1013,

  /**
   * The relay is draining for shutdown. Snapshots have been flushed; reconnect is expected
   * and correct, and Yjs's idempotent resync makes it lossless.
   */
  Draining: 1012,
} as const;
export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode];

/**
 * Does a close in this code stop the reference provider from reconnecting?
 *
 * Use it in tests to assert that a denial is actually terminal, rather than trusting that
 * the number chosen at the call site happened to fall in the right range.
 */
export const isPermanent = (code: number): boolean => {
  return code >= 4400 && code < 4500;
};

/**
 * Human-readable default reason. Kept short: it travels in a close frame, which is capped
 * at 123 bytes of UTF-8 by RFC 6455, and an over-long reason makes the close itself fail.
 */
export const defaultReason = (code: CloseCode): string => {
  switch (code) {
    case CloseCode.ProtocolError:
      return 'unparseable or disallowed frame';
    case CloseCode.Unauthenticated:
      return 'ticket missing, expired, or already redeemed';
    case CloseCode.PermissionDenied:
      return 'not permitted to write this document';
    case CloseCode.RoomGone:
      return 'room not found';
    case CloseCode.EpochStale:
      return 'document epoch is stale; clear local cache and reload';
    case CloseCode.RateLimited:
      return 'rate limit exceeded';
    case CloseCode.Draining:
      return 'server draining; reconnect';
    default:
      return 'closed';
  }
};

/** RFC 6455 caps a close reason at 123 bytes. Longer, and the close frame is invalid. */
export const MAX_CLOSE_REASON_BYTES = 123;

/** UTF-8 byte cost of a single code point. */
const byteCost = (codePoint: number): 1 | 2 | 3 | 4 => {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
};

/** UTF-8 length of a string, without allocating an encoder. */
export const utf8ByteLength = (text: string): number => {
  let bytes = 0;
  // `for...of` iterates code points, so a surrogate pair counts once, as 4 bytes.
  for (const character of text) bytes += byteCost(character.codePointAt(0) ?? 0);
  return bytes;
};

/**
 * Truncate a reason to a valid close-frame payload, never splitting a code point.
 *
 * Worth having rather than trusting call sites: a reason assembled from a room id and an
 * error string is exactly the kind of thing that quietly grows past the cap, and the
 * failure mode is that the *close frame itself* is rejected — so the client never learns
 * why, and the diagnostic is lost precisely when it matters most.
 *
 * Implemented with arithmetic rather than `TextEncoder`, for two reasons. This package
 * carries no DOM and no node types (ARCHITECTURE.md §3), so a platform global would be a
 * boundary violation the typechecker correctly rejects. And counting code points truncates
 * at a character boundary *by construction*, which is stronger than encoding, slicing bytes
 * and repairing the mangled tail afterwards.
 */
export const clampReason = (reason: string): string => {
  let bytes = 0;
  let utf16End = 0;

  for (const character of reason) {
    const cost = byteCost(character.codePointAt(0) ?? 0);
    if (bytes + cost > MAX_CLOSE_REASON_BYTES) {
      return reason.slice(0, utf16End);
    }
    bytes += cost;
    utf16End += character.length; // 1 for BMP, 2 for a surrogate pair
  }

  return reason;
};
