# CAUGHT

What the convergence suite has actually caught, and what each catch cost it.

Every row is checked by `pnpm caught:check`, which is a step of `pnpm verify`. A row missing a
column fails the build; a `found` row whose seed is not in [`seeds/regressions.json`](./seeds/regressions.json)
fails the build; and a `found` row whose fixing commit touches only test files fails the build,
because that is the signature of a bug "fixed" by weakening the test that found it. The
checker's own refusals are unit-tested in `packages/harness/src/caught.test.ts` — a gate whose
failure path has never run is not a gate.

**`class` means what it says.** `planted` is a defect introduced on purpose to prove the suite
would notice; `found` is a defect the suite noticed that nobody had introduced. The two are not
interchangeable and the second is the only one that is evidence about the *code*. Zero `found`
rows would be reported here as zero — never as a pass, and never as "a finding about the
generators".

| id | class | invariant fired | seeds to failure | shrinks | shrink length | wall-clock | base seed | corpus key | fixing sha |
|---|---|---|---|---|---|---|---|---|---|
| found-1 | found | `distinct-index` | 1492 | 48 | 5 actions | 473ms | 20260903 | `found-1` | `974989f` |

---

## found-1 — jitter switched itself off in the one case it exists for

**What the suite reported.** On the 1,492nd seed, two shapes both carried the index `a011E`.
Shrunk 48 times down to five actions, which is short enough to read as a sentence: draw, draw,
send one to the back, send two to the back *together*, then drag them.

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
lower bound and retried three times — and if every attempt escaped the bound, returned the
**unjittered** key. `generateKeyBetween` is deterministic, so two clients resolving "send to
back" against the same snapshot received the same index. A same-key race then decides which of
them keeps it, and the loser's shape sits at a position nobody chose.

**Why nothing else caught it.** The implementation shipped at `abd94be` with example tests, a
property test over insertion sequences, mutation checks against a deliberately broken variant,
and a hammer over 240,000 insertions that reported **zero fallbacks** — which I recorded as
evidence the fallback was free. It was free because those insertions were between *wide*
neighbours. The fallback path is only reachable when the interval is too tight to fit four
jitter characters, and nothing in the example suite generated that. The comment on the function
even said "correctness is unconditional; jitter is best-effort" — true, and the best-effort part
failed silently in the only case the feature exists for.

This is Phase 2's stated assumption, killed by measurement rather than argument: *our example
tests cover the reachable state space.* They did not.

**The fix.** The retry and the fallback are gone. The jitter suffix is now **constructed** to
fit: walk the upper bound's tail digit by digit, match while there is no digit below, take a
strictly-lower digit at the first position with room, then choose the rest freely because the
comparison is already decided. It always terminates, because `fractional-indexing` rejects a key
whose fractional part ends in the lowest digit, so the tail can never be all-lowest-digits.
Jitter is unconditional now and the ordering guarantee is unchanged.

**Reproduce.** `pnpm vitest run --project harness -t found-1` replays the shrunk plan and the
mechanism directly, over 32 shrinking rounds rather than the 8 that first showed it — the
failure appeared at round 2, so a loop stopping at 8 would pass again on any implementation
that merely defers the collision.

**500 seeds would have missed it.** `2.C1` requires at least 500 and the first run of this suite
used exactly that, and was green. The seed count is 2,000 for this reason, which is the whole
argument for not pinning a property suite to its stated minimum.
