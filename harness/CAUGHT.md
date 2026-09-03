# CAUGHT

What the convergence suite has actually caught, and what each catch cost it.

Every row is checked by `pnpm caught:check`, a step of `pnpm verify`. A row missing a column
fails the build; a `found` row whose seed is not in [`seeds/regressions.json`](./seeds/regressions.json)
fails the build; and a `found` row whose fixing commit touches only test files fails the build,
because that is the signature of a bug "fixed" by weakening the test that found it. The
checker's own refusals are unit-tested in `packages/harness/src/caught.test.ts` — a gate whose
failure path has never run is not a gate.

**`class` means what it says.** `planted` is a defect introduced on purpose, to prove the suite
would notice. `found` is a defect the suite noticed that nobody had introduced. The two are not
interchangeable, and only the second is evidence about the *code*. Zero `found` rows would be
reported here as zero — never as a pass, and never as "a finding about the generators".

| id | class | invariant fired | seeds to failure | shrinks | shrink length | wall-clock | base seed | corpus key | fixing sha |
|---|---|---|---|---|---|---|---|---|---|
| found-1 | found | `distinct-index` | 1492 | 48 | 5 actions / 5 commands | 473ms | 20260903 | `found-1` | `974989f` |
| planted-m1 | planted | `distinct-index` | 1 | 26 | 4 actions / 4 commands | 121ms | 20260903 | n/a | `2f2e51e` |
| planted-m2 | planted | `total-order` | 1 | 26 | 4 actions / 4 commands | 108ms | 20260903 | n/a | `10f7a43` |
| planted-m3 | planted | `patch-shape` | 1 | 19 | 3 actions / 3 commands | 74ms | 20260903 | n/a | `ec169a1` |

**Shrink length is given twice, and the two numbers are different things.** An *action* is
what the generator shrinks and what a person reads; a *command* is what the action emits, and
one action can be 300 of them, since a drag emits a transform per frame. They coincide in every
row below only because shrinking reduced each surviving drag to a single frame. Reported by
`pnpm mutant:probe` rather than typed by hand, and pinned by a test for `found-1`.

Each `planted` row has a commit in history where the defect **passes the whole suite**, because
the invariant written to catch it was deleted. `git log --grep=mutant` lists them; the reverting
commit is the `fixing sha` above, and its diff is the reproduction.

*Precisely:* `pnpm verify` — the single aggregate gate CI runs as one step — was run and was
green at each of the three, locally. GitHub Actions triggers on the pushed ref, so it ran on the
tip of the push rather than on each intermediate commit; claiming "CI is green on all three"
would be claiming a run that does not exist. Anyone can produce it with
`git checkout <sha> && pnpm verify`.

| mutant | it passes here | reverted here |
|---|---|---|
| m1 | `bb62535` | `2f2e51e` |
| m2 | `8e10821` | `10f7a43` |
| m3 | `f204f36` | `ec169a1` |

---

## found-1 — jitter switched itself off in the one case it exists for

**What the suite reported.** On the 1,492nd seed, two shapes both carried the index `a011E`.
Shrunk 48 times down to five actions, short enough to read as a sentence: draw, draw, send one
to the back, send two to the back *together*, then drag them.

```
draw, draw, restack(gap 0), restackTogether(gap 0), dragMany
```

**The mechanism, confirmed in isolation rather than reasoned about.** Repeated inserts into the
same shrinking gap:

```
round 0: Zz12OY   / ZzG36c     jitter fits, keys distinct
round 1: Zz11RBoX / Zz11Z8wX   still fits
round 2: Zz11E    / Zz11E      <-- IDENTICAL
```

`idxBetween` generated a jittered candidate, compared it against the upper bound, narrowed the
lower bound and retried three times — and if every attempt escaped, returned the **unjittered**
key. `generateKeyBetween` is deterministic, so two clients resolving "send to back" against the
same snapshot received the same index. A same-key race then decides which of them keeps it, and
the loser's shape sits at a position nobody chose.

**Why nothing else caught it.** The implementation shipped at `abd94be` with example tests, a
property test over insertion sequences, mutation checks against a deliberately broken variant,
and a hammer over 240,000 insertions that reported **zero fallbacks** — which was recorded as
evidence the fallback was free. It was free because those insertions were between *wide*
neighbours. The fallback is only reachable when the interval is too tight to fit four jitter
characters, and nothing in the example suite generated that. The comment on the function even
said "correctness is unconditional; jitter is best-effort" — true, and the best-effort half
failed silently in the only case the feature exists for.

This is Phase 2's stated assumption, killed by measurement rather than by argument: *our example
tests cover the reachable state space.* They did not.

**The fix.** The retry and the fallback are gone. The jitter suffix is **constructed** to fit:
walk the upper bound's tail digit by digit, match while there is no digit below, take a
strictly-lower digit at the first position with room, then choose the rest freely because the
comparison is already decided. It always terminates, because `fractional-indexing` rejects a key
whose fractional part ends in the lowest digit, so the tail can never be all-lowest-digits.

**Reproduce.** `pnpm vitest run --project harness -t found-1` replays the shrunk plan and the
mechanism directly, over 32 shrinking rounds rather than the 8 that first showed it — the
failure appeared at round 2, so a loop stopping at 8 would pass again on any implementation that
merely defers the collision.

**500 seeds would have missed it.** `2.C1` requires at least 500, the first run of this suite
used exactly that, and it was green. The seed count is 2,000 for this reason, and that is the
whole argument against pinning a property suite to its stated minimum.

---

## planted-m1 — an unjittered fractional index

Caught on the **first seed**. Also caught by one example test and by the found-1 corpus, and
saying so is the honest version of this row: the invariant is not the only line of defence
here. What it adds is *reach* — it caught found-1, which the example test did not, because that
test uses wide neighbours and the failure needed a tight gap. The invariant covers the family;
the example covers the case someone thought of.

---

## planted-m2 — draw order from map iteration

Caught on the **first seed**. This is the failure that makes a CRDT app look broken while every
convergence check passes: measured earlier in this project, three replicas given the same
updates in different delivery orders are byte-identical and iterate a `Y.Map` as `["a","b","c"]`,
`["c","b","a"]` and `["b","a","c"]`. The document converges; the picture does not. No byte digest
and no state vector notices, because nothing about the *document* is wrong.

**It also taught the harness something.** The first attempt at this mutant needed a second skip,
because an unsorted order made every restack compute inverted neighbours and `idxBetween` threw.
Reported as a crash, the mutant masked every action after it. The generator now models a user
properly — a user can only ask for a gap the interface offers, and an inverted adjacent pair
offers none — so the defect surfaces as exactly the invariant written for it. That fix is
`afb03b2`, and it also turned up two production refusals (`9e83689`): `idxBetween(k, k)` threw
`Error: " >= "`, and inverted neighbours silently returned a key *below* the lower bound.

---

## planted-m3 — a reducer writing `t` and `style` in one command

Caught on the **first seed**, and it is the row that justifies having a patch-level invariant at
all.

This defect produces a perfectly coherent scene. Every id unique, every index distinct, draw
order sorted, every shape surviving its round trip — a scene invariant cannot see it. What it
costs is +120 structs per gesture instead of +2, because a repeated write merges only if it is
the only thing that client wrote that frame. Measured earlier in this project: one transaction
per gesture over 1,000 three-shape group drags gives 3,000 structs and a 46 ms cold load; losing
the merge gives 180,000 structs and 408 ms.

So the symptom is a board that takes eight times longer to open, arriving weeks after the change
that caused it, with no failing test and no wrong pixel anywhere. `checkCommand` exists beside
`checkScene` for exactly this: a suite that only inspects state cannot see a defect whose only
symptom is the shape of the write.
