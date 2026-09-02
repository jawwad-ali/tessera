# Tessera — Architecture

A multiplayer whiteboard with CRDT sync. Yjs for convergence, a hand-written canvas
renderer, a hand-written WebSocket relay. No hosted sync SDK, no canvas library.

This document defines module boundaries and the contracts across them. Every
constraint marked **[M]** was measured against `yjs 13.6.32` on Node 24; the
measurement is named so it can be re-run and challenged.

---

## 1. Non-goals

Stated up front, because a declared limit is an engineering position and an
undeclared one is a bug:

- **Not** a general real-time data layer. Shapes on a board, nothing else.
- **No partial visibility.** A viewer receives the whole document — the sync
  protocol ships whole state and has no per-field filter. "Viewer" is a *write*
  restriction only. Genuinely hidden content would need a subdoc with its own
  room and its own authorisation.
- **No version history / time travel** (pending decision D2). `Y.snapshot` is free
  to take and worthless to restore unless the document has run `gc: false` since
  birth — history cannot be retroactively enabled.
- **No per-shape ownership rules.** Room-level roles only. Finer rules require
  decoding and validating individual structs against an authoritative server
  document; the cheap escape, if we ever want it, is a separate room.
- **Not accessible as a canvas.** There is no WAI-ARIA pattern for an infinite
  canvas. We ship keyboard toolbar access, selection cycling and
  `prefers-reduced-motion`, and state the limit precisely.

---

## 2. The central idea: four state tiers

Most of the failure modes in this class of app come from putting state in the
wrong tier. Every piece of state in Tessera belongs to exactly one:

| Tier | Lives in | Lifetime | Example |
|---|---|---|---|
| **1. Local ephemeral** | plain JS, in the interaction layer | until pointerup | the in-flight drag offset, the stroke being drawn, marquee rect |
| **2. Shared ephemeral** | Yjs **awareness** | until the socket closes | cursors, selection, the *ghost* of a peer's in-flight drag |
| **3. Committed** | the **Y.Doc** | forever | shape geometry, style, z-index, note text |
| **4. Persisted** | Postgres | forever, durably | the append-only update log and the squashed head |

**The rule: a gesture is tier 1 locally and tier 2 for peers, and becomes tier 3
in exactly one transaction on pointerup.** Never per frame.

Why, with the three costs separated **[M: `bench/crit2.mjs`]** — 1,000 shapes,
1,000 drags × 60 frames:

| | structs | V1 | V2 | update log | cold load | wire msgs |
|---|---|---|---|---|---|---|
| per-frame, `x`+`y` | 128,000 | 1,316 KB | 105 KB | 3,438 KB | 151 ms | 60,000 |
| per-frame, one `transform` key | 10,000 | 184 KB | 111 KB | 3,191 KB | 22 ms | 60,000 |
| **commit on pointerup** | 10,000 | 168 KB | 93 KB | **54 KB** | 13 ms | **1,000** |

Three independent costs, and each fix addresses a different one:

- **Bytes** are a V1 artefact. `encodeStateAsUpdateV2` absorbs the churn for free —
  the single-key model is actually *slightly worse* on V2 bytes. Do not defend the
  data model on document size.
- **Struct count drives cold load.** The one-`transform`-key model buys a 7–12×
  faster board open. That is what it is for.
- **Wire volume and Postgres write amplification** are fixed *only* by
  commit-on-pointerup. Key layout does nothing here.

Do all three, for those three reasons.

### The merge rule is stronger than "one key" — and it is why commit-on-pointerup is not optional

`Item.mergeWith` requires `left.clock + left.length === right.clock`: **adjacency in
the writing client's own struct list.** Any interleaving breaks it, and "interleaving"
is not limited to two keys of one shape. Measured, 60 frames **[M]**:

| what those 60 frames write | structs |
|---|---|
| `x` and `y` on one shape | +120 |
| `t` on one shape | **+2** |
| `t` **and** `style` on one shape | +120 |
| `t` on **two** shapes | +118 |
| `t` on **three** shapes | +180 |

So the honest rule is: **a repeated write merges only if it is the only thing that
client writes that frame.** Two consequences the key layout alone cannot deliver:

1. No command may write more than one *hot* key, or the merge is lost for both. A
   change needing geometry *and* style is two commands, therefore two gestures,
   therefore two undo steps — which is the better UX anyway.
2. **A multi-shape group drag can never merge per frame, at any key layout.** Measured
   over 1,000 three-shape group drags **[M]**: one transaction per gesture gives 3,000
   structs / 1,000 messages / 46 ms cold load; one per frame gives 180,000 / 60,000 /
   408 ms — an 8.8× cold load and 60× the wire, while V2 bytes stay within 10%. Again
   not a size argument.

Hence the gesture contract in §6: staging keyed by `(shapeId, key)` with
last-write-wins inside the gesture, so a 300-frame drag costs one write per shape and
the struct cost is provably independent of frame count.

---

## 3. Package boundaries

```
tessera/
├── apps/
│   ├── web/            Next.js App Router. The only package that may import react.
│   └── relay/          ws server. The only package that may import node:*/ws/pg.
├── packages/
│   ├── core/           Pure TS. The scene, the schema, the geometry, the rules.
│   ├── crdt/           The Yjs binding. The only package that may import yjs.
│   ├── protocol/       Wire format + permission facets. Shared by web and relay.
│   └── harness/        Property suite, load client, measurement. Dev only.
```

### The dependency rule

```
core      ← imports nothing but TypeScript
protocol  ← imports nothing but lib0 (framing primitives)
crdt      ← core, protocol, yjs
web       ← core, protocol, crdt, react
relay     ← core, protocol, crdt, node
harness   ← everything
```

**`core` must not import `yjs`, `react`, or any `node:` module.** This is the load-
bearing rule of the whole codebase, and it is enforced in CI, not by convention:

- It is what makes the property suite possible — the convergence harness runs the
  real command vocabulary and the real invariants against N in-process replicas
  with no browser and no network.
- It is the concrete form of "keep Yjs out of React": the renderer reads `core`'s
  scene store, which is a plain `Map`. It never calls `ymap.get()` in a hot loop.
- It is what makes the CRDT swappable, which is how we build single-player first
  and add sync behind the same interface.

### One hoisted `yjs`

**[M: `bench/types.mjs`]** Two module copies of yjs — including the *same version*
resolved once as ESM and once as CJS — produce `Ya.Doc !== Yb.Doc`. Setting a
`Yb.Map` into a `Ya.Doc` throws `Unexpected content type`. Binary updates still
cross perfectly, so a two-copy workspace works fine while only bytes move between
web and relay, and detonates the day we add a nested `Y.Text`. Yjs prints
`console.error('Yjs was already imported...')`, which is trivially lost in a Next
dev log.

Therefore: `yjs` is a `pnpm.overrides` pin to one exact version, a **peer**
dependency of `packages/crdt`, and CI runs one test that sets a nested type across
the app boundary and asserts no throw.

---

## 4. Folder structure

```
tessera/
├── ARCHITECTURE.md
├── pnpm-workspace.yaml
├── package.json                    pnpm.overrides: { "yjs": "13.6.32" }
├── tsconfig.base.json
│
├── packages/core/src/
│   ├── schema/
│   │   ├── shape.ts                Shape union, SHAPE_SCHEMA_VERSION
│   │   ├── transform.ts            Transform: the atomic geometry unit
│   │   ├── migrate.ts              read-time resolution, legacy-wins
│   │   └── validate.ts             runtime guard at the observer boundary
│   ├── commands/
│   │   ├── command.ts              the Command union — the whole write API
│   │   └── apply.ts                pure (Scene, Command) => Patch
│   ├── scene/
│   │   ├── store.ts                SceneStore interface + MemoryStore
│   │   ├── index-hash.ts           uniform spatial hash
│   │   └── order.ts               jittered fractional index, draw-order sort
│   ├── camera/
│   │   ├── camera.ts               DOMMatrix-free math (works in node tests)
│   │   └── hit.ts                  AABB/OBB reject, tier-2 of hit testing
│   └── invariants.ts               the assertions the property suite runs
│
├── packages/crdt/src/
│   ├── doc.ts                      Y.Doc construction, gc flag, epoch
│   ├── yjs-store.ts                YjsStore implements SceneStore
│   ├── mapping.ts                  Shape <-> Y.Map, one key per atomic unit
│   ├── tx.ts                       transact + origin discipline (single choke point)
│   ├── undo.ts                     UndoManager scoping, gesture boundaries
│   ├── awareness.ts                tier-2 codec: lean payloads, identity hoisted
│   ├── ingest.ts                   rAF-coalesced applyUpdate batching
│   └── checksum.ts                 sha256(encodeStateAsUpdate) divergence probe
│
├── packages/protocol/src/
│   ├── messages.ts                 outer/inner message type constants
│   ├── frame.ts                    read the two varUints without consuming
│   ├── facets.ts                   { ydoc, awareness } permission masks
│   └── close-codes.ts              4400–4499 = permanent, do not reconnect
│
├── apps/web/
│   ├── app/                        Next App Router — chrome only
│   ├── src/board/
│   │   ├── BoardHost.tsx           dynamic(ssr:false) mount boundary
│   │   ├── render/
│   │   │   ├── loop.ts             dirty-flag-gated rAF
│   │   │   ├── static-layer.ts     committed shapes
│   │   │   ├── overlay-layer.ts    gesture, handles, cursors, ghosts
│   │   │   ├── path-cache.ts       Path2D per shape
│   │   │   ├── bitmap-cache.ts     OffscreenCanvas, keyed by stepped scale
│   │   │   ├── lod.ts              greeking + flat-fill thresholds
│   │   │   └── dpr.ts              backing store, dpr-change, half-pixel snap
│   │   ├── input/
│   │   │   ├── pointer.ts          Pointer Events, getCoalescedEvents
│   │   │   ├── gesture.ts          tier-1 state machine, commits on pointerup
│   │   │   └── wheel.ts            ctrl+wheel = pinch, zoom about pointer
│   │   └── hit.ts                  tier-3: isPointInPath/isPointInStroke
│   └── src/ui/                     toolbar/panels — zustand + useSyncExternalStore
│
├── apps/relay/src/
│   ├── server.ts                   http + upgrade: origin check, ticket redemption
│   ├── conn.ts                     per-connection state: userId, role, clientIDs
│   ├── gate.ts                     the permission gate (replaces messageListener)
│   ├── room.ts                     Y.Doc per room, lifecycle, eviction
│   ├── fanout.ts                   backpressure policy + awareness coalescing
│   ├── persist/
│   │   ├── log.ts                  append-only writer, debounced
│   │   ├── squash.ts               mergeUpdatesV2 into the head row
│   │   └── load.ts                 diffUpdateV2 from head, no Y.Doc for cold rooms
│   └── metrics.ts                  event-loop lag, GC, bufferedAmount, /metrics
│
└── packages/harness/src/
    ├── converge.ts                 fast-check property suite over N replicas
    ├── load.ts                     node clients over ws, worker_threads sharded
    └── measure.ts                  cold load, frame time, egress
```

---

## 5. Data model

```ts
// packages/core/src/schema/shape.ts
export const SHAPE_SCHEMA_VERSION = 1

export type Transform = {
  x: number; y: number; w: number; h: number; rot: number
}

export type ShapeBase = {
  id: string          // nanoid. NOT a Yjs Item id — those address ranges and
                      // change when structs split and merge.
  v: number           // schema version of THIS shape, not of the document
  t: Transform        // ONE key. See below.
  idx: string         // jittered fractional index — draw order
  author: string      // server-written. Never derived from clientID.
}
```

Three decisions, each with a reason that survives questioning:

**Geometry is one key `t`, not five.** Not for bytes — V2 makes the two models
within 6% **[M: `bench/crit1.mjs`]** — but for struct count and cold load, and
because it makes a transform atomic against a concurrent resize. Verified: a
concurrent `{x,y}` drag against an `{x,w}` resize converges on one client's whole
geometry rather than a mixture.

**Draw order is a jittered fractional index, sorted at render time.** Yjs has no
move operation — not in v13, not in the v14 RC (it shipped in a v14 prerelease,
corrupted arrays, and was pulled). Concurrent "bring to front" on a `Y.Array`
doesn't *risk* duplication, it **deterministically duplicates**: both replicas
converge on `["b","c","a","a"]` **[M]**, which renders as a doubled shape. Plain
fractional indexing makes two clients inserting between the same neighbours
generate the identical key, hence the jittered variant.

**Never iterate a `Y.Map` for draw order.** **[M: `bench/dbg2.mjs`]** Three replicas
given the same updates in different delivery orders are byte-identical but iterate
`["a","b","c"]`, `["c","b","a"]`, `["b","a","c"]` — `Y.Map` iterates internal
insertion order. Draw order comes from an explicit total sort on `idx`, always.

### Schema evolution: additive only

**[M: `bench/mig1.mjs`]** On a `Y.Map` key, a concurrent **`set` always beats a
`delete`** — `typeMapDelete` creates no struct, so the setter's item becomes the
rightmost in that key's chain. Swept across clientID pairings from 1 to
4,294,967,295: the setter wins every time.

So the naive rename — write `pos`, delete `x`, delete `y` — while one user is
offline **resurrects the legacy keys**. Both replicas converge byte-identically on
a shape carrying two contradictory positions, and a renderer reading `pos`
silently discards that user's offline work. Convergence preserved, correctness
destroyed, every test green.

Note this is the *opposite* of the rule one level up: a **parent** delete
(`shapes.delete(id)`) recursively kills the subtree and beats a concurrent child
write, in both clientID directions.

Therefore:

1. Migrations are **additive**. A legacy key is never deleted.
2. Every shape carries `v`. The reader resolves, with **legacy-wins-if-present**.
3. `migrate.ts` accepts **every historical value shape, forever** — a value-shape
   change on one key is decided by clientID, so the higher clientID picks which
   schema that shape has.
4. There is **no rollback**. Reverting is a forward transaction that leaves the
   document 43% fatter in structs than before it started **[M: `bench/mig3.mjs`]**.
   A migration is also a thundering-herd wire event: 2,000 shapes is a single
   68 KB update broadcast to every connected client at once.
5. The only thing that returns to baseline is an **epoch bump** (§9).

---

## 6. The seam

```ts
// packages/core/src/scene/store.ts
export interface SceneStore {
  get(id: string): Shape | undefined
  drawOrder(): readonly Shape[]              // sorted by idx, never map order
  query(rect: Rect): readonly Shape[]        // spatial hash, not a filter
  apply(cmd: Command, origin: Origin): void  // the ONLY write path
  subscribe(fn: (dirty: ReadonlySet<string>) => void): () => void
}
```

Two implementations: `MemoryStore` in `core` (single-player, and what the property
suite drives) and `YjsStore` in `crdt`. Nothing above this interface knows which
it has.

The renderer subscribes and marks ids dirty; **it never draws inside an observer**.
One rAF does the drawing. React reads only what it owns — toolbar, panels, presence
list — through `useSyncExternalStore` with a referentially stable snapshot.

Why React must not own the scene: the cost is (commits/sec × work/commit), and
shape count enters only the second term. One person dragging one shape at 120 Hz
is 120 commits/sec — that dies at *five* shapes, not five hundred. So the
architecture decision is forced in hour one, which is a stronger argument than the
one usually made for it. Note also that external-store updates cannot be
deprioritised with `startTransition`: React re-reads `getSnapshot` before committing
a Transition and restarts the work as blocking if the store changed. Coalesce to a
frame *before* notifying React.

---

## 7. Render pipeline

Two canvases. **Static**: committed shapes, redrawn when the camera or scene
changes. **Overlay**: the tier-1 gesture, selection handles, snap guides, remote
cursors and peers' drag ghosts, redrawn per frame. Budget deliberately — a
full-viewport canvas at 2560×1440 and dpr 2 is ~59 MB of backing store, so two,
three at the absolute most.

No dirty rectangles. Camera motion invalidates the whole viewport, overlapping
shapes force a redraw of most of the visible z-stack anyway, and every rect needs
inflating for antialiasing, miter joins, shadow blur and text overhang — which
produces artefacts that appear only on some frames. (Blit-scroll makes dirty rects
viable for *pure translation*; they die on zoom. Layering pays across both.)

Hit testing is three tiers: spatial-hash query at the pointer, AABB/OBB reject,
then `ctx.isPointInPath` / `isPointInStroke` against the cached `Path2D` on a 1×1
scratch context. No colour-coded hit canvas — that costs a second full draw pass
and a pixel read, and reading back from the main accelerated canvas can
de-accelerate it.

Selection handles draw in **screen space**: reset the transform, project the bounds
through the camera, draw fixed 8–10 CSS px handles. Hit slop is screen-space too
(`10 / cameraScale` in world units) and takes priority over shape hits.

LOD is not optional, because **culling saves nothing at zoom-to-fit**, which is the
first thing every user does. Greek text below ~6 px cap height; flat-fill and skip
stroke/shadow below a few px of on-screen size; decimate ink by zoom.

### Cold open is the worst frame in the app

**[M: `bench/cold.mjs`]** `Y.applyUpdate`, median of 5, plus the scene-store walk:

| shapes | V1 blob | applyUpdate | store walk | before first pixel |
|---|---|---|---|---|
| 1,000 | 145 KB | 50 ms | 3 ms | 53 ms |
| 5,000 | 756 KB | 231 ms | 14 ms | 245 ms |
| 20,000 | 3,093 KB | 780 ms | 38 ms | 818 ms |
| 50,000 | 7,786 KB | **2,027 ms** | 95 ms | **2,122 ms** |

`applyUpdate` runs inside one `Y.transact` — a single uninterruptible main-thread
task. It cannot be sliced. A warm load pays it **twice**: y-indexeddb hydrates,
then the socket delivers the server diff.

So: decode in a worker, hydrate the scene store and spatial index in chunks across
frames behind a low-fidelity first paint, and publish **time-to-first-shape-painted**
next to the frame-time percentiles. This is the number that matters most and the
one the original plan never had.

---

## 8. Sync and transport

**Awareness carries only volatile fields.** `encodeAwarenessUpdate` does
`JSON.stringify(state)` for the *whole* local state on every tick — there is no
field-level delta. Identity (name, colour) is set once at join or hoisted into a
`Y.Map` keyed by clientID; the tick carries `{c:[x,y]}` with integer coordinates.
**[M]** 170 B fat vs 26 B lean, an 85% cut.

**Cursors interpolate with a render delay.** Per-peer ring buffer, samples stamped
on *arrival* (awareness carries no timestamp), render at `now - D`, lerp between
the bracketing samples, extrapolate along last velocity for at most ~150 ms then
freeze. Honest total: ~200 ms behind reality, which is fine for other people's
cursors and not fine for your own ink.

**Ingest is coalesced to a frame.** Buffer inbound binary and apply it inside one
outer `Y.transact` per rAF — Yjs transactions nest, so inner `applyUpdate` calls
join the outer transaction and observers fire once per frame instead of a thousand
times a second.

**Keep the awareness self-echo.** The relay must *not* skip the originator when
fanning out. `y-websocket` closes any socket with no **inbound** message for 30 s,
and its own source comments that the client's own awareness echo — re-announced
every 15 s — is what feeds that timer. WS ping/pong is invisible to page JS.
Suppressing the echo puts a **solo** user into a permanent close/reconnect loop.
Coalesce awareness into a 20–30 Hz tick; keep the sender in the fan-out.

**`resyncInterval` defaults to `-1`.** Nothing periodic heals a stalled client;
re-offering is reconnect-driven only. Surface `doc.store.pendingStructs !== null`
in the connection indicator — a causally-stalled client looks *connected* and
silently stops updating, and it is the bug most likely to ship.

**BroadcastChannel is on by default** (`disableBc = false`), and the channel name is
`serverUrl + '/' + roomname` — *excluding* the auth params, so two tabs with
different tickets share one channel. Consequences: pass `{disableBc: true}` in every
test, record demo captures across two browsers, and assert server-side that both
clients exchanged frames. Keep it on in production; free cross-tab sync is a
feature. (Two tabs are two `Y.Doc`s, hence two clientIDs, hence two cursors both
wearing your own name.)

---

## 9. Relay

Four layers, in order, and the order is the design:

```
transport   http upgrade: Origin allowlist, ticket redemption, maxPayload
gate        per-message facet check BEFORE anything is applied
room        Y.Doc per room, epoch, lifecycle, eviction
persist     append-only log + debounced squash + diff-based load
```

**The gate replaces the message listener; it cannot wrap it.** The reference
server's handler calls `readSyncMessage`, which applies the update *and* triggers
the broadcast before any wrapper of ours runs. There is no hook. So we gate inside
our own handler: read the outer varUint on a throwaway decoder, and if it is `0`
read the inner one. Drop inner `1` (SyncStep2) and `2` (Update) from a viewer;
allow inner `0` (SyncStep1 is a *read* request); allow outer `1` (awareness,
validated separately); drop outer `2` (auth is server→client only). Pass the
**original** bytes on — `readVarUint` mutates decoder position.

**The relay takes no upstream server dependency.** `y-websocket@3.1.0` ships no
`bin` and no server — it is the client provider only. Its successor,
`@y/websocket-server@0.1.5`, is **v14-line code**: it depends on `yjs: ^14.0.0-7`
and `@y/protocols`, and pins `ws: ^6.2.1`. Depending on it under our `yjs 13.6.32`
override would silently force a v13 copy beneath a package written against v14
internals. Of its four published versions only `0.1.1` targets `y-protocols@^1.x`,
and it is the oldest. So `apps/relay` is built directly on `ws@8`,
`y-protocols@1.0.7` and `yjs@13.6.32`, with the upstream server read as a
*reference* and not installed. Hand-writing the relay was the point; this only
removes a dependency that would have had to be forked immediately anyway.

**There is no "reject" primitive.** The client applied the change before it sent a
byte. Dropping the frame forks it permanently: the user watches their work on a
board nobody else has while the indicator says connected, and y-indexeddb makes the
fork survive a reload. So denial is three things: drop the frame, send
`messageAuth`/`writePermissionDenied`, and close with **4401** — which
`y-websocket 3.1.0` already treats as permanent via `defaultShouldReconnect`,
stopping the reconnect loop and emitting `closed`. The client then recovers by
undoing its own stack (an `UndoManager` scoped to its local origin) or, failing
that, `provider.destroy()` + `indexeddbProvider.clearData()` + resync from zero.

**A viewer with offline persistence is the subtle case**: a *correct* gate produces a
*bad* outcome, because the viewer's local structs are re-offered on every reconnect
and render forever. Viewers do not get an IndexedDB provider.

**Auth transport.** A browser `WebSocket` cannot set request headers, so there is
no `Authorization` on the upgrade. We mint a 128-bit single-use ticket from an
authenticated HTTPS route, store it in Redis with a 30 s TTL, and redeem it with
`GETDEL` at upgrade. Query-string leakage into access logs stops mattering when the
ticket is dead in 30 seconds and after one use. The room is resolved **from the
ticket**, never from the client-supplied URL path — otherwise any string is a
readable, creatable room and human-readable ids are enumerable in minutes.
`Origin` is validated in the upgrade handler: WebSocket is exempt from CORS, so
without it any site can open an authenticated socket. A socket verified once
outlives its token, so: an `exp` timer, a Redis revocation channel, and a periodic
membership re-check.

**Resource control is where the relay stops being dumb.** The reference server
never inspects `ws.bufferedAmount`, so one suspended tab buffers unboundedly until
the process dies. Policy: above ~256 KB buffered, **drop awareness** for that
connection (ephemeral and self-healing); above ~4 MB, `terminate()` — not
`close()`, which waits for a handshake a stalled peer will never complete — and let
Yjs's idempotent resync do the rest. That asymmetry is the load-bearing insight:
presence can be shed with no correctness cost, document updates cannot.

**The orphan-update DoS is CPU-quadratic and a size cap does not stop it.**
**[M]** 4,000 updates referencing fabricated `(client, clock)` pairs — 877 KiB of
total upload, ~220 bytes per frame — consumed **103 seconds** of blocked event loop,
superlinearly, because every arriving orphan re-merges the whole accumulated
`pendingStructs` blob. It throws nothing and leaves the document empty. Worse,
`encodeStateAsUpdate` **serialises `pendingStructs`**, so the garbage is written
into the snapshot and reloaded forever. Defence: assert
`pendingStructs === null && pendingDs === null` after every apply — on an
authoritative server reading an ordered stream after initial sync, any pending state
is anomalous — plus a `parseUpdateMeta` pre-screen rejecting clients the room has
never seen.

**Awareness has no sender binding.** `applyAwarenessUpdate` accepts any
`(clientID, clock, state)` triple whose clock beats the stored one, so one
authorised editor can impersonate another user's cursor and name, remove them from
everyone's presence list with a null state, or invent 100k clientIDs in one frame.
The fork already maintains `conn → Set<clientID>` for disconnect cleanup, so
enforcement is a few lines against existing bookkeeping; identity is **overwritten**
with the server's, via `modifyAwarenessUpdate`, rather than validated.

### Epoch

Every room carries an integer `epoch`. It appears in the y-indexeddb store name
(`board:{id}:e{n}`) and in the handshake. A rebuild writes `epoch + 1`; the server
refuses older epochs with a typed 4400-range close code; the client clears its
local store and reloads. This is the only mechanism that resets struct count and
clientID cardinality, it is lossy by construction, and it runs only on a room with
no connected clients. It is for schema and struct-count problems — **not** for
bytes.

---

## 10. Storage

```sql
CREATE TABLE doc_updates (              -- hot path. Rows of tens of bytes.
  room_id   uuid NOT NULL,
  seq       bigserial,
  epoch     int  NOT NULL,
  user_id   uuid NOT NULL,              -- the audit trail. clientID is not identity.
  client_id bigint NOT NULL,
  update    bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE doc_head (                 -- squashed snapshot, V2-encoded
  room_id   uuid PRIMARY KEY,
  epoch     int  NOT NULL,
  seq_watermark bigint NOT NULL,
  version   int  NOT NULL,              -- optimistic concurrency
  blob      bytea NOT NULL,
  sv        bytea NOT NULL
);
ALTER TABLE doc_head ALTER COLUMN blob SET STORAGE EXTERNAL;
```

**V2 at rest.** `encodeStateAsUpdateV2` is the entire compaction story: **[M:
`bench/crit3.mjs`]** a 250-session board is a 6.03 MB append-only log, 1.16 MB V1,
and **230 KB V2** — 26× smaller, lossless, no migration, no client reload. The
lossy history-dropping rebuild the original plan reached for buys 187 KB against
that 230 KB: **19%**, in exchange for invalidating every offline client's queued
work. Not worth it. The wire protocol is V1, so `crdt/` owns the conversion
boundary and keeps a V1 fallback.

Note honestly: **V2 fixes churn bytes, not content bytes.** 5,000 rectangles is
756 KB V1 / 423 KB V2. 5,000 120-point pen strokes is 4.0 MB V1 / **3.9 MB V2** — a
4% saving. Any published size claim names the encoding *and* the shape mix.

**Never overwrite a single blob row.** That is a read-modify-write on a CRDT — the
lost-update pattern this project exists to talk about — and every `UPDATE` of a
TOASTed value rewrites the whole TOAST chain plus WAL. Appends never conflict; the
squash takes `FOR UPDATE` on the head row and guards on `version`.

**Load without instantiating a document.** `diffUpdateV2(headBlob, clientSV)`
operates on encoded bytes, so a cold room costs one `SELECT` and a streaming
re-encode. It always writes the **full delete set** — an irreducible ~6.6 KB floor
per connect on that board **[M]** — because dropping delete markers would let an
offline client resurrect deleted shapes. Cache the encoded snapshot per room,
regenerated at most every 250 ms, so a join burst shares one encode.

**`pg`, pinned `>= 8.23.0`.** That version's `prepareValue` has the zero-copy
`ArrayBuffer.isView` branch; older 8.x silently `JSON.stringify`s a `Uint8Array`
into `bytea` and corrupts the document with no database error. Never
`new Uint8Array(buf.buffer)` on a pg `Buffer` — it is a slice of a pooled
`ArrayBuffer`.

---

## 11. Enforced invariants

Each is a test, not a guideline.

1. `packages/core` imports no `yjs`, no `react`, no `node:*`. *(CI: `pnpm arch`.)* Its
   patterns match the **bare specifier** as well as the resolved path — without that, an
   import into `core` fails as `not-to-unresolvable`, which is a CI failure with entirely
   the wrong explanation.
   The other half is **lib** purity: `core` and `protocol` declare `types: []` and no DOM
   lib, so a platform global like `TextEncoder` is a boundary violation. The root typecheck
   *cannot* see that — it has DOM and node libs — so `pnpm typecheck:pure` builds those two
   projects on their own. Tests are excluded from it: purity is a property of shipped code,
   and a test legitimately runs in node.
2. One resolved `yjs`; a nested type crosses the app boundary without throwing.
   *(CI: `node scripts/check-single-yjs.ts` for the tree, `assertSingleYjsInstance()` for
   the runtime — the second is needed because two module instances loaded from one
   directory through different export conditions are invisible on disk.)*
3. Every write goes through `SceneStore.apply` with an explicit origin. No
   `ymap.set` outside `packages/crdt/src/tx.ts`.
4. Draw order comes from sorting `idx`. Nothing iterates a `Y.Map` for order.
5. Every gesture is exactly one transaction and exactly one undo step.
6. Every value written to the document passes `validate.ts` — **at the observer
   boundary**, not the write boundary, because an attacker skips ours. A `Y.Map`
   otherwise accepts `NaN`, `Infinity`, `undefined`, `'banana'` in a numeric field,
   and a 10 MB string, silently, to every replica **[M: `bench/types.mjs`]**.
   Corollary: no `Date` in the document — it arrives at every other replica as `{}`,
   type-identical in TypeScript and divergent at runtime **[M]**. Store epoch millis.
7. `pendingStructs === null` **on a quiesced replica**, and unconditionally on the
   authoritative server once initial sync has completed.
   Not at every intermediate state — that was wrong in the first draft of this
   document. A replica mid-partition legitimately holds unintegrated structs; that is
   the causally-stalled client the sync indicator exists to *surface*, not a state to
   forbid. Asserting it too early makes the property suite fail on legal traffic,
   and an invariant that fails on legal traffic gets disabled.
8. Convergence is a **normalised** byte digest **plus** a content digest. Two probes,
   because one level is provably not enough.
   - **Not the state vector.** Two docs sharing a clientID converge on *identical
     state vectors and different content* **[M]** — the only failure that produces
     genuine permanent non-convergence, so a state-vector assertion passes on
     precisely the bug that matters.
   - **Not `toJSON()`.** Unstable across delivery order: byte-identical replicas
     iterate a `Y.Map` in different orders **[M]**.
   - **Not the raw `sha256(Y.encodeStateAsUpdate(doc))` either** — this corrects the
     first draft. Under `gc: true` (decision D2's default) a *legal* operation breaks
     it: a client writing into a subtree it already knows is deleted leaves one
     replica holding the struct as a `GC` marker and the other as a deleted `Item`.
     Byte digests differ, state vectors are equal, content is equal, and three resync
     rounds plus a forced transaction do not heal it **[M]**. Re-encode through a fresh
     `Y.Doc` before hashing; verified to return equal on that benign case while still
     returning *unequal* for the shared-clientID divergence.
   - **And a content-level probe alongside it**, because a `Date` written to the
     document converges at the byte level — both sides encode `{}` — while the writer
     holds a real `Date` and every peer holds `{}` **[M]**. A byte-only probe reports
     "converged" on a document that renders differently on every machine.
9. `doc.clientID` is never used for identity, attribution, or authorisation. It is
   `random.uint32()` per `Y.Doc` instance, forgeable in one assignment
   (`doc.clientID = 4294967295` wins every genuinely-concurrent field race in the
   room, forever), and 32 bits gives ~50% collision odds around 77k lifetime
   clients. And never "fix" churn by persisting one: two tabs sharing a clientID
   never converge, silently **[M]**.
10. The property suite asserts, at every intermediate state: unique ids,
    exactly-once draw order, no orphaned parent references, no `NaN` geometry, and
    byte-identical replicas under randomised delivery, duplicate delivery, and
    partition-then-heal.

---

## 12. Open decisions

| | Decision | Default if unanswered | Why it must be decided early |
|---|---|---|---|
| **D1** | Sticky-note text: `Y.Text`, plain string, or cut | **Cut from slice 1.** A note you cannot type into is a visible bug; a plain string makes note text a same-key race, so one typist loses the whole paragraph — the exact failure this project promises to solve. | Changes the shape schema and, for `Y.Text`, adds a camera-positioned DOM overlay subsystem. |
| **D2** | `gc: true` vs `gc: false` on the server document | **`gc: true`.** Deleted content is reclaimed at every transaction (223 KB → 124 KB on deleting half of 2,000 shapes **[M]**). No time travel, stated as a deliberate tradeoff. | Cannot be enabled retroactively. `createDocFromSnapshot` throws on a `gc:true` doc; `Y.snapshot` itself does *not* throw, it silently returns a snapshot whose content is already gone. |
| **D3** | Scope: re-scoped (4–6 weeks) vs full original | **Re-scoped.** Renderer-first, both captures by end of week 2, property suite, coarse gate, cold-load work, comparative write-up. Cut: 50-client load test, JWT/accounts/roles, ellipses, Playwright beyond one smoke test. | Determines which folders get filled, not where the boundaries are. |

None of the three moves a boundary in §3. That is the point of writing this first.

---

## 13. What gets measured

Published numbers carry: the harness path in this repo, exact hardware/OS/browser,
an explicit workload definition, a distribution with sample count (never a mean,
never "fps" — that is a vsync ceiling), a counterfactual, and **the point where it
breaks**. A number without a stated breaking point reads as marketing.

- time-to-first-shape-painted vs board size, naive vs worker-decode + progressive
- updates and bytes **per user gesture**, before and after commit-on-pointerup
- struct count and cold load, naive vs disciplined write pattern (the 3×3 table)
- p50/p95/p99 frame time + long-frame count at zoom-to-fit, LOD on/off
- input-to-photon ink latency, local and remote, stated separately
- awareness bytes fat vs lean; relay sends/s before and after coalescing
- egress GB and cost per room-hour
- convergence suite: replicas, seeds run, invariants asserted, **bugs it caught**
```
