import { describe as group, expect, it } from 'vitest';

import { checkClaims, type Expectation, type Measurement } from './expectations.ts';

/**
 * The reviewer who re-runs a number.
 *
 * Every `[M]` claim in ARCHITECTURE.md asserts a measured fact. A reviewer's only real
 * recourse is to run the harness and see whether the number still holds — so drift has to be
 * loud, and the tolerance has to be decided *before* the measurement, or the tolerance is
 * just a description of whatever happened.
 *
 * The distinction the tolerance encodes: some claims are structural and cannot legitimately
 * move at all (a concurrent set beats a delete; two module copies give different
 * constructors), while others are timing and move with the hardware.
 */

const structural = (value: number): Expectation => ({
  id: 'set-beats-delete',
  script: 'bench/mig1.mjs',
  extract: 'winner=(\\d+)',
  expected: value,
  tolerance: 0,
  unit: 'outcome',
  why: 'structural: the merge rule cannot change without a yjs behaviour change',
});

const timing = (value: number): Expectation => ({
  id: 'cold-load-50k',
  script: 'bench/cold.mjs',
  extract: 'applyUpdate=(\\d+)ms',
  expected: value,
  tolerance: 0.5,
  unit: 'ms',
  why: 'hardware-bound: stated as a multiple, not a precise figure',
});

const measured = (id: string, value: number): Measurement[] => [{ id, value }];

group('a number that drifts is refused', () => {
  it('passes a timing claim that moved within its stated tolerance', () => {
    // 2027ms against an expected 2000ms with ±50% — the machine is slower today, and that is
    // exactly what the tolerance is for.
    expect(checkClaims([timing(2000)], measured('cold-load-50k', 2027))).toEqual([]);
  });

  it('fails a timing claim that moved beyond it', () => {
    const violations = checkClaims([timing(2000)], measured('cold-load-50k', 6000));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.id).toBe('cold-load-50k');
  });

  it('names both numbers, so the reviewer does not have to dig', () => {
    const violations = checkClaims([timing(2000)], measured('cold-load-50k', 6000));

    expect(violations[0]?.reason).toContain('2000');
    expect(violations[0]?.reason).toContain('6000');
  });

  it('fails a structural claim on ANY change, however small', () => {
    // Tolerance 0 means what it says. A structural outcome that shifts by one is a yjs
    // behaviour change and every design decision resting on it needs revisiting.
    expect(checkClaims([structural(1000)], measured('set-beats-delete', 1000))).toEqual([]);
    expect(checkClaims([structural(1000)], measured('set-beats-delete', 1001))).toHaveLength(1);
  });
});

group('a claim cannot pass by going missing', () => {
  it('fails when the expectation was never measured', () => {
    // The failure mode this prevents: a script that silently stops emitting its number, so
    // the claim quietly stops being checked while CI stays green.
    const violations = checkClaims([timing(2000)], []);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toMatch(/not measured|missing/i);
  });

  it('fails when a measurement has no expectation, rather than ignoring it', () => {
    // An unregistered number is a number nobody agreed to. Either it belongs in the
    // expectations file or it should not be emitted.
    const violations = checkClaims([], measured('mystery-number', 42));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.id).toBe('mystery-number');
  });
});

group('the expectations file has to be honest about itself', () => {
  it('refuses a tolerance with no stated reason', () => {
    // A tolerance without a justification is a number chosen to make the test pass.
    const noReason: Expectation = { ...timing(2000), why: '' };

    const violations = checkClaims([noReason], measured('cold-load-50k', 2000));

    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toMatch(/why|reason|justif/i);
  });
});
