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
| `applyUpdate` on a ~7.8MB blob | **488–1,939ms across 4 runs** (09-03: 1,838, 1,939 · 09-05: 488, 748) | `bench/cold.mjs` | 50,000 rect shapes, one `Y.transact` | 4 runs, two days | **not gated** — see D-7 | Blob size 7,786 KB is gated instead (structural, tolerance 0) |
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

## Updates and bytes per gesture — commit-on-pointerup vs naive (4.C3)

The wire cost of the one rule Phase 4 pins irreversibly. A relay fans every update out to every
peer, so this number times peers times gestures *is* the network. Reproduce with `node
bench/gesture.mjs`; gated by `pnpm bench:check` through three pre-registered claims in
`bench/expectations.json`.

| drag of | strategy | update messages | bytes on the wire | doc after (V2) |
|---|---|---|---|---|
| 1 shape, 60 frames | naive — one transaction per frame | **60** | 2,969 | 80 |
| 1 shape, 60 frames | **commit on pointerup** | **1** | **50** | 79 |
| 3 shapes, 60 frames | naive | 60 | 6,663 | 187 |
| 3 shapes, 60 frames | commit on pointerup | 1 | 120 | 178 |

**Ratios, single shape:** 60× fewer update messages, **59.4× fewer bytes**. Three shapes: 60× and
55.5×.

**Registered 2026-09-05, before the script existed:** exactly 1 update per gesture on pointerup
(structural, tolerance 0 — met), exactly 60 for naive (met), and a byte ratio of **≥ 10×
required** with **~40× predicted**. The ratio came in at 59.4×, inside the registered 10–70×
window, so the gate passes — and the prediction was low by half again. The model under-counted
the per-update framing overhead: each naive update carries its own struct id, clock and message
envelope around a payload that is a few numbers.

**A registration error, recorded rather than edited.** PHASES.md's threshold table says
"exactly 3 for three shapes". That is the number of *structs* a three-shape gesture writes (one
per `t`), which `bench/crit1.mjs` measured in Phase 0 — not the number of *update messages*,
which is one, because one transaction is one update however many keys it touches. The table
conflated the two. The measured value (1) is better than the registered one (3), so nothing
here is a fudge, but a threshold that mixes units is a threshold that could have been met
wrongly, and it is worth saying so.

**The document itself barely grows either way** (80 vs 79 bytes under `gc: true`), because the
naive strategy's 59 superseded writes are garbage-collected at the next transaction. The cost is
not in what is stored; it is in what is *sent*, sixty times, to everyone.

Envelope: `bench/gesture.mjs`, yjs 13.6.32, Node v24.11.0, deterministic (byte counts are
structural — no timing involved), rect shapes with one `t` key, 60 frames per drag.

## D-7 — the cold-load timing was a load-contaminated baseline

Phase 0 registered `applyUpdate` on the 50,000-shape blob at 2,027ms ±50% and measured 1,838 and
1,939ms. Two days later, same code, same Node, same yjs, same machine on AC power: **488ms**, then
**748ms**. Nothing in the dependency tree changed. The 09-03 readings were taken while the same
laptop was running test loops and a CI workflow; the 09-05 readings were on a quiet machine — and
even those two differ by 1.5×.

A 4× spread is not something a tolerance should absorb, and widening one to make a gate pass is
the thing `bench:check`'s own failure message forbids. So the gate is **replaced**, not widened:
what is structural — the blob is 7,786 KB and is applied in one uninterruptible transaction — is
gated at tolerance 0; what is timing is published here as a distribution with its conditions and
is not a pass/fail claim. The architectural point survives unchanged: even the fastest reading is
**29 dropped frames** of main thread, proportional to board size, and that is the case for
Phase 11's worker decode.

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
