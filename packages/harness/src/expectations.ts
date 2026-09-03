/**
 * Pre-registered expectations for every `[M]` claim.
 *
 * The contract is that the tolerance is written down *before* the measurement. A bound first
 * entered after seeing the number is not a bound, it is a description — and a claim checked
 * against a description always passes.
 */

export interface Expectation {
  /** Stable id, shared with the measurement and with the row in `docs/measurements.md`. */
  readonly id: string;
  /** Repo-relative script that reproduces this claim. */
  readonly script: string;
  /** Regex source with one capture group, applied to the script's stdout. */
  readonly extract: string;
  readonly expected: number;
  /**
   * Permitted fractional drift. `0` means structural — the value cannot legitimately move at
   * all, because it encodes a merge rule or a module-identity fact rather than a duration.
   */
  readonly tolerance: number;
  readonly unit: string;
  /** Why the tolerance is that wide. An unjustified tolerance is refused. */
  readonly why: string;
}

export interface Measurement {
  readonly id: string;
  readonly value: number;
}

export interface ClaimViolation {
  readonly id: string;
  readonly reason: string;
}

/**
 * Compare measurements against expectations. Every disagreement is a violation.
 *
 * Both directions are checked. An expectation with no measurement means a script stopped
 * emitting its number, which would otherwise let a claim quietly fall out of coverage while
 * CI stayed green. A measurement with no expectation means a number nobody registered, which
 * either belongs in the file or should not be emitted.
 */
export const checkClaims = (
  expectations: readonly Expectation[],
  measurements: readonly Measurement[],
): readonly ClaimViolation[] => {
  const violations: ClaimViolation[] = [];
  const byId = new Map(measurements.map((entry) => [entry.id, entry.value]));

  for (const expectation of expectations) {
    if (expectation.why.trim() === '') {
      violations.push({
        id: expectation.id,
        reason: `tolerance ${String(expectation.tolerance)} has no stated reason (why: "")`,
      });
      continue;
    }

    const actual = byId.get(expectation.id);
    if (actual === undefined) {
      violations.push({
        id: expectation.id,
        reason: `not measured — ${expectation.script} emitted nothing matching /${expectation.extract}/`,
      });
      continue;
    }

    const allowed = Math.abs(expectation.expected) * expectation.tolerance;
    const drift = Math.abs(actual - expectation.expected);
    if (drift > allowed) {
      const kind = expectation.tolerance === 0 ? 'structural claim changed' : 'drift beyond tolerance';
      violations.push({
        id: expectation.id,
        reason:
          `${kind}: expected ${String(expectation.expected)}${expectation.unit}, ` +
          `measured ${String(actual)}${expectation.unit} ` +
          `(tolerance ±${String(expectation.tolerance * 100)}%, ${expectation.why})`,
      });
    }
  }

  for (const measurement of measurements) {
    if (!expectations.some((expectation) => expectation.id === measurement.id)) {
      violations.push({
        id: measurement.id,
        reason: `measured ${String(measurement.value)} but no expectation is registered for it`,
      });
    }
  }

  return violations;
};
