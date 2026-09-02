/**
 * The wire vocabulary, transcribed from the packages we interoperate with.
 *
 * These numbers are not ours to choose — they are fixed by `y-websocket` (outer envelope)
 * and `y-protocols` (inner sync/auth payloads), and the browser provider we ship against
 * writes them. They are duplicated here rather than imported for one reason: the relay's
 * permission gate must classify a frame WITHOUT importing yjs or instantiating a document
 * (ARCHITECTURE.md §9), and `y-protocols/sync` pulls in `yjs` transitively. Coarse
 * authorisation costing no `Y.Doc` is the whole reason the relay can stay cheap.
 *
 * Verified against the installed sources, not recalled:
 *   y-websocket@3.1.0  src/y-websocket.js:20-23
 *   y-protocols@1.0.7  sync.js:38-40, auth.js:5
 */

/**
 * Outer envelope type — the first varUint of every frame.
 *
 * `y-websocket` dispatches on this via a sparse `messageHandlers` array, so an unknown
 * outer type is silently ignored by the reference client rather than rejected.
 */
export const OuterMessage = {
  /** A `y-protocols/sync` payload follows. See {@link SyncMessage}. */
  Sync: 0,
  /** An awareness update follows: presence, cursors, selection. Never persisted. */
  Awareness: 1,
  /**
   * A `y-protocols/auth` payload follows. **Server to client only.**
   * A client that sends this is either broken or probing; the gate rejects it.
   */
  Auth: 2,
  /**
   * "Send me everyone's awareness state." Note the reference client only ever emits this
   * over BroadcastChannel, never over the socket, and the reference server does not handle
   * it — so treat it as unexpected-but-harmless rather than building a path for it.
   */
  QueryAwareness: 3,
} as const;
export type OuterMessage = (typeof OuterMessage)[keyof typeof OuterMessage];

/**
 * Inner sync type — the second varUint of a {@link OuterMessage.Sync} frame. This is the
 * distinction the entire read-only gate rests on.
 */
export const SyncMessage = {
  /**
   * A state vector: "here is what I have, send me the rest."
   *
   * This is a **read** request, and it is the one sync message a viewer must be allowed to
   * send. It is also not free: it makes the server compute `encodeStateAsUpdate` against
   * the supplied vector, which is cheap for the client and expensive for us, so it wants
   * its own rate limit.
   */
  Step1: 0,
  /**
   * The reply to Step1, carrying a document update.
   *
   * A **write**, and the subtle one: a perfectly well-behaved read-only client sends this
   * as the normal answer to the server's opening Step1. If that client has offline state
   * from y-indexeddb the payload is non-empty, so silently dropping it leaves the viewer
   * rendering content that exists nowhere else — permanently, across reloads. Deny it
   * loudly instead (see `frame.ts`).
   */
  Step2: 1,
  /**
   * A steady-state document update. A **write**.
   *
   * `y-protocols/sync` aliases `readUpdate = readSyncStep2`, so Step2 and Update are the
   * same code path server-side; they differ only in intent.
   */
  Update: 2,
} as const;
export type SyncMessage = (typeof SyncMessage)[keyof typeof SyncMessage];

/** Inner auth type — the second varUint of an {@link OuterMessage.Auth} frame. */
export const AuthMessage = {
  /**
   * Carries a reason string. The reference client's handler for this is
   * `console.warn` and nothing else — it does **not** stop reconnecting — so a denial has
   * to be paired with a close in the permanent range. See `close-codes.ts`.
   */
  PermissionDenied: 0,
} as const;
export type AuthMessage = (typeof AuthMessage)[keyof typeof AuthMessage];

/**
 * Provider defaults that our own transport decisions depend on, transcribed from
 * y-websocket@3.1.0 so the reasoning is checkable and the constants are in one place.
 *
 * These are **not** configuration. Changing a value here changes nothing at runtime; it
 * only makes this file lie. They are recorded because several relay decisions are only
 * correct in light of them.
 */
export const ProviderDefaults = {
  /**
   * `messageReconnectTimeout = 30000` (src/y-websocket.js:99). The provider closes any
   * socket that has received no **inbound** message for 30s, checked every 3s.
   *
   * Consequence for the relay: do **not** suppress a client's own awareness echo when
   * coalescing the fan-out. WebSocket ping/pong is invisible to page JS and does not reset
   * this timer; the client's own re-announced awareness (every 15s, `outdatedTimeout / 2`)
   * is what feeds it. Drop the echo and a *solo* user enters a permanent
   * close/reconnect loop. The provider source comments this explicitly.
   */
  reconnectTimeoutMs: 30_000,

  /**
   * `resyncInterval = -1` (src/y-websocket.js:323) — **disabled by default**.
   *
   * So nothing periodically heals a client whose updates are parked in
   * `pendingStructs`: such a client looks connected and silently stops updating until it
   * reconnects. That is why the relay asserts `pendingStructs === null` after every apply
   * and why the sync indicator distinguishes "connected" from "connected but stalled".
   */
  resyncIntervalMs: -1,

  /**
   * `maxBackoffTime = 2500` (src/y-websocket.js:324), applied as
   * `min(2^attempts * 100, maxBackoffTime)` with **no jitter anywhere** in the provider.
   *
   * So every client in a room retries in near-lockstep and everyone is back within ~2.5s,
   * forever. Every deploy is therefore a thundering herd of full initial syncs, which is
   * why the relay caches its encoded snapshot per room.
   */
  maxBackoffMs: 2500,

  /**
   * `disableBc = false` (src/y-websocket.js:325) — cross-tab BroadcastChannel is **on**,
   * and the channel name is `serverUrl + '/' + roomname`, which **excludes** the auth
   * params. So two tabs holding different tickets share one channel and sync directly,
   * whatever the server decides.
   *
   * Consequences: pass `disableBc: true` in every test, capture demos across two browsers,
   * and never treat a two-tab observation as evidence about the relay.
   */
  broadcastChannelEnabled: true,

  /** `awareness.outdatedTimeout = 30000` (y-protocols/awareness.js:13). */
  awarenessOutdatedMs: 30_000,

  /**
   * Half of {@link ProviderDefaults.awarenessOutdatedMs}: each client re-announces its full
   * local state on this interval whether or not anything moved (awareness.js:61).
   *
   * So awareness traffic has a hard floor that no throttling or movement-gating can reach.
   * An idle room is not free, and "idle-room cost" is a number worth publishing.
   */
  awarenessReannounceMs: 15_000,
} as const;
