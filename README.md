# Tessera — collaborative whiteboard with CRDT sync

Real-time multiplayer whiteboard built on Yjs, with a hand-written canvas renderer and a
hand-written WebSocket relay — no hosted sync SDK, no canvas library.

[![ci](https://github.com/jawwad-ali/tessera/actions/workflows/ci.yml/badge.svg)](https://github.com/jawwad-ali/tessera/actions/workflows/ci.yml)
![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000?style=flat-square&logo=nextdotjs&logoColor=white)
![Yjs](https://img.shields.io/badge/Yjs-13.6.32-1e1e1e?style=flat-square)
![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?style=flat-square&logo=pnpm&logoColor=white)

Two people draw on the same board at the same time, everyone's cursor moves live, and edits
merge correctly even after someone has been offline. The interesting part is not the drawing —
it is deciding who wins when two people change the same thing at the same moment, and doing it
without a server refereeing every conflict.

---

## Status: pre-alpha — foundations, not yet a running app

**There is no runnable whiteboard yet.** This section is deliberately explicit, because the
alternative is a README that describes a product the repository does not contain.

**What exists and is tested — 79 tests, `pnpm verify` green:**

| Built | What it is |
|---|---|
| Architecture + enforcement | [ARCHITECTURE.md](./ARCHITECTURE.md) with 10 invariants that **fail CI**, not just prose: a dependency-rule set, a lib-purity typecheck, and a single-Yjs-copy guard |
| `packages/protocol` | Complete. Frame classification, three-outcome permission adjudication, facets, close codes — plus interop tests that build frames with the real `y-protocols` and prove the gate composes with `readSyncMessage` |
| `packages/core` — camera | Pure 2D affine camera, property-tested, and mutation-tested to confirm the properties fail on a broken implementation |
| `packages/core` — spatial index | Uniform spatial hash for culling and hit testing, differential-tested against a brute-force scan |
| `packages/core` — contracts | The shape schema, command vocabulary and store seam, as types only — zero runtime exports, so implementations must satisfy them |
| `packages/crdt` | The runtime single-Yjs-instance guard |

**Not built yet:** the renderer, the input layer, the Yjs store binding, the relay, persistence,
auth, and the convergence suite. `apps/web` and `apps/relay` are manifests only.

**[PHASES.md](./PHASES.md)** is the tracker: 12 phases, 37 exit criteria, a named
DEMO-COMPLETE gate after which every phase is optional, and the known defects in the current
commit. A live URL arrives at Phase 3.

---

## The problem it solves

Two people edit the same thing at once. Whose change wins?

"Last save wins" quietly destroys work — you move a shape, your colleague moves a different
one, and one of you overwrites the other. A CRDT answers this properly: every change carries
enough information to be merged in any order, so all replicas converge on the same result with
no server arbitrating.

What that costs, and what it does *not* give you for free, is the substance of this project:

- **Concurrent same-field writes resolve by client ID, not by clock.** Higher client ID wins,
  and `clientID` is a random 32-bit number minted per document instance — so the tie-break is
  neither fair nor stable across a page reload.
- **A concurrent `set` always beats a `delete`** on a map key, while a *parent* delete beats a
  concurrent child write. Two opposite rules at two levels, which is why a naive field rename
  silently discards an offline user's work.
- **Convergence is not one property.** Byte-level agreement and content-level agreement are
  different things: a `Date` written to the document converges byte-identically while the
  writer holds a real `Date` and every peer holds `{}`.

Each of those was established by running code against `yjs@13.6.32`, not by reading blog posts.
The measurements are marked `[M]` in ARCHITECTURE.md and are reproducible.

---

## Architecture in one paragraph

One rule carries the codebase: **`packages/core` imports no yjs, no react and no node.** That
is what lets the convergence suite drive the real command vocabulary against N in-process
replicas with no browser and no CRDT, keeps the renderer off the CRDT's hot path, and makes the
CRDT swappable behind a single `SceneStore` interface — which is how single-player gets built
first and multiplayer swaps in behind it.

It is enforced by `pnpm arch`, not by convention. Every rule cites the measured reason it
exists.

```
packages/core       the scene, schema, geometry, rules — no yjs, no react, no node
packages/protocol   wire messages, frame reading, permission facets, close codes
packages/crdt       the Yjs binding — the only package that touches a Y type
packages/harness    property/convergence suite, load client, measurement
apps/web            Next.js host: chrome in React, board on canvas
apps/relay          the relay: transport, gate, room, persistence
```

---

## Tech stack

| Layer | Choice | Why this one |
|---|---|---|
| CRDT | **Yjs 13.6.32**, pinned | Used directly, not through a hosted service. Pinned to one resolved copy — two copies make nested types throw while binary updates keep working, so the bug hides until the first `Y.Text` |
| Transport | **`ws`** + `y-protocols` | The relay is hand-written. `@y/websocket-server` was rejected: it is v14-line code (`yjs ^14.0.0-7`) and pins `ws ^6` |
| Rendering | **Canvas 2D**, hand-written | No Konva, no Fabric, no tldraw SDK. The render loop is the project |
| Frontend | **Next.js 16** · React 19 · TypeScript 6 · Tailwind 4 | TypeScript is pinned `~6.0.3` — `typescript-eslint` caps at `<6.1.0`, so TS 7 silently costs type-aware linting |
| Storage | **Postgres** + raw `pg` (`>=8.23.0`) | Prisma rejected: no expressive `ON CONFLICT … WHERE version`. Older `pg` silently corrupts `bytea` from a `Uint8Array` |
| Testing | **Vitest** + **fast-check** | Property-based, with a seeded shrinker |

---

## Getting started

```bash
pnpm install
pnpm verify        # typecheck → lib purity → lint → architecture rules → tests
```

`pnpm dev` exists but has nothing to serve yet — see Status above.

```bash
pnpm arch          # the dependency-graph invariants alone
pnpm typecheck:pure  # core + protocol must build with no DOM and no node types
node scripts/check-single-yjs.ts   # exactly one physical copy of yjs
```

---

## What is actually novel here

Three things, all checkable in under a minute rather than taken on trust:

1. **No hosted sync SDK and no canvas library** — verifiable from `package.json`. No
   Liveblocks, no Convex, no PartyKit, no `@tldraw/*`, no Konva. Enforced by `pnpm arch`.
2. **The architecture is executable.** Ten invariants fail CI. Try adding
   `import * as Y from 'yjs'` to `packages/core` and run `pnpm arch`.
3. **Measurements are reproducible and carry their methodology** — sample count,
   distribution, hardware, workload and a stated breaking point. A number without those gets
   discounted, and rightly.

---

## License

MIT — see [LICENSE](./LICENSE).
