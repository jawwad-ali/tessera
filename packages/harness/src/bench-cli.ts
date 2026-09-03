import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkClaims, type Expectation } from './expectations.ts';
import { measureAll } from './measure.ts';

/**
 * `pnpm bench` — run every bench script and write the measurements.
 * `pnpm bench:check` — the same, then fail if any claim drifted outside its tolerance.
 *
 * Running and checking are one command on purpose. A `check` that compared a previously
 * written file could pass against a stale run, which is the one thing a drift gate must not
 * do.
 */

const repoRoot = process.cwd().replace(/packages[\\/]harness$/, '');
const checking = process.argv.includes('--check');

const expectations = JSON.parse(
  readFileSync(join(repoRoot, 'bench/expectations.json'), 'utf8'),
) as Expectation[];

console.log(`running ${String(expectations.length)} registered claims...\n`);

const { measurements, failures } = measureAll(expectations, repoRoot);

for (const failure of failures) console.error(`  script ${failure}`);

const byId = new Map(measurements.map((entry) => [entry.id, entry.value]));
for (const expectation of expectations) {
  const value = byId.get(expectation.id);
  const shown = value === undefined ? 'NOT MEASURED' : `${String(value)}${expectation.unit}`;
  console.log(
    `  ${expectation.id.padEnd(24)} expected ${String(expectation.expected)}${expectation.unit.padEnd(9)} measured ${shown}`,
  );
}

// Raw run output stays out of git — see PHASES.md D-3. The committed artifacts are
// bench/expectations.json and the generated rows in docs/measurements.md.
mkdirSync(join(repoRoot, 'bench-out'), { recursive: true });
writeFileSync(
  join(repoRoot, 'bench-out/measurements.json'),
  `${JSON.stringify({ measurements, failures }, null, 2)}\n`,
  'utf8',
);

if (!checking) {
  console.log('\nwrote bench-out/measurements.json');
  process.exit(0);
}

const violations = checkClaims(expectations, measurements);

if (failures.length > 0 || violations.length > 0) {
  console.error('\nbench:check FAILED\n');
  for (const violation of violations) console.error(`  ${violation.id}: ${violation.reason}`);
  console.error(
    '\nA claim drifted, or a script stopped emitting its number. Either the code changed\n' +
      'and ARCHITECTURE.md needs amending in the same commit, or the expectation was wrong.\n' +
      'Do not widen a tolerance to make this pass.',
  );
  process.exit(1);
}

console.log('\nbench:check ok — every registered claim is within its pre-registered tolerance');
