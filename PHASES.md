# Tessera — Phases

**This is the project's single tracker.** If work happened and this file did not change, the
work is not tracked. If this file claims something the repo does not contain, this file is
wrong and gets fixed in the same commit that finds it.

Companion documents: [ARCHITECTURE.md](./ARCHITECTURE.md) is binding and is not re-litigated
here. This file says *when* and *how we know it is done*; that one says *what* and *why*.

---

## How to update

1. Set the phase's **Status** field. Legend below.
2. Tick tasks as they land. A task is ticked when it is committed, not when it works locally.
3. Tick exit criteria **only after running the verifier in the row**. The verifier is a
   command, a committed path, or a named test — never a judgement.
4. Fill **Actual** hours and **Unplanned** count when the phase closes. Those two numbers are
   the only inputs that make the next estimate honest.
5. Update **Evidence** with the link or committed path a reviewer opens.
6. Append to **Slip risk** what actually went wrong. Do not delete the prediction.

| Status | Meaning |
|---|---|
| `not-started` | No commits against it. |
| `in-progress` | At least one task ticked, not all exit criteria green. |
| `blocked` | Named blocker in the phase's row. A blocked phase must name what unblocks it. |
| `done` | **Every** exit criterion green. Not "done except". |
| `cut` | Deliberately dropped, with a dated line saying who decided. |

**Progress is `criteria-green / criteria-total`.** There is no percent-complete field, because
a percent is a feeling. A phase is never "90%".

---

## How exit criteria are written

These five rules exist because a tracker with fudgeable criteria converts *unfinished* into
*in progress*, indefinitely.

1. **No vacuous criteria.** Every criterion is run at the phase's *start* commit. Anything
   that already passes is deleted or rewritten. (`pnpm verify` is green at `e61aedf`, so
   "`pnpm verify` green" is not an exit criterion for anything — it is a standing obligation.)
2. **One human row, maximum.** Each criterion is `command` | `artifact` | `number` | `human`.
   No phase may hold more than one `human` row, and **no phase may exit on a `human` row
   alone.** A capture that "shows" something is a `human` row and needs a headless assertion
   beside it.
3. **Thresholds are pre-registered.** Every bound, tolerance and budget is written into this
   file, dated, *before* the phase opens. A threshold first entered after the measurement is
   a failed phase, not a passed one.
4. **Evidence must be reachable.** Every evidence path is checked with `git ls-files`.
   `bench-out/` is gitignored, so nothing exits on a file that lives only there. Settled in
   Phase 0 (defect **D-3**): raw runs stay ignored, while the *contract*
   (`bench/expectations.json`) and the *conclusion* (`docs/measurements.md`) are committed —
   so no published number depends on a file a reviewer cannot open.
5. **No criterion may be conditional on discovering a bug.** "At least one real bug found"
   is unsatisfiable when the code is correct, and it invites a planted bug filed as a found
   one. Planted mutants gate a phase; found bugs are write-up evidence.

---

## Dashboard

Estimates are evening-hours. Cumulative assumes ~10–12h/week.

| # | Phase | Status | Est | Act | A stranger sees | Evidence | Post-gate optional |
|---|---|---|---|---|---|---|---|
| 0 | Foundations made honest | `done` | 3–5h | ~5h | A public repo whose README describes only what exists, with a genuinely green CI badge | [repo](https://github.com/jawwad-ali/tessera) - [docs/measurements.md](./docs/measurements.md) | no |
| 1 | Core runtime | `done` 6/6 | 10–14h | ~6h | *(unchanged — invisible phase, justified: nothing can be drawn or synced before the reducer exists)* | [core/src](./packages/core/src) — 173 tests | no |
| 2 | Property suite, mutation-proved | `done` 4/4 | 8–12h | ~4h | `harness/CAUGHT.md`: three planted bugs **and one real one**, seeds-to-failure, shrink lengths | [harness/CAUGHT.md](./harness/CAUGHT.md) — 197 tests | no |
| 3 | Renderer, read-only — **first deploy** | `blocked` 3/4 | 12–18h | ~4h | **A live URL.** Pan and zoom a seeded 5,000-shape board | — | no |
| 4 | Input and tools | `in-progress` 0/5 | 12–18h | — | The same URL, now drawable: rect, pen, select, move, delete, undo | — | no |
| 5 | YjsStore behind the seam | `not-started` | 10–16h | — | `?store=memory\|yjs` on the live URL; two tabs sync with the server switched off | — | no |
| 6 | Relay | `not-started` | 12–18h | — | *(unchanged — invisible phase, justified: the only run of one, immediately before the gate)* | — | no |
| **7** | **DEMO-COMPLETE** | `not-started` | 8–12h | — | Two browsers syncing on the live URL, both captures, limits stated up front | — | **the gate** |
| 8 | Convergence depth | `not-started` | 10–16h | — | A published convergence result across N replicas under partition | — | **yes** |
| 9 | Persistence | `not-started` | 8–12h | — | Boards survive a restart; the banner saying they do not is removed | — | **yes** |
| 10 | Auth and read-only enforcement | `not-started` | 10–14h | — | A share link that is genuinely read-only, provably | — | **yes** |
| 11 | Optional depth | `not-started` | 12–20h | — | Faster cold open, LOD, bitmap cache — measured against pre-registered baselines | — | **yes** |

**Pre-gate total: 75–113h.** At 10–12h/week that is 7–11 weeks — against a 4–6 week
target. The gap is real and is not resolved by optimism: see **Budget** below.

---

## The DEMO-COMPLETE gate — Phase 7

Everything before this phase is mandatory. **Everything after it is optional and must be
cuttable without editing a single existing README claim.** If cutting a post-gate phase
would make the README wrong, the README is overclaiming today.

No phase numbered below 7 may later be moved above it. Dated: 2026-09-03.

The gate is met when all five hold:

- [ ] A live URL serves a real board that two different browsers can edit together.
- [ ] **Sync capture** — two browsers side by side, with the relay log in frame showing two
      distinct connection ids, so the recording cannot be a cross-tab `BroadcastChannel`
      artefact.
- [ ] **Offline-merge capture** — go offline, draw, come back, ending on both content digests
      printed **equal on screen**.
- [ ] `pnpm capture:verify` — the same two scenarios run headlessly and assert **server-side**
      that both clients exchanged document frames and the final digests match. *The recording
      is illustration; this script is the evidence.*
- [ ] README states the declared limits **up front**, not in a footnote, and
      `docs/COMPARISON.md` is consolidated (Excalidraw's `versionNonce` LWW vs tldraw's
      server-authoritative engine vs Yjs, citing our own measured numbers).

---

## Known defects at `e61aedf` — all four verified by running them

Phase 0 exists primarily to fix these. **All four are fixed.** D-1, D-2 and D-4 in the commit
that added this line; D-3 in the commit that closed the phase.

| ID | Defect | Status | Evidence |
|---|---|---|---|
| **D-1** | The CI convergence step was **red**: `pnpm vitest run --project harness` exited `1` ("No test files found") while `pnpm verify` exited `0`, because `pnpm test` tolerates an empty project and `--project <name>` does not. A single aggregate gate hid a broken itemised step. | **fixed** | `packages/harness/src/yjs-resolution.test.ts` — 2 tests; plus `pnpm verify` added as one CI step so the two gates cannot diverge again |
| **D-2** | **README overclaimed**: it advertised "layered canvases, `Path2D` and bitmap caches, LOD by zoom" and a relay with "persistence". Only the spatial index existed; `apps/relay/src/` is empty. | **fixed** | README rewritten with an explicit pre-alpha Status section separating built from planned; every claim audited against the tree |
| **D-3** | **Evidence was unreachable.** `bench-out/` is gitignored and `arch:graph` wrote into a directory that did not exist, so any published number routed there was unverifiable by a reviewer. | **fixed** | Policy decided once: raw runs stay ignored; the *contract* and the *conclusion* are committed - `bench/*.mjs`, `bench/expectations.json`, `docs/measurements.md`. `arch:graph` now creates the directory. |
| **D-4** | `packages/harness` had no tests and nothing imported it, so `pnpm arch` warned `no-orphans` every run — a permanently-yellow gate that trains everyone to ignore warnings. | **fixed** | `harness/src/index.ts` now re-exports `checkYjsResolution`; `pnpm arch` reports zero violations **and zero warnings** for the first time |

---

## Phase 0 — Foundations made honest

| Field | Value |
|---|---|
| **Status** | `done` — all six exit criteria green |
| Started / Closed | — / — |
| Estimate / Actual / Unplanned | 3–5h / — / — |
| Makes true | Every claim in the repo is either true or removed, every CI step is individually green, and the three non-retrofittable decisions are constants in code rather than sentences in prose. |
| Depends on | — |
| A stranger sees | A public repo whose README describes only what exists, with a genuinely green badge. |
| Gates the URL? | no |
| Irreversible pinned | **D2 `gc: true`** and the **room epoch** become code constants. Neither can be reversed after the first persisted board exists. |
| Assumption killed | "The committed repo is self-consistent." It is not — see D-1 through D-4. |
| Release valve | Salvaging fewer than 8 bench scripts is acceptable; the *gate* that stops uncited claims is not. |
| Write-up delta | `docs/COMPARISON.md` created as an append-only file with its first paragraph. |

**Tasks**
- [x] Fix **D-1**: seed `packages/harness` with a real test, add `pnpm verify` as a single CI
      step so local and CI cannot diverge again, and keep the itemised steps listed separately.
      *Done: the seeded test checks invariant 2 at a third Yjs resolution point, which neither
      the tree walk nor the in-graph guard reaches.*
- [x] Fix **D-2**: rewrite README to describe what is built, with a separate "Planned" section.
      *Done: also added the missing `LICENSE`, and audited every README claim against the tree.*
- [x] Fix **D-3**: evidence-path policy decided once - raw runs stay gitignored, while
      `bench/expectations.json` (the pre-registered contract) and `docs/measurements.md` (the
      published conclusion) are committed. `arch:graph` creates `bench-out/` itself.
- [x] Fix **D-4**: `no-orphans` on `packages/harness` resolved, not silenced.
- [x] Salvage the 8 bench scripts into `bench/` and wire `packages/harness/src/measure.ts`.
      *`bench/` had to become a workspace member: pnpm does not hoist, and yjs is declared only
      where it is used, so the scripts could not resolve it from the root.*
- [x] `packages/crdt/src/doc.ts`: `DOC_OPTIONS` with `gc: true`, and
      `idbStoreName(roomId, epoch)`. Handshake epoch resolution added in
      `packages/protocol/src/handshake.ts`, reusing the existing `CloseCode.EpochStale`.
      *The room epoch is deliberately not in `DOC_OPTIONS`: no test demanded it there, and it
      belongs to the store name and the handshake.*
- [x] Worker-boundary spike, published: **261ms** for a 50,000-shape object scene versus
      **0.3ms** transferable - roughly 870x. The object cost is the same order as the 1,939ms
      decode a worker exists to hide, so **Phase 11 is only viable if the scene crosses as flat
      typed arrays**. That constrains the scene model now rather than at hour 110.

**Exit criteria**

| ID | Criterion | Kind | Verifier | ✓ |
|---|---|---|---|---|
| 0.C1 | Every itemised CI step exits 0, listed separately, **plus** `pnpm verify` as one aggregate step so local and CI cannot diverge | command | green Actions run with per-step output | ☑ |
| 0.C2 | No README claim lacks a file, and no document cites a missing `bench/` script | command | `pnpm claims:check` | ☑ |
| 0.C3 | **Amended 2026-09-03.** As written, this wanted one JSON per claim carrying the full envelope. Built instead: `bench-out/measurements.json` holds measured values, `bench/expectations.json` holds unit/tolerance/justification per claim, and the seven envelope columns live in `docs/measurements.md` where they are actually read. The requirement - no number without its envelope, and drift fails the gate - is met; only the file layout differs. | command | `pnpm bench:check` | ☑ |
| 0.C4 | The gate is demonstrated: a perturbed expectation makes `pnpm bench:check` exit 1, with the failing output quoted in the commit message | artifact | `git log --grep=bench:check` | ☑ |
| 0.C5 | `idbStoreName` embeds the epoch, and a stale epoch resolves to a 4400-range code via the **existing** constant | command | `pnpm vitest run --project crdt --project protocol` | ☑ |
| 0.C6 | The worker-boundary spike number is published with its envelope, and with its counterfactual | number | row in `docs/measurements.md` | ☑ |

**Pre-registered tolerances** (fill before opening the phase): three claims are **structural,
tolerance 0** — `mig1`'s set-beats-delete outcome, `types`' `Ya.Doc !== Yb.Doc`, and `dbg2`'s
three-order iteration divergence. `cold` and `mig3` are **hardware-bound**; state the multiple.
A claim that cannot be reproduced moves to an `inherited` list with the phase that will re-run
it — it does not sit in the tolerance table.

**Excludes:** No implementation of anything the decisions unblock. No new bench workloads
beyond the eight already cited. `pnpm bench` is not a CI gate — it is minutes long and it is
an artifact generator.

**Slip risk:** Arguing with ARCHITECTURE.md about which reproduced number is right can eat an
evening. That argument is the point of doing this first rather than at week eight.

---

## Phase 1 — Core runtime

| Field | Value |
|---|---|
| **Status** | `done` — all six exit criteria green |
| Estimate / Actual / Unplanned | 10–14h / ~6h / 8 |
| Makes true | The untrusted-document boundary, the whole write vocabulary, and the store seam exist as pure total functions — so every hazard the schema claims to absorb can be shown absorbed with no Yjs, no DOM and no network. |
| Depends on | 0 (technical) |
| A stranger sees | *Unchanged.* **Invisible phase — justified:** nothing can be drawn or synced before the reducer exists, and it is one phase, not a run. |
| Gates the URL? | no |
| Irreversible pinned | **Additive-only migration with a read-time resolver.** Cannot be retrofitted: a concurrent `set` beats a `delete`, so a later naive rename silently discards offline work. |
| Assumption killed | "The contracts are implementable as written." |
| Release valve | `invert()` may ship `kind: 'none'` for everything but `create`; only `MemoryStore` uses inverses. |
| Write-up delta | The paragraph on why the patch vocabulary has exactly three absolute ops. |

**Tasks**
- [x] `schema/validate.ts` — the `DocValue` guard: NaN, Infinity, `-0`, undefined-as-a-present-key, a string in a numeric field, a 10MB string, and the `{}` a peer's `Date` arrives as.
- [x] `schema/migrate.ts` — `ResolveShape`: total, never throws, one `Quirk` per `(key, reason)`, `shape: undefined` only when nothing renderable survives.
  - **`legacy-wins-if-present` is deferred, and not by choice of convenience.** `LegacyShapeKey` is `never`: no field has ever been split across keys, so there is no legacy key to prefer and the branch is *type-unrepresentable*, not merely untested. Building it against a synthetic fixture key would be speculative code for a state the type system forbids — and shape.ts says the real job of the frozen key set is to keep that type empty. The `legacy-form` `Quirk` reason therefore has no producer in Phase 1. Phase 1's irreversible pin is satisfied by what does exist: the resolver is read-time, and additivity is enforced by the frozen `ShapeKey` set plus the two drift guards in `SchemaGuarantees`.
- [x] `scene/order.ts` — `idxBetween` with injected `Rng` (`Math.random` is lint-banned in core), and a total `compareDrawOrder` with `id` as tie-break. `abd94be`
- [x] *Unplanned:* `schema/bounds.ts` — `transformBounds` overflows on all-finite input, so `COORD_LIMIT` had to exist before the resolver could range-check against it. `abd94be`
- [x] `commands/apply.ts` — `reduce`, `COMMAND_TOUCHES`, `checkPatch`, plus `missingTarget` and `stampShape` extracted so the two `SceneStore` implementations cannot refuse different commands or mint attribution differently. Also `schema/keys.ts` (`KEY_CLASS`, `HOT_KEYS` derived from it) and `schema/encode.ts` (`-0` normalised on the way out).
  - **`CheckPatch` amended:** it now takes the `CommandKind`. The declared signature `(patch, touches)` cannot use its own second argument — a patch does not carry the kind that produced it, so there is no footprint row to compare against, and an "undeclared key" rule is vacuous regardless because `create` declares every key. With the kind in hand the table is load-bearing and catches footprint drift, which is the only reason it exists.
- [ ] `commands/apply.ts` — `invert` and `selectionBounds`. Not yet demanded by a criterion; `invert` has Phase 1's release valve (`kind: 'none'` for everything but `create`).
- [ ] `MemoryStore` — with `GestureTx` staging, no-op suppression, `DirtyView` revocation, and runtime re-entrancy refusal.
- [ ] `digest().bytes` **throws** in `MemoryStore` until the Yjs probe exists in Phase 5. A same-named field with different semantics across the two stores is exactly the footgun invariant 8 exists to stop.

**Carried forward, 2026-09-03.** Four tasks move to a named later phase rather than being
ticked. Every one is moved because a *test* for it belongs there, not because it was
inconvenient here — writing any of them now would mean production code no failing test
demanded, which is the one thing this project does not do.

| Task | Moves to | Why it cannot be tested here |
|---|---|---|
| `invert` | 4 | Its only consumer is single-player undo, and the assertion that undo does the right thing is the `4.C5` added this phase. Phase 1's release valve already allowed `kind: 'none'` for everything but `create`. |
| `selectionBounds` | 4 | Consumed by group transforms and marquee feedback, neither of which exists. |
| `digest().bytes` **throws** | 5 | The footgun it guards — one field name, two meanings across the two stores — is closed *more* strictly today: `digest()` throws outright, so no caller can read a MemoryStore byte digest at all. The content probe needs a pure-JS hash (`core` has no `node:crypto` and no platform globals), and nothing until `5.C2` compares two digests, so a hash written now is a hash no test could catch being wrong. |
| `drainFaults` | 5 | MemoryStore has no untrusted-input path: every write arrives as a typed `Command`, so there is no `Quirk` for it to produce. Faults become real when `YjsStore` resolves raw document content. |

Also deferred: `MemoryStore`'s `restyle`/`reorder`/`delete` staging branches. `reduce` handles
all five commands and `checkPatch` holds all five to their footprints — what is missing is
only the store's staging for three of them, which Phase 4's tools demand.

**Returned early, 2026-09-03 (calibration).** That last deferral was wrong by one phase, and
the correction is worth recording rather than quietly absorbing: Phase 2's generator needs
`reorder` to produce two inserts into the same gap (the only way to exercise the unjittered-index
mutant) and needs `delete` for the no-orphans invariant. So the test that demanded them arrived
in Phase 2, not Phase 4, and they were built there. The prediction "Phase 4's tools demand them"
named the wrong demander — the *suite* demands a command vocabulary before the *UI* does, which
is the general shape of putting a property suite before a renderer.

**Exit criteria**

| ID | Criterion | Kind | Verifier | ✓ |
|---|---|---|---|---|
| 1.C1 | A table-driven test feeds `resolveShape` **every** hazard in invariant 6 and asserts per row: never throws, reports the named `Quirk.reason`, and `shape` is undefined only for unrenderable input | command | `vitest run --project core -t resolveShape` | ☐☑ |
| 1.C2 | Staging 300 transform frames in one gesture gives `opCount === 1`; three shapes gives 3; **doubling to 600 frames changes neither** — frame-count independence as a test, not a claim | command | `vitest run --project core -t opCount` | ☐☑ |
| 1.C3 | **Amended 2026-09-03.** A drag returning to its origin gives `committed: false`, `opCount: 0`, and leaves the committed shape untouched *by object identity* — plus the `-0` rotation case, which is the one value where `Object.is` and `===` disagree. "No undo entry" was not observable here: `SceneStore` declares no undo member, because the stack belongs to the caller (Phase 4) and to `Y.UndoManager` (Phase 5), and inventing one in `MemoryStore` to satisfy a checkbox is exactly the speculative code this project bans. `committed: false` is the signal a stack is pushed on, so the undo clause moves to the new `4.C5` rather than being dropped. | command | `vitest run --project core -t "round trip"` | ☑ |
| 1.C4 | `checkPatch` returns a violation for a hand-written two-hot-key command and for a removal-shaped op, and `[]` for all five real commands | command | `vitest run --project core -t checkPatch` | ☐☑ |
| 1.C5 | Negative tests pass: retaining a `DirtyView` past its notification throws; a listener calling `gesture` throws | command | `vitest run --project core -t revoked` | ☑ |
| 1.C6 | Coverage thresholds already configured for `core` (90/85/90/90) are met. **At close: 95.05 / 89.72 / 94.49 / 96.58**, exit 0 on five consecutive runs. One earlier run reported exit 1 with every printed number above its threshold and no threshold message; five clean runs since. Recorded rather than explained — if it recurs it is a flaky verifier, which is worse than a red one. | command | `pnpm vitest run --project core --coverage` | ☑ |

**Excludes:** No Yjs mapping. No generative testing — that is Phase 2. No real migration: no v0
board exists, so the legacy branch is proven against a synthetic fixture key.

**Slip risk:** `resolveShape` totality is a long tail — every value shape you think of while
writing it adds a branch and a `Quirk` reason, and the branded `Finite`/`FracIdx` types make
the repair path more verbose than the contract suggests.

**What actually went wrong (appended at close, prediction kept above).** The prediction was
wrong about where the cost was. `resolveShape` was the *cheapest* file in the phase — one
table, one pass, green on the first run — because the hazard list was already written down in
invariant 6. The cost was in three places nobody predicted:

1. **Two contracts could not be implemented as written.** `CheckPatch` took `(patch, touches)`
   and cannot use its second argument, because a patch does not carry the kind that produced
   it. And `1.C3`'s "no undo entry" is not observable at a seam that declares no undo member.
   The phase's stated assumption was "the contracts are implementable as written"; it is
   killed, and both amendments are recorded in place rather than quietly worked around.
2. **Two tests that looked like they had teeth did not.** A mutation making a draft able to
   forge its own `author` passed all 97 tests, because the test asserting the opposite handed
   it a draft with no `author` at all. A mutation notifying once per *write* instead of once
   per *gesture* passed all 105, because every subscriber test wrote exactly one op. Both were
   found by mutation testing and neither by review.
3. **Vacuous branches.** The `put` half of the footprint rule could never fire on real input,
   because `create` declares every key.

The general lesson, and it is the one worth carrying into Phase 2: an example suite tells you
that the code passes its tests. Only mutation testing tells you the tests would notice if it
stopped. Phase 2 exists to make that systematic, and it now has three concrete escapes from
this phase to check itself against.

---

## Phase 2 — Property suite, mutation-proved

| Field | Value |
|---|---|
| **Status** | `done` — all four exit criteria green |
| Estimate / Actual / Unplanned | 8–12h / ~4h / 10 |
| Makes true | The reducer and resolver are tested by generated command sequences rather than by examples, and the suite is **proved to have teeth** by three planted defects it catches. |
| Depends on | 1 (technical) |
| A stranger sees | `harness/CAUGHT.md` — three planted bugs with seeds-to-first-failure and shrink lengths. |
| Gates the URL? | no |
| Assumption killed | "Our example tests cover the reachable state space." They do not. |
| Release valve | Single-replica generative testing only; N-replica convergence is Phase 8. |
| Write-up delta | The methodology paragraph — the strongest differentiator in the project. |

**Placed before the renderer deliberately.** A suite that arrives after 12–18h of render work
means that work was built on an untested resolver, and schema bugs become midnight demo bugs.

**Tasks**
- [x] *Unplanned prerequisite:* `MemoryStore` staging for `restyle`, `reorder` and `delete`.
  Carried forward from Phase 1 to Phase 4 and needed here instead — see Phase 1's
  carried-forward note. Six tests, including the two suppression cases the branches introduce
  (recolour to the same colour writes nothing; draw-then-delete in one gesture nets to nothing)
  and the staged-drop read (a shape deleted mid-gesture cannot then be dragged, or the `??`
  fallthrough resurrects it on commit).
- [x] Seeded, with the seed printed on failure, and a committed regression corpus at `harness/seeds/regressions.json`.
- [x] `harness/CAUGHT.md` with mandatory columns: seed, shrink length, corpus path, invariant fired, fixing sha, `class ∈ {planted, found}`. Gated by `pnpm caught:check`, now a step of `pnpm verify`; the checker's three refusals are unit-tested and were each demonstrated failing.
- [x] `fast-check` generators over the real `Command` vocabulary — not synthetic data.
- [x] Invariants asserted at **every intermediate state**: unique ids, exactly-once draw order, no orphan parents, no `NaN` geometry — plus an encode/resolve round trip.

**Exit criteria**

| ID | Criterion | Kind | Verifier | ✓ |
|---|---|---|---|---|
| 2.C1 | `pnpm test:converge` runs ≥500 seeds in under 30s and exits 0, **and fails if either bound is missed** — the counts and elapsed time are asserted inside the suite and printed, not merely configured. Also fails if more than 30% of generated actions are wasted. **Amended 2026-09-03**, see above: the original verifier already passed and could observe neither bound. | command | `pnpm test:converge` | ☐☑ |
| 2.C2 | **Three planted mutants each have a commit in history where the mutant PASSES because its invariant was deleted**: unjittered fractional index (`bb62535`), draw order from map insertion order (`8e10821`), a reducer writing `t` and `style` in one command (`f204f36`). CI is green on all three; each is reverted by the next commit. | artifact | `git log --grep=mutant` | ☑ |
| 2.C3 | Each planted mutant publishes seeds-to-first-failure, shrink length in commands, and wall-clock. Shrink length is reported in **both** actions and commands, because they are different numbers — one action can be 300 commands — and produced by `pnpm mutant:probe` rather than typed. | number | rows in `harness/CAUGHT.md` | ☑ |
| 2.C4 | A script fails the build if any `CAUGHT.md` row lacks a column, if a `found` row's seed is absent from the corpus, or if a `found` row's fixing commit touches only test files | command | `pnpm caught:check` | ☐☑ |

**Pre-registered thresholds, 2026-09-03 — written before the generator existed and before
anything was measured, per rule 3.** Each is derived from an argument, not from a reading:

| Bound | Value | Why this number |
|---|---|---|
| Seeds per run of `test:converge` | **≥ 500** | From `2.C1`. Enforced *inside* the suite, not just configured — see the `2.C1` amendment below. |
| Wall-clock for the whole converge run | **< 30s** | From `2.C1`. A suite slower than a coffee sip gets skipped locally, and one that gets skipped locally is one that fails in CI only. |
| **Wasted actions** | **≤ 30%** | The stated slip risk made concrete. `wasted` = actions skipped because the scene had nothing to pick + actions refused with a `RejectReason`. 30% because the opening actions of a plan legitimately have an empty scene to pick from, and nothing else should be missing. A deliberate no-op — a drag returning to its origin — counts as *effective*, since suppression is a behaviour under test rather than a wasted action. |
| Shapes per plan | **≤ 40** | Keeps the per-action invariant sweep O(40) so 500 seeds × ~24 actions stays inside the wall-clock budget. Larger scenes are Phase 3's cold-open measurement, not this. |
| Actions per plan | **1–24** | Long enough to interleave draw/drag/restack/erase against a non-trivial scene; short enough that a shrunk counterexample is readable. |

**`2.C1` amended, 2026-09-03 — the verifier could not see the claim.** As written the verifier
was `pnpm test:converge`, which was already `vitest run --project harness` and already exited
0 at the phase's start commit: it could confirm neither "≥500 seeds" nor "under 30s", so a
reviewer running it learned nothing about either. Rule 1 says a criterion that already passes
is rewritten. The suite now *enforces* both bounds itself and prints the seed count, the
action count, the wasted fraction and the elapsed time, so the verifier observes what the
criterion claims.

**Excludes:** N replicas, partitions, duplicate delivery, Yjs of any kind. **Zero `found` rows
is reported as zero** — never as a pass, never as "a finding about the generators".

**Slip risk:** Writing generators that produce *interesting* command sequences rather than
mostly-rejected ones is the real work; a generator that mostly trips `RejectReason` tests
nothing.

**What actually happened (appended at close, prediction kept above).** The phase did what it
was placed here to do, and the headline is that **the suite found a real bug in code that had
already shipped** — `found-1`, in `idxBetween`, on the 1,492nd seed. That code had example
tests, a property test, mutation checks against a broken variant, and a 240,000-insertion
hammer whose "zero fallbacks" I had recorded as evidence the fallback path was free. It was
free only for the workload I chose. The stated assumption — *our example tests cover the
reachable state space* — is killed by measurement, which is the strongest single result in the
project so far.

Four more findings came out of building it, none of them planned:

1. **The generator failed its own pre-registered threshold on its first run**, 51.8% wasted
   against a 30% ceiling. Rule 3 forbids moving the number, so the cause was measured rather
   than guessed: 399 of 500 plans skipped their *first* action, and every skip of a drag,
   restack, erase, recolour or cancel happened on an empty board. Fixed by opening each plan
   with draws and topping up a colliding multi-select — 6.2% after, and writes up from 1,499 to
   17,173.
2. **`idxBetween(k, k)` threw `Error: " >= "`**, and inverted neighbours *silently returned a
   key below the lower bound*. Both reachable, both now refused legibly.
3. **The harness reported a crash where an invariant was the real signal.** An unsorted draw
   order made every restack compute inverted neighbours, so the mutant masked everything after
   the throw. The generator now models a user — who can only ask for a gap the interface offers.
4. **`checkCaught` read the evidence file's second table as malformed rows of the first**, so
   the gate failed on correct evidence. A gate that does that gets switched off.

And the one that matters most for everything already claimed: **D-5**, below.

**Known defect found and fixed at close, 2026-09-03 — D-6.** `pnpm caught:check` passed
locally and failed in CI, reporting `fixing sha 974989f touches no files, or does not exist`
about a commit that plainly did. Cause: `actions/checkout` is depth-1 by default, and a shallow
clone makes every sha unresolvable. Two fixes, because either alone is insufficient:

- CI now fetches full history, which the gate genuinely needs.
- The gate detects a shallow clone and says so, instead of blaming the evidence file for a
  defect in the checkout. A gate that misidentifies its own failure is worse than one that is
  merely strict.

Reproduced with `git clone --depth 1`, which resolves the sha exactly as CI did: not at all.
The lesson generalises past this gate — `caught:check` had been demonstrated failing on
perturbed input *locally*, and that is not the same as demonstrated failing for the right reason
in every environment where it runs.

**Known defect found and fixed mid-phase, 2026-09-03 — D-5.** `camera.test.ts` had a property
test failing **roughly one run in six**, and `pnpm verify` had therefore been passing by luck —
including the CI runs reported green for Phases 0 and 1. Two separate faults:

1. *The assertion was wrong, not the code.* The screen↔world round trip adds the camera offset
   and subtracts it again, so the surviving error is proportional to the **offset**, while
   `closeTo` scaled its tolerance to the **result**. A screen coordinate near zero therefore
   got a `1e-9` tolerance while carrying an error inherited from a value of magnitude 1e6. Found
   by exhaustive search rather than by waiting for the flake again: `cam.x 794315.487,
   zoom 63.654, screen.x 7.0377e-8` returns `6.6693e-8`, 3.7× over tolerance. No float
   implementation can do better, so the tolerance is now derived from the offset that did the
   damage — 16 ulps, worst observed ratio 0.03 over 6M samples biased toward the bad region.
2. *It was unreproducible.* 33 `fc.assert` calls across the repo, **none seeded**. A red run
   left nothing to act on and a green run proved nothing about the one before it, which teaches
   a team to re-run rather than to look. `vitest.setup.ts` now seeds fast-check globally for
   every project, overridable with `TESSERA_SEED` so exploratory runs still find new things.

Verified: 10 consecutive `--project core` runs and 3 consecutive full `pnpm verify` runs, zero
failures — against 2 failures in 12 before the fix.

---

## Phase 3 — Renderer, read-only — first deploy

| Field | Value |
|---|---|
| **Status** | `blocked` 3/4 — blocker named in `3.C3` |
| Estimate / Actual / Unplanned | 12–18h / ~4h / 10 |
| Makes true | **A URL exists.** Pixels appear, the camera and the store provably agree, and the pre-optimisation frame-time baseline is captured *before* any optimisation exists. |
| Depends on | 1 (technical) · 2 (policy — could be reordered, at the cost of building on an untested reducer) |
| A stranger sees | **A live link.** Pan and zoom a seeded 5,000-shape board. |
| Gates the URL? | **this phase IS the URL** |
| Assumption killed | "Canvas 2D holds 5,000 shapes at working zoom on this machine." |
| Release valve | Drop the tile cache. Do **not** drop the deploy. |
| Write-up delta | The LOD-off baseline table, with its envelope. |

**Deploying here is the highest-value insertion in the plan.** At this phase's tip there is a
production-built, pannable board with no server, no persistence and no auth — a static Vercel
target. Every later phase then *upgrades a URL that already exists* instead of promising one.

**Tasks**
- [x] Canvas host mounted `dynamic(ssr: false)`; dpr folded into the camera matrix; `ResizeObserver` with `devicePixelContentBoxSize` (read behind a nullable function boundary — Safari does not ship it, whatever the DOM lib says).
- [x] Static layer; rAF gated on a dirty flag, never unconditional. *Overlay deferred to its first drawer (Phase 4) — see the threshold block above for the memory argument.*
- [x] *Projection and culling first:* `scene/visible.ts` — the ordered, culled draw plan with device-pixel bounds, and `MemoryStore.query` backed by an incremental spatial index. The pure half of `3.C1`, so a misplaced pixel is diagnosed by a number rather than a screenshot.
- [x] Wheel/camera with ctrl+wheel as pinch, zooming about the pointer; drag-to-pan with the board point pinned under the pointer. *`Path2D` cache not built:* the baseline met its requirement without it (p95 11.6ms vs 16.7ms), so a cache now would be an optimisation with no measured need — and the counterfactual must be captured without one. It belongs to Phase 11 alongside LOD.
- [x] Seeded route `/b/demo?seed=&n=` reading a fixture — no store writes. `n` is clamped to 10,000 because it is untrusted input on a public URL.
- [ ] Deploy to Vercel; link in the README with a one-line caption saying it is a read-only renderer demo. **Blocked** — `3.C3`.

**Exit criteria**

| ID | Criterion | Kind | Verifier | ✓ |
|---|---|---|---|---|
| 3.C1 | **A pixel is proven painted in the right place.** A Playwright test on a *production* build asserts by canvas readback that (i) a non-background pixel exists inside a known fixture shape's projected AABB and (ii) after a programmatic 200px drag, non-background pixels appear in the new AABB and **not** the old | command | `pnpm --filter @tessera/web e2e -g projection` | ☐☑ |
| 3.C2 | Measured against `next build && next start`, **never `next dev`** — StrictMode double-invokes effects and yields two rAF loops, invalidating any number | command | the e2e script's own build step | ☐☑ |
| 3.C3 | The live URL returns 200 and renders the seeded board. **BLOCKED 2026-09-05, and the blocker is named:** `create_git_project` on the LinkedUnion Vercel team returned `repo_no_access` — *"You need admin or write access to the repository 'tessera' to link it"*. Vercel's GitHub App is not installed on `jawwad-ali/tessera` for that team. **Unblock:** install the Vercel GitHub App for this repository (or link from the Vercel scope that owns it), then re-run the link with `rootDirectory: apps/web`; every push to `main` deploys from then on. A manual file upload was deliberately *not* used: it would produce a URL today that drifts from git tomorrow, and the point of deploying here is that every later phase upgrades a URL that redeploys itself. | human | open the link *(the one human row in this phase)* | ☐ |
| 3.C4 | **Pre-registered counterfactual, LOD OFF:** p50/p95/p99 frame time and long-frame count at zoom-to-fit, n≥30, with dpr, viewport, hardware, OS, browser and refresh rate stated, and the breaking point as *the n at which p95 crosses 16.7ms*. Committed, with its sha recorded here — this is what Phase 11 is measured against | number | row in `docs/measurements.md` | ☐☑ — [docs/measurements.md](./docs/measurements.md), baseline sha `ed29d17` |

**Pre-registered thresholds, 2026-09-03 — written before `apps/web/src` existed and before
anything was measured.**

| | |
|---|---|
| **Requirement** | **p95 frame time ≤ 16.7ms** at 5,000 shapes, zoom-to-fit, dpr 1 |
| Reference hardware | Intel i5-1135G7 @ 2.40GHz (4 physical / 8 logical), Iris Xe integrated graphics, 15.7GB RAM, Windows 11 Pro 10.0.26200, Node v24.11.0, Chromium via Playwright |
| Sample | n ≥ 30 frames, reported p50/p95/p99 and long-frame count — never a mean, never "fps" |
| Breaking point | the n at which p95 crosses 16.7ms |
| Build | `next build && next start`. Never `next dev` — see `3.C2` |

16.7ms is one vsync at 60Hz, which is what "smooth" means; it is a **requirement**, not a
negotiation. If the measurement misses it, the phase records a miss and Phase 11 is measured
against the gap. Moving the number to match the result is the failure this rule exists to stop.

**A prediction is registered separately, so my model is falsifiable too, not just the code.**
Predicted p95 at 5,000 shapes, zoom-to-fit, LOD off: **~30ms** — roughly 3µs per Canvas 2D
fill-plus-stroke on this hardware, times 10,000 operations. That is a *miss* of the requirement
by about 1.8×, predicted in advance. If the measurement lands far from 30ms in either direction
the model was wrong and the write-up says so; the requirement above does not move either way.

**Culling is in, LOD is out, and the two interact in a way worth stating now.** ARCHITECTURE
§7: *"culling saves nothing at zoom-to-fit, which is the first thing every user does."* So the
spatial-hash cull does nothing for the number above, and everything for panning at working
zoom — which is the interaction the demo actually shows. Both are measured; neither is a
substitute for the other.

**The overlay canvas is deferred to its first drawer.** ARCHITECTURE §7 ratifies two canvases,
and nothing in this phase draws to the second one: the gesture, selection handles and remote
cursors arrive in Phases 4 and 6. The doc's own reasoning is the argument for waiting — "budget
deliberately … two, three at the absolute most", at ~29MB of backing store per full-viewport
canvas at dpr 2. An empty second canvas spends that on zero pixels. Recorded here so re-adding
it is a decision rather than a rediscovery.

**Excludes:** No input, no tools, no hit testing, no LOD, no bitmap cache, no tiling. Read-only.

**Slip risk:** dpr, half-pixel snapping and `touch-action: none` all look fine until they
don't, and the deploy itself is reliably two evenings the first time.

**What actually happened (appended 2026-09-05, prediction kept above).** The slip risk was right
about the deploy and wrong about why: it is not two evenings of configuration, it is one
permission on someone else's account, and no amount of engineering moves it. dpr and
`touch-action` gave no trouble at all.

**The requirement was met and the prediction was wrong.** Registered before any renderer
existed: p95 ≤ 16.7ms required, ~30ms predicted. Measured: **p95 11.6ms at 5,000 shapes**, 0 long
frames in 60; the breaking point is ≈10,000 shapes (p95 16.5ms, at the fixture cap). The model
assumed ~3µs per Canvas 2D fill-plus-stroke; the real figure is ~1.2µs. The requirement did not
move, the model did, and both numbers stay in `docs/measurements.md` so the size of the miss is
on record. The consequence is a scope decision: the `Path2D` cache was *not* built, because an
optimisation with no measured need is exactly what a pre-registered baseline exists to prevent.

Unplanned, in order found: `SpatialHash` made generic over its id type; three culling mutants
survived the first test set, one of which — **a dragged shape kept its old index entry and
vanished** — would have shipped; the drag and the wheel both had their signs backwards, which is
smooth, responsive and wrong without a test; `Painter2D` had to widen to the real context's
style union; Safari's missing `devicePixelContentBoxSize`; App Router files flagged as orphans;
the pixel test raced its own paint counter; `next-env.d.ts` was swept into a commit by a
background build and failed CI; `repo_no_access` from Vercel; and the prediction miss itself.

---

## Phase 4 — Input and tools

| Field | Value |
|---|---|
| **Status** | `in-progress` 0/5 |
| Estimate / Actual / Unplanned | 12–18h / — / — |
| Makes true | The live URL is a usable single-player whiteboard, and every write goes through one gesture committed on pointerup. |
| Depends on | 3 (technical) |
| A stranger sees | The same URL, now drawable: rect, pen, select, move, delete, undo. |
| Gates the URL? | no (upgrades it) |
| Irreversible pinned | **Commit-on-pointerup and the one-hot-key rule**, from the very first write. Retrofitting means every early board carries 60× the structs. |
| Assumption killed | "The gesture staging contract survives contact with real pointer events." |
| Release valve | **Drop the pen tool.** Decided now, in writing, rather than at midnight. |
| Write-up delta | The updates-and-bytes-per-gesture number, before and after. |

**Tasks**
- [ ] Pointer Events from the start, `getCoalescedEvents`, `touch-action: none`, viewport meta.
- [ ] Three-tier hit test: spatial-hash query → AABB reject → `isPointInPath`/`isPointInStroke` on a 1×1 scratch context.
- [ ] Rect + pen tools; single select, marquee, move, `Delete`, `Ctrl+Z`/`Ctrl+Shift+Z`, `Escape`.
- [ ] Selection handles drawn in **screen space**, and **inert** — resize and rotate stay cut.
- [ ] Landing page: "New board", copy-link, recent boards from `localStorage`. No accounts.
- [ ] Declared limit shipped in the UI: **"boards are ephemeral until persistence lands."**

**Exit criteria**

| ID | Criterion | Kind | Verifier | ✓ |
|---|---|---|---|---|
| 4.C1 | An e2e test draws a rect, drags it 200px, and asserts one gesture committed with `opCount === 1` — **and** that the painted pixels moved (3.C1's readback, reused) | command | `pnpm --filter @tessera/web e2e -g gesture` | ☐ |
| 4.C2 | A test asserts a 3-second drag emits **one** transaction, not one per frame, at any frame rate | command | `vitest run --project web -t "one transaction"` | ☐ |
| 4.C3 | Updates and bytes **per gesture** published, naive vs commit-on-pointerup, with the envelope | number | row in `docs/measurements.md` | ☐ |
| 4.C4 | The live URL is drawable, and the ephemerality banner is visible | human | open the link | ☐ |
| 4.C5 | A cancelled drag leaves the undo stack alone: after a round-trip drag, Ctrl+Z undoes the gesture *before* it. **Added 2026-09-03** — carries the clause moved off `1.C3`. Phase 4 promised undo in "a stranger sees" while no criterion asserted it, so this closes a real hole in the tracker rather than merely relocating a sentence. | command | `vitest run --project web -t "cancelled drag"` | ☐ |

**Pre-registered thresholds, 2026-09-05 — written before `apps/web/src/board/input` exists.**

| Bound | Value | Why this number |
|---|---|---|
| `4.C3` updates per gesture, commit-on-pointerup | **exactly 1** for a 60-frame drag of one shape; **exactly 3** for three shapes | Structural, tolerance 0: one gesture is one transaction. A second update means a frame leaked past the pointerup boundary. |
| `4.C3` updates per gesture, naive | **60** for a 60-frame drag | One per frame, by definition of naive. Measured to make the counterfactual concrete, not to be met. |
| `4.C3` bytes per gesture, ratio naive : pointerup | **≥ 10×** required | The V2 encoding is size-efficient, so bytes shrink far less than update count — ARCHITECTURE §5 measured V2 within 6% across key layouts. 10× is the floor below which commit-on-pointerup would not be worth its UX cost. |
| `4.C2` drag duration and rate | **3,000ms at 60Hz = 180 samples**, and again at 120Hz = 360 samples, same single transaction | "At any frame rate" is asserted at two rates, not assumed. |
| Hit-test slop | **10 CSS px**, converted to board units by `/ zoom` | ARCHITECTURE §7: screen-space slop. A fixed board-unit slop is un-clickable when zoomed out and grabs the neighbour when zoomed in. |

**Prediction, registered separately: bytes ratio ~40×** for a 60-frame single-shape drag. The
naive path writes a whole `t` value per frame, each a struct with its own id and clock; the
pointerup path writes one. If the measurement lands far from 40× the model was wrong and the
write-up says so; the 10× requirement does not move.

**The gesture is tier-1 state, outside the store, until pointerup.** Decided here so Phase 5 does
not rediscover it: ARCHITECTURE §2 puts "the in-flight drag offset" in tier 1, the overlay canvas
draws it, and `store.gesture()` is called **once**, on pointerup, with the final geometry. `4.C2`
is therefore true by construction, and the store's staging collapse — proven in Phase 1 — is the
second line of defence rather than the first. The overlay canvas, deferred from Phase 3 to "its
first drawer", arrives now: the drag ghost, the marquee and the selection handles are that
drawer.

**Pen tool last, and only if the rest closes.** The release valve above is exercised in advance:
rect, select, move, delete, undo are built and verified first; pen follows only with every
criterion already green.

**Excludes:** Resize, rotate, ellipses, sticky notes (**D1: cut**), images, eraser, copy/paste
beyond duplicate, export.

**Slip risk:** The interaction layer — pointer → camera → hit test → drag state machine →
transaction boundary — is the single most underestimated subsystem in the whole project.
Budget generously; it is where the multi-evening bugs live.

---

## Phase 5 — YjsStore behind the seam

| Field | Value |
|---|---|
| **Status** | `not-started` |
| Estimate / Actual / Unplanned | 10–16h / — / — |
| Makes true | The CRDT is swapped in behind the unchanged `SceneStore` interface, and the seam is proved by a `git diff` rather than asserted. |
| Depends on | 1 (technical) · 4 (policy only — the store does not need the tools) |
| A stranger sees | `?store=memory\|yjs` on the live URL; two tabs sync with the server switched off. |
| Gates the URL? | no |
| Irreversible pinned | The epoch reaches the IndexedDB store name; `gc: true` reaches the live `Y.Doc`. |
| Assumption killed | "The `SceneStore` contract is genuinely implementation-neutral." |
| Release valve | Ship without `y-indexeddb`; offline is Phase 7's concern. |
| Write-up delta | The paragraph on `Origin` classes and why `trackedOrigins` matches constructors. |

**Tasks**
- [ ] `mapping.ts`, `tx.ts` (the **only** place a `Y` type is written), `undo.ts`, `ingest.ts` (rAF-coalesced `applyUpdate`).
- [ ] `Origin` as **classes**, not object literals — `UndoManager` matches `trackedOrigins` on the constructor — with `trackedOrigins` **derived** from `UndoScopeTable` and the `history` sentinel included, or an undo is reported to the renderer as a remote change.
- [ ] `captureTimeout: 0` plus explicit `stopCapturing()` on pointerup.
- [ ] Both digest probes: normalised bytes (re-encoded through a fresh `Y.Doc`) **and** content.
- [ ] `?store=` switch, and an honestly-captioned **cross-tab** capture — labelled cross-tab, **not** multiplayer.

**Exit criteria**

| ID | Criterion | Kind | Verifier | ✓ |
|---|---|---|---|---|
| 5.C1 | **The seam is a zero-line diff.** The property suite runs unchanged against `YjsStore`; the store factory argument is the only edit | command | `git diff --stat -- packages/harness/src/converge.ts` shows 1 changed line | ☐ |
| 5.C2 | Both stores produce identical scenes for the same command sequence (differential) | command | `pnpm test:converge -- --store both` | ☐ |
| 5.C3 | A 300-frame drag against `YjsStore` adds **2** structs on one shape; the multi-shape case asserts the **fact** that per-frame merging is impossible at any key layout, not a workload-specific constant | command | `vitest run --project crdt -t structs` | ☐ |
| 5.C4 | A solo client survives 60s with no peers — the awareness self-echo is **kept** in the fan-out. Suppressing it puts a lone user in a permanent 30s close/reconnect loop | command | `vitest run --project crdt -t "solo survives"` | ☐ |

**Excludes:** No relay, no network, no persistence. `disableBc: true` in every test.

**Slip risk:** Undo scoping has four separate footguns (`trackedOrigins` default of
`Set([null])`, the `history` sentinel, `captureTimeout`, `ignoreRemoteMapChanges`) and getting
three right is indistinguishable from getting four right until a collaborator's work vanishes.

---

## Phase 6 — Relay

| Field | Value |
|---|---|
| **Status** | `not-started` |
| Estimate / Actual / Unplanned | 12–18h / — / — |
| Makes true | Two *different browsers* on two machines share a board, through a relay whose resource control exists before its features do. |
| Depends on | 5 (technical) |
| A stranger sees | *Unchanged.* **Invisible phase — justified:** the only run of one, and it sits immediately before the gate by design, not by accident. |
| Gates the URL? | no (the URL already exists — this is why Phase 3 deployed) |
| Assumption killed | "The gate composes with the real reader, on real sockets." |
| Release valve | Single instance only. No Redis, no affinity, no cross-instance awareness. |
| Write-up delta | Fan-out arithmetic and the coalescing before/after. |

**Tasks**
- [ ] `server.ts` — upgrade handler with **Origin allowlist** (WebSocket is exempt from CORS) and an explicit `maxPayload`.
- [ ] `gate.ts` — replaces the message listener rather than wrapping it, using the finished `@tessera/protocol` `peek`/`adjudicate`. A check placed after `readSyncMessage` is not a check.
- [ ] `room.ts` — `Y.Doc` per room, epoch, eviction; assert `pendingStructs === null` **unconditionally on the server** after every apply (distinct from the quiesced-replica rule in the suite — keep both labelled).
- [ ] `fanout.ts` — backpressure on `ws.bufferedAmount` (drop awareness above ~256KB, `terminate()` above ~4MB), and a 20–30Hz awareness coalescing tick **that keeps the originator**.
- [ ] Awareness identity **overwritten** via `modifyAwarenessUpdate`, not validated.
- [ ] `metrics.ts` — event-loop lag, GC pauses, `bufferedAmount` high-water, sends/s.

**Exit criteria**

| ID | Criterion | Kind | Verifier | ✓ |
|---|---|---|---|---|
| 6.C1 | **A generated decision matrix**, not a hand-written one: for every `(role × outer × inner)` triple, the verdict and close code, produced from the tests | command | `vitest run --project relay -t matrix` | ☐ |
| 6.C2 | The orphan-update DoS is bounded: crafted updates referencing fabricated `(client, clock)` pairs are rejected before `pendingStructs` grows, and a `maxPayload` cap alone is shown **not** to stop it | command | `vitest run --project relay -t orphan` | ☐ |
| 6.C3 | A slow consumer is shed without taking the room down; the `bufferedAmount` high-water mark is published | number | row in `docs/measurements.md` | ☐ |
| 6.C4 | Sends/s before and after awareness coalescing, with the arithmetic shown | number | row in `docs/measurements.md` | ☐ |

**Excludes:** No auth (Phase 10 — auth belongs after a public link exists), no persistence
(Phase 9), no Redis, no 50-client load test (**cut**).

**Slip risk:** "Syncs sometimes" is the failure mode, and it is the hardest kind to bound in
an evening. Rooms with an unguessable id are the recorded stopgap until Phase 10.

---

## Phase 7 — DEMO-COMPLETE ← the gate

| Field | Value |
|---|---|
| **Status** | `not-started` |
| Estimate / Actual / Unplanned | 8–12h / — / — |
| Makes true | The project is presentable to a stranger with no explanation and no apology. |
| Depends on | 6 (technical) |
| A stranger sees | Two browsers syncing on the live URL, both captures in the README, limits stated up front. |
| Gates the URL? | no (upgrades it to multiplayer) |
| Assumption killed | "The two captures are easy once the parts work." They take two to four evenings. |
| Release valve | Ship the offline capture with `y-indexeddb` only, no sync indicator polish. |
| Write-up delta | `docs/COMPARISON.md` consolidated — **a gate item, not a tail item.** |

**Tasks**
- [ ] Provider wiring on the live URL; cursor interpolation with a render delay and bounded extrapolation.
- [ ] `y-indexeddb` + a sync indicator distinguishing *disconnected* from *connected-but-stalled* (`pendingStructs !== null`).
- [ ] **Viewers get no IndexedDB provider** — at the phase the provider first ships, not later.
- [ ] Record both captures across **two different browsers**, never two tabs.
- [ ] `pnpm capture:verify` — headless, server-side assertion.
- [ ] README rewritten: limits up front, both captures, the differentiators checkable in a minute.

**Exit criteria**

| ID | Criterion | Kind | Verifier | ✓ |
|---|---|---|---|---|
| 7.C1 | `pnpm capture:verify` asserts **server-side** that two clients exchanged document frames and that final content digests are equal, for both scenarios | command | `pnpm capture:verify` | ☐ |
| 7.C2 | Both captures committed, the sync one showing two distinct connection ids in the relay log, the offline one ending on equal digests on screen | artifact | `git ls-files docs/captures` | ☐ |
| 7.C3 | A test asserts `disableBc: true` in every test provider, so no capture or test can be a cross-tab artefact | command | `pnpm claims:check` | ☐ |
| 7.C4 | `docs/COMPARISON.md` cites at least one of **our own** measured numbers per axis, with no number cited twice for different axes | command | `pnpm claims:check` | ☐ |
| 7.C5 | All five gate checkboxes above are ticked | artifact | this file | ☐ |

**Excludes:** Auth, persistence, cold-open work, LOD. All post-gate and all cuttable.

**Slip risk:** Recording a clean capture is fiddly and always takes longer than the feature
did. The pre-decided valve exists for exactly this evening.

---

## Post-gate phases — all optional, all cuttable

Cutting any of these must not make a single existing README claim wrong. If it would, the
README is overclaiming today.

### Phase 8 — Convergence depth
`not-started` · 10–16h · depends on 5 · **optional**

N replicas under randomised delivery, duplicate delivery, and partition-then-heal. Carries the
**three negative digest tests**, each computing the *wrong* probe beside the right one in the
same test body: shared clientID (identical state vectors, different content → must **fail**);
`gc:true` GC-marker vs deleted Item (raw bytes differ, normalised equal → must **pass**); a
`Date` in the document (bytes equal, content differs → must **fail**). This is what turns
invariant 8 from a design note into executable evidence.

Exit: `pnpm test:converge -- --replicas 5 --partition` green over ≥500 seeds; the three
negative tests each with a commit where the wrong probe passes; the oracle's expected-divergence
allowance list is a **committed file** — an oracle whose allowances live in comments is a
disabled oracle.

### Phase 9 — Persistence
`not-started` · 8–12h · depends on 6 · **optional** · release valve: **append-only, no squash**

`doc_updates` append-only + `doc_head`; `pg >= 8.23.0` pinned (older 8.x silently
`JSON.stringify`s a `Uint8Array` into `bytea`); V2 at rest; `SET STORAGE EXTERNAL`; SIGTERM
flush. Removes the ephemerality banner. Exit: a `bytea` byte-identity round trip; a CI
assertion on the resolved `pg` version; a concurrent-squash version-guard race test; and
"kill the server mid-drawing, nothing is lost" verified headlessly.

### Phase 10 — Auth and read-only enforcement
`not-started` · 10–14h · depends on 6, 9 · **optional**

Single-use Redis ticket in a query param (a browser `WebSocket` cannot send an
`Authorization` header); room resolved **from the ticket**, never from the client-supplied
path; `exp` timer; revocation channel; the coarse read-only gate wired end to end with a
client-side reset on 4403. Exit: a hostile 20-line `ws` client, no Yjs provider, sends a raw
crafted update from a viewer session and is dropped and closed in the 4400 range — captured,
because that capture proves byte-level understanding of the protocol.

### Phase 11 — Optional depth
`not-started` · 12–20h · depends on 3, 9 · **optional** · **cut this first**

Worker decode, progressive hydration, LOD, bitmap cache — each measured against the
counterfactual baseline **committed in Phase 3**, whose sha is recorded there. Its measured
problem bites above 20,000 shapes and no demo board reaches that, so this is the first thing
to drop. Do not start it without the Phase 0 worker-boundary spike number in hand.

---

## Decision log

| ID | Decision | Answer | Pinned in code | Cost of reversing |
|---|---|---|---|---|
| **D1** | Sticky-note text | **Cut from slice 1.** A note you cannot type into is a visible bug; a plain string makes note text a same-key race, so one typist loses the whole paragraph — the exact failure the project promises to solve | `ShapeKind = 'rect' \| 'pen'` at `e61aedf` | Low. Adding `Y.Text` later is a schema *value* change plus a DOM overlay subsystem (~1 week) |
| **D2** | Garbage collection | **`gc: true`**, no version history. Deleted content is reclaimed at every transaction (223KB → 124KB on deleting half of 2,000 shapes) | Phase 0 · `DOC_OPTIONS` | **Irreversible after the first persisted board.** History cannot be retroactively enabled: `Y.snapshot` on a `gc:true` doc returns a snapshot whose content is already gone |
| **D3** | Scope | **Re-scoped, renderer-first**, both captures at the gate | This file | — |

---

## Cut list — restated in full, so re-adding one is a visible decision

50-client load test · JWT accounts and room roles beyond the coarse read-only gate · ellipses ·
sticky notes (D1) · Playwright beyond one smoke test plus the projection and capture assertions ·
version history (D2) · resize handles · rotate · images · eraser · copy/paste beyond duplicate ·
SVG export · follow-a-user · comments · board dashboard with accounts · dirty-rectangle
invalidation · a colour-coded hit-test canvas · Redis, room affinity and cross-instance
awareness · tiling.

Re-adding any item requires a dated line here naming who decided and which entry it contradicts.

---

## Constraint guard map

Each row is a measured constraint from ARCHITECTURE.md and **the last phase at which it can
still be satisfied cheaply.** A guard that slips past its phase is a rewrite, not a fix.

| Constraint | Last cheap chance | Enforced by |
|---|---|---|
| Renderer before select-and-move | Phase 3 | Phase ordering; violating it means building the renderer twice |
| Commit-on-pointerup + one-hot-key from the **first** write | Phase 4 | `1.C2`, `4.C2`, `5.C3` |
| Epoch present | Phase 0 | `0.C5` |
| Additive-only migration + read-time resolver | Phase 1 | `1.C1` |
| Property suite before the renderer | Phase 2 | Phase ordering |
| Two-probe digest, normalised bytes + content — never state vectors | Phase 5 | `5.C2`, Phase 8's negative trio |
| `pendingStructs` on a **quiesced** replica only in the suite; **unconditionally** on the relay | Phase 6 | Two separately labelled assertions |
| Awareness self-echo **kept** in the fan-out | Phase 6 | `5.C4` |
| Auth **after** a public link exists | Phase 10 | Phase ordering |
| Nothing from the cut list smuggled back | every phase | Each phase's `Excludes` |

---

## Measurement envelope

Every published number carries all seven, or the build fails:

`harness path` · `hardware / OS / runtime` · `workload definition` · `n (sample count)` ·
`distribution (p50/p95/p99 — never a mean, never "fps")` · `counterfactual` · `breaking point`.

Two further rules: **no blended numbers** across heterogeneous inputs — rect-heavy and
ink-heavy are reported separately, because one blended figure is marketing. And every
counterfactual records the **sha and path of the baseline captured before the optimisation
existed**; a baseline taken afterwards is re-baselineable and therefore worthless.

---

## Budget

Pre-gate is **75–113h**. At 10–12h/week that is 7–11 weeks against a 4–6 week target. Every
plan reviewed was 2–3× over, so the cuts are applied **now** rather than at midnight:

- Phase 11 is optional and is cut first.
- Phase 9 reduces to append-only with no squash.
- The pen tool is Phase 4's named release valve.
- Cold-open work does not start without the Phase 0 spike number.

**Standing number, updated every phase close: hours until a two-machine capture exists.**
Currently the full pre-gate budget, because none of it is built.

---

## Abandon drill

Written in advance, because a stall is the *likely* outcome, not an edge case. Portfolio value
is step-shaped in "finished" — the drill fails for any row whose paragraph needs an apology
for something invisible.

| Stop after | What ships, honestly |
|---|---|
| 0 | A repo with an enforced architecture, a green CI, and reproducible measurements of Yjs behaviour. Small, true, no product. |
| 2 | The above plus a mutation-proved property suite with published seeds-to-failure — the rarest artefact in the category, and citable on its own. |
| **3** | **A live link a stranger can pan around**, plus a committed frame-time baseline with a stated breaking point. First point the project is presentable. |
| 4 | A usable single-player whiteboard on a live URL, with hand-written renderer and no canvas library. Defensible as-is. |
| 5 | The above, plus two tabs syncing through a CRDT with the server switched off, honestly captioned as cross-tab. |
| **7** | **The gate.** Multiplayer, both captures, headless evidence, comparative write-up. Everything after is a bonus. |

---

## Calibration ledger

Fill on every phase close. `Unplanned` is the count of tasks discovered mid-phase; it is the
real estimate error and the only input that makes the next estimate honest.

| Phase | Est | Actual | Unplanned | Cumulative actual | Note |
|---|---|---|---|---|---|
| 0 | 3–5h | ~5h | 3 | ~5h | Unplanned: `bench/` had to become a workspace member; `func-style` is not auto-fixable so 42 declarations needed a transformer; the crdt purity boundary rejected `Buffer` in a test. |
| 1 | 10–14h | ~6h | 8 | ~11h | Wall-clock from the Phase 0 close commit to the Phase 1 close commit (14:24→20:35), not a timer — it includes the analysis detours. Unplanned: `transformBounds` overflow forced `COORD_LIMIT` into existence; `CheckPatch`'s signature could not use its own argument; `1.C3`'s undo clause was unobservable and needed `4.C5`; two mutation escapes (forged attribution, notify-per-write); one vacuous branch (the `put` footprint rule); `legacy-wins` turned out type-unrepresentable; `SCHEMA_VERSION` was declared twice. |
| 2 | 8–12h | ~4h | 10 | ~15h | Wall-clock by commit timestamp. Unplanned: the restyle/reorder/delete staging carried forward from Phase 1 was needed here; the generator missed its own wasted-action ceiling; `found-1`; D-5's flaky camera test and the 33 unseeded `fc.assert` calls behind it; `idxBetween(k,k)` and inverted bounds; the harness reporting a crash instead of an invariant; `patch-shape` did not exist yet; `core/src/index.ts` exported nothing from Phase 1; `checkCaught` mis-parsed a two-table file; the mutation script's deletion edits were not reversible. |
| 3 | 12–18h | ~4h so far | 10 | ~19h | Two sessions (09-03 evening, 09-05). Three of four criteria green with verifiers run; `3.C3` needs a Vercel GitHub App permission only the repository owner can grant. See the phase's what-actually-happened block for the ten unplanned items. |
| 4 | 12–18h | — | — | — | — |
| 5 | 10–16h | — | — | — | — |
| 6 | 12–18h | — | — | — | — |
| 7 | 8–12h | — | — | — | — |

---

*Created 2026-09-03 against `e61aedf`. Phase numbers are stable and are never renumbered; a
mid-flight split becomes `2a`/`2b` so history stays readable.*
