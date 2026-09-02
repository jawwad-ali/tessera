import * as decoding from 'lib0/decoding';

import { CloseCode, defaultReason } from './close-codes.ts';
import type { Facets } from './facets.ts';
import { AuthMessage, OuterMessage, SyncMessage } from './messages.ts';

/**
 * Frame classification and adjudication — the two functions the relay's permission gate is
 * built from.
 *
 * Why this is a separate, dependency-free module rather than a branch inside the relay:
 *
 *  - **It must not need a `Y.Doc`.** Deciding whether a viewer may send this frame is two
 *    varUint reads. Coarse authorisation costing no document is what lets the relay stay a
 *    cheap fan-out; requiring an authoritative in-memory document per room is what forces
 *    single-writer room affinity, and that is a cost only *content* validation should pay
 *    (ARCHITECTURE.md §9).
 *  - **It cannot be bolted onto the reference handler.** `y-protocols`' `readSyncMessage`
 *    applies the update to the server document and triggers the broadcast before returning,
 *    so a check placed *after* it is not a check. The gate has to run first, on the raw
 *    bytes, which is precisely what {@link peek} is for.
 *  - **It is pure, so it is exhaustively testable** without sockets, rooms or documents.
 */

/** A classified inbound frame. Deliberately total: every byte sequence maps to a member. */
export type Frame =
  | { readonly kind: 'sync'; readonly step: SyncMessage }
  | { readonly kind: 'awareness' }
  | { readonly kind: 'query-awareness' }
  /** Server-to-client only. A client sending this is broken or probing. */
  | { readonly kind: 'auth'; readonly inner: number }
  /** A well-formed envelope we do not know. Forward-compatibility, not an error. */
  | { readonly kind: 'unknown-outer'; readonly outer: number }
  /** A `Sync` envelope whose inner type is not one of the three defined by y-protocols. */
  | { readonly kind: 'unknown-sync'; readonly inner: number }
  | { readonly kind: 'malformed'; readonly reason: string };

/**
 * Classify a frame without consuming anything the caller owns.
 *
 * Takes the raw `Uint8Array` rather than a decoder, on purpose. `decoding.readVarUint`
 * advances the decoder's position, so sharing one decoder between the gate and the real
 * handler would silently hand the handler a message with its first one or two varUints
 * already eaten. Passing bytes makes that mistake unrepresentable: this function builds and
 * discards its own decoder, and the caller still holds the untouched original.
 *
 * Never throws. A truncated or nonsensical frame is a `malformed` result, because the
 * alternative — an exception from inside a socket handler — is how the reference server
 * ends up swallowing hostile input into a `console.error` with no metric and no disconnect.
 */
export function peek(message: Uint8Array): Frame {
  if (message.byteLength === 0) return { kind: 'malformed', reason: 'empty frame' };

  let outer: number;
  try {
    // Our own decoder over the caller's bytes. Discarded on return.
    outer = decoding.readVarUint(decoding.createDecoder(message));
  } catch {
    return { kind: 'malformed', reason: 'unreadable outer message type' };
  }

  switch (outer) {
    case OuterMessage.Sync: {
      // Re-create the decoder and re-read: cheaper and clearer than threading one through,
      // and it keeps the "we never hand out a mutated decoder" property local.
      const decoder = decoding.createDecoder(message);
      try {
        decoding.readVarUint(decoder); // outer, already known
      } catch {
        return { kind: 'malformed', reason: 'unreadable outer message type' };
      }
      if (!decoding.hasContent(decoder)) {
        return { kind: 'malformed', reason: 'sync envelope with no inner type' };
      }
      let inner: number;
      try {
        inner = decoding.readVarUint(decoder);
      } catch {
        return { kind: 'malformed', reason: 'unreadable sync message type' };
      }
      switch (inner) {
        case SyncMessage.Step1:
        case SyncMessage.Step2:
        case SyncMessage.Update:
          // An empty payload is legal here — an update carrying no structs is a no-op, not
          // an error — so the payload is deliberately not inspected.
          return { kind: 'sync', step: inner };
        default:
          return { kind: 'unknown-sync', inner };
      }
    }

    case OuterMessage.Awareness:
      return { kind: 'awareness' };

    case OuterMessage.QueryAwareness:
      return { kind: 'query-awareness' };

    case OuterMessage.Auth: {
      const decoder = decoding.createDecoder(message);
      try {
        decoding.readVarUint(decoder); // outer
        const inner = decoding.hasContent(decoder)
          ? decoding.readVarUint(decoder)
          : AuthMessage.PermissionDenied;
        return { kind: 'auth', inner };
      } catch {
        return { kind: 'malformed', reason: 'unreadable auth message' };
      }
    }

    default:
      return { kind: 'unknown-outer', outer };
  }
}

/**
 * What the relay should do with a frame.
 *
 * Three outcomes, not two, and the distinction is the interesting part:
 *
 *  - `allow` — hand the original bytes to the real handler.
 *  - `drop` — discard silently and count it. Correct **only** for ephemeral traffic that
 *    the next update supersedes. Presence can be shed with no correctness consequence;
 *    document updates cannot.
 *  - `deny` — send an `Auth`/`PermissionDenied` frame, then close with the given code.
 *
 * Silently dropping a document write is the trap. The client applied that change locally
 * before it sent a byte and `Y.applyUpdate` has no inverse, so dropping the frame does not
 * stop the edit — it forks the client permanently. y-indexeddb persists the fork across
 * reloads, and because `resyncInterval` defaults to `-1` nothing heals it. The user watches
 * their work on a board nobody else can see while the indicator says connected. So a
 * document write from a connection without `doc.write` is always `deny`, never `drop`.
 */
export type Verdict =
  | { readonly action: 'allow' }
  | { readonly action: 'drop'; readonly reason: string }
  | { readonly action: 'deny'; readonly code: CloseCode; readonly reason: string };

const ALLOW: Verdict = { action: 'allow' };

function deny(code: CloseCode, reason = defaultReason(code)): Verdict {
  return { action: 'deny', code, reason };
}

/**
 * Adjudicate a classified frame against a connection's facets. Pure and total.
 *
 * Note what is deliberately *not* here: any inspection of update contents. Rejecting a
 * frame because of what it would do to which shape requires integrating it into an
 * authoritative document, and this gate exists precisely to make the common case free.
 * There is also a cheaper structural escape than content validation, worth remembering
 * before reaching for one: put anything a lower-privileged user may write in a separate
 * document with its own room, and the rule collapses back into two varUints.
 */
export function adjudicate(frame: Frame, facets: Facets): Verdict {
  switch (frame.kind) {
    case 'sync':
      switch (frame.step) {
        case SyncMessage.Step1:
          // A read request: it asks the server to encode state against a state vector. Free
          // for the client and not free for us, so it belongs in its own rate-limit bucket
          // — but it is not a write, and a viewer must be able to send it.
          return facets.doc.read
            ? ALLOW
            : deny(CloseCode.PermissionDenied, 'not permitted to read this document');

        case SyncMessage.Step2:
        case SyncMessage.Update:
          if (facets.doc.write) return ALLOW;
          // Note this fires for a *well-behaved* read-only client too: Step2 is the normal
          // reply to the server's opening Step1, and it is non-empty whenever that client
          // has offline state. Denying loudly is still right — the alternative is a viewer
          // rendering content that exists nowhere else, forever.
          return deny(CloseCode.PermissionDenied, 'not permitted to write this document');

        default:
          return deny(CloseCode.ProtocolError, 'unknown sync message type');
      }

    case 'awareness':
      // Ephemeral and self-superseding: the next cursor tick replaces whatever this one
      // carried, so dropping costs nothing and closing the socket over a cursor would be
      // absurd. Count it — a client sending presence it is not allowed to send is a signal.
      return facets.awareness.write
        ? ALLOW
        : { action: 'drop', reason: 'awareness write not permitted' };

    case 'query-awareness':
      // The reference client only emits this over BroadcastChannel and the reference server
      // ignores it, so seeing it on a socket means a non-standard peer. Harmless either way.
      return facets.awareness.read
        ? ALLOW
        : { action: 'drop', reason: 'awareness read not permitted' };

    case 'auth':
      // Server to client only. A client sending it is broken or probing; either way we do
      // not want a reconnect loop.
      return deny(CloseCode.ProtocolError, 'auth frames are server-to-client only');

    case 'unknown-outer':
      // Forward-compatibility rather than an error: the reference client also ignores outer
      // types it does not know, so a newer peer must not be killed for speaking more than
      // we do.
      return { action: 'drop', reason: `unknown outer message type ${String(frame.outer)}` };

    case 'unknown-sync':
      // Inside a Sync envelope the vocabulary is closed and fixed by y-protocols, so an
      // unrecognised inner type is a protocol violation rather than a future dialect.
      return deny(CloseCode.ProtocolError, 'unknown sync message type');

    case 'malformed':
      return deny(CloseCode.ProtocolError, frame.reason);

    default:
      // Exhaustive above; this keeps the union honest if a member is ever added.
      return deny(CloseCode.ProtocolError, 'unclassified frame');
  }
}

/**
 * A stable, low-cardinality label for metrics and logs.
 *
 * Low cardinality is the requirement, not a nicety: this ends up as a Prometheus label, and
 * interpolating an attacker-supplied outer type straight into one is an unbounded label set
 * — a memory leak in the metrics registry that a hostile client controls.
 */
export function describe(frame: Frame): string {
  switch (frame.kind) {
    case 'sync':
      switch (frame.step) {
        case SyncMessage.Step1:
          return 'sync.step1';
        case SyncMessage.Step2:
          return 'sync.step2';
        case SyncMessage.Update:
          return 'sync.update';
        default:
          return 'sync.unknown';
      }
    case 'awareness':
      return 'awareness';
    case 'query-awareness':
      return 'query-awareness';
    case 'auth':
      return 'auth';
    case 'unknown-outer':
      return 'unknown-outer';
    case 'unknown-sync':
      return 'unknown-sync';
    case 'malformed':
      return 'malformed';
    default:
      return 'unclassified';
  }
}
