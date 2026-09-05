# Measurements

Every number here is reproduced by a committed script and checked by `pnpm bench:check`
against a **pre-registered** tolerance in [`bench/expectations.json`](../bench/expectations.json).
A tolerance entered after seeing a number is not a tolerance, so drift fails the gate rather
than quietly widening it.

**Environment for every row below:** Intel Core i5-1135G7 @ 2.40GHz (8 threads), Windows
10.0.26200, 17GB RAM, Node v24.11.0, yjs 13.6.32. Captured 2026-09-03 at commit `a436dc9`.

| Claim | Value | Harness | Workload | n | Tolerance | Breaking point |
|---|---|---|---|---|---|---|
| Per-frame drag writing `x` and `y` | **+12,000 structs** | `bench/crit1.mjs` | 200 shapes, 100 drags × 60 frames, float coords | deterministic | **0** — structural | Any change means `Item.mergeWith` behaviour changed |
| The same drag writing one `transform` key | **+200 structs** | `bench/crit1.mjs` | as above | deterministic | **0** — structural | as above |
| V2 encoding vs the append-only log | **26.8× smaller**, lossless | `bench/crit3.mjs` | 250 sessions, 2,000 live shapes, 124,000 updates | deterministic | **0** — structural | — |
| `applyUpdate` on a ~7.8MB blob | **1,939ms** (doc: 2,027ms) | `bench/cold.mjs` | 50,000 rect shapes, one `Y.transact` | 1 run | ±50% — hardware-bound | Crosses 1s at ~20,000 shapes (measured 362ms) |
| 50k-shape **object** scene across a worker boundary | **261ms** | `bench/worker.mjs` | 50,000 shapes as plain objects, `postMessage` round trip | 1 run | ±60% — hardware-bound | — |

## Frame time, LOD off — the Phase 3 baseline (3.C4)

The pre-registered counterfactual for Phase 11. Taken **before any optimisation exists**, from a
production build (`next build && next start`, never `next dev`), at zoom-to-fit — where culling
removes nothing, so this is the renderer's worst case by design. Reproduce with
`pnpm --filter @tessera/web e2e -g "frame time"`; raw output lands in `bench-out/frame-time-*.json`.

| shapes | p50 | p95 | p99 | max | long frames (>16.7ms) | n |
|---|---|---|---|---|---|---|
| 5,000 | 6.1ms | **11.6ms** | 15.0ms | 15.0ms | 0 / 60 | 60 |
| 7,500 | 10.2ms | 14.3ms | 21.7ms | 21.7ms | 1 / 60 | 60 |
| 10,000 | 12.7ms | **16.5ms** | 22.7ms | 22.7ms | 3 / 60 | 60 |

**Requirement (registered 2026-09-03 in PHASES.md, before this code existed): p95 ≤ 16.7ms at
5,000 shapes.** Met, with 5.1ms to spare. A second run at 5,000 during the same session gave p95
12.4ms; treat the run-to-run spread as roughly ±1ms.

**Breaking point:** p95 reaches one vsync at **≈10,000 shapes** — 16.5ms at 10,000, which is the
fixture's cap (`FIXTURE_MAX`). Above that the measurement would need a larger fixture, and Phase 11
is the phase that would justify one.

**Prediction, registered alongside the requirement: ~30ms p95 at 5,000.** Wrong by about 2.5×, in
the pessimistic direction. The model assumed ~3µs per Canvas 2D fill-plus-stroke on this hardware;
the measured cost is closer to 1.2µs. The requirement did not move; the model was.

Envelope:

| | |
|---|---|
| Harness path | `apps/web/e2e/frame-time.spec.ts` → `window.__tessera.frames` (`apps/web/src/board/bench.ts`), one `performance.now()` pair around each paint |
| What the number is | JavaScript paint time: cull + plan + Canvas 2D calls *issued*. Compositing is after the frame returns and is not in it; the long-frame column is the check on that |
| Hardware / OS | Intel i5-1135G7 @ 2.40GHz (4C/8T), Iris Xe integrated graphics, 15.7GB, Windows 11 Pro 10.0.26200 |
| Browser / runtime | Chromium 151.0.7922.34 via Playwright 1.62, headless; Node v24.11.0 |
| Viewport / dpr | 1280×720 CSS px, **dpr 1** (pinned in `playwright.config.ts`) |
| Refresh rate | Not measured — the run is one pointer move per `requestAnimationFrame`, so vsync bounds the cadence but not the paint duration reported |
| Timer resolution | Chromium coarsens `performance.now()` to 0.1ms; every value above is quantised to that |
| Workload | `/b/demo?seed=1&n=N&bench=1`, rect shapes only, seeded fixture, 60 pointer moves alternating ±4px so the camera stays at zoom-to-fit and every shape is repainted every frame (`shapesVisible === N` asserted) |
| Distribution | p50/p95/p99 over 60 frames after the warm-up paints are discarded; never a mean, never fps |
| Counterfactual | This table *is* the counterfactual. Phase 11's LOD, bitmap cache and worker decode are measured against it |
| Baseline sha | `ed29d17` — the commit that introduced the renderer measured here |
| Not measured | Ink shapes (the fixture is rect-only, so this is the rect-heavy figure and must not be blended with an ink-heavy one); dpr 2; a discrete GPU |

## The counterfactual that matters

The worker spike was run because Phase 11 proposes decoding the document off the main thread,
and that only helps if the decoded scene can actually get back cheaply. Measured, same run:

| Transport | 50,000 shapes |
|---|---|
| `structuredClone` in-process (objects) | 223.6ms |
| `postMessage` round trip (objects) | **261.0ms** |
| `postMessage` round trip (transferable typed arrays) | **0.3ms** |

**~870×.** An object scene costs the same order as the 1,939ms decode a worker exists to
hide, so moving the decode off-thread and shipping objects back would consume most of the
benefit. Transferable typed arrays are effectively free.

This retires the assumption Phase 11 rested on, and it constrains the scene model *now*
rather than at hour 110: geometry has to be flat typed arrays, not arrays of objects. That
also happens to be what an `OffscreenCanvas` renderer needs anyway, since `Path2D` is not
structured-cloneable and the worker must rebuild paths from plain geometry.

## What is deliberately not here

Frame time, input-to-photon latency and time-to-first-shape-painted. All three need a renderer,
which does not exist until Phase 3 — and Phase 3's exit criteria pre-register their bounds
before that work starts, so they cannot be re-baselined afterwards.
