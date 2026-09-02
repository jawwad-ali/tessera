# Tessera

A multiplayer whiteboard. Two people draw on the same board at the same time, everyone's
cursor moves live, and edits merge correctly even after someone has been offline — with the
sync layer and the renderer written by hand rather than bought.

- **CRDT sync** on Yjs, pinned to one copy, with the write path funnelled through a single
  transaction choke point.
- **A hand-written canvas renderer** — layered canvases, a spatial index, `Path2D` and
  bitmap caches, LOD by zoom. No canvas library.
- **A hand-written WebSocket relay** — transport, permission gate, room, persistence. No
  hosted sync SDK.

## Read this first

**[ARCHITECTURE.md](./ARCHITECTURE.md)** is binding, not aspirational. It defines the module
boundaries, the four state tiers, the shape schema and its migration rules, the relay's
layering, and ten invariants that are enforced in CI rather than in review.

Every constraint in it that carries a number is marked **[M]** and names the script that
produced it, so any claim here can be re-run and challenged.

## Layout

```
packages/core       the scene, schema, geometry, rules — no yjs, no react, no node
packages/protocol   wire messages, frame reading, permission facets
packages/crdt       the Yjs binding — the only package that touches a Y type
packages/harness    property/convergence suite, load client, measurement
apps/web            Next.js host: chrome in React, board on canvas
apps/relay          the relay: transport, gate, room, persistence
```

## Commands

```bash
pnpm install
pnpm dev            # web + relay together
pnpm verify         # typecheck, lint, architecture rules, tests — what CI runs
pnpm arch           # the dependency-graph invariants on their own
pnpm test:converge  # randomised delivery order, duplicate delivery, partition-then-heal
pnpm bench          # regenerate the published measurements
```

## Why the boundaries are shaped this way

`packages/core` imports no yjs, no react and no node. That single rule is what lets the
convergence suite drive the real command vocabulary against N in-process replicas with no
browser and no network, keeps the renderer off the CRDT's hot path, and makes the CRDT
swappable — which is how single-player got built first behind the same `SceneStore` seam.

It is enforced by `pnpm arch`, not by convention.
