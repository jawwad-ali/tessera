import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Expectation, Measurement } from './expectations.ts';

/**
 * Running the bench scripts and reading their registered numbers out.
 *
 * The scripts print for humans, and rewriting them to emit JSON would mean editing the
 * evidence — the whole point of salvaging them intact is that they are the same code that
 * produced the numbers in ARCHITECTURE.md. So the extraction contract lives beside the
 * expectation instead, in `bench/expectations.json`, where a change to it is a visible diff.
 */

/**
 * Read one registered number out of a script's stdout.
 *
 * Returns `undefined` rather than throwing or coercing: a pattern that no longer matches
 * means the script's output shape changed, and that has to surface as an unmeasured claim
 * rather than as a `NaN` that compares equal to nothing and quietly passes.
 */
export const extractValue = (stdout: string, extract: string): number | undefined => {
  let pattern: RegExp;
  try {
    pattern = new RegExp(extract, 's');
  } catch {
    // A mis-escaped pattern must cost one unmeasured claim, not the whole run. In JSON and in
    // a quoted string `\(` has to be written `\\(`, and that mistake is easy to make.
    return undefined;
  }

  const captured = pattern.exec(stdout)?.[1];
  if (captured === undefined) return undefined;

  const value = Number(captured);
  return Number.isFinite(value) ? value : undefined;
};

/** One script's run: its output, or the reason it produced none. */
export interface RunOutcome {
  readonly script: string;
  readonly stdout: string;
  readonly failure?: string;
}

/**
 * Run a bench script and capture its stdout.
 *
 * Bench scripts are minutes long, so `maxBuffer` is raised and the timeout is generous. A
 * script that is absent or exits non-zero is reported, never silently skipped — a skipped
 * script is an unchecked claim.
 */
export const runScript = (script: string, repoRoot: string): RunOutcome => {
  const absolute = join(repoRoot, script);
  if (!existsSync(absolute)) {
    return { script, stdout: '', failure: `missing: ${script}` };
  }

  try {
    const stdout = execFileSync(process.execPath, [absolute], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
    });
    return { script, stdout };
  } catch (error) {
    return {
      script,
      stdout: '',
      failure: `failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

/**
 * Measure every expectation, running each script once however many claims it carries.
 *
 * Running a script per claim would multiply a minutes-long suite by its claim count, so
 * output is cached by script for the duration of the call.
 */
export const measureAll = (
  expectations: readonly Expectation[],
  repoRoot: string,
): { readonly measurements: readonly Measurement[]; readonly failures: readonly string[] } => {
  const outputs = new Map<string, RunOutcome>();
  const measurements: Measurement[] = [];
  const failures: string[] = [];

  for (const expectation of expectations) {
    let outcome = outputs.get(expectation.script);
    if (!outcome) {
      outcome = runScript(expectation.script, repoRoot);
      outputs.set(expectation.script, outcome);
      if (outcome.failure !== undefined) failures.push(outcome.failure);
    }

    const value = extractValue(outcome.stdout, expectation.extract);
    if (value !== undefined) measurements.push({ id: expectation.id, value });
  }

  return { measurements, failures };
};
