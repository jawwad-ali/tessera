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
