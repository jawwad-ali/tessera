import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe as group, expect, it } from 'vitest';

import { findBrokenCitations } from './claims.ts';

/**
 * The reviewer who follows a link.
 *
 * Every document in this repo cites paths — bench scripts, source modules, captures — and a
 * citation to something that does not exist is the specific way a repository lies. It is also
 * the failure mode this project already shipped once: the README advertised bitmap caches and
 * relay persistence while `apps/relay/src` was empty (defect D-2), and ARCHITECTURE.md cites
 * eight bench scripts the tree does not contain.
 *
 * These tests describe what the reviewer experiences, and what CI must therefore refuse.
 */

const fixtureDir = (): string => mkdtempSync(join(tmpdir(), 'tessera-claims-'));

group('a citation to something that does not exist is reported', () => {
  it('reports the missing path and leaves the real one alone', () => {
    const root = fixtureDir();
    writeFileSync(join(root, 'real.txt'), 'i exist');
    writeFileSync(
      join(root, 'DOC.md'),
      ['Here is `real.txt` which exists.', '', 'And `bench/ghost.mjs` which does not.'].join('\n'),
    );

    const broken = findBrokenCitations(['DOC.md'], root);

    expect(broken).toHaveLength(1);
    expect(broken[0]?.path).toBe('bench/ghost.mjs');
  });

  it('says which document and which line, so it can be fixed without a search', () => {
    const root = fixtureDir();
    writeFileSync(join(root, 'DOC.md'), ['line one', 'line two', '`packages/nope/src/x.ts`'].join('\n'));

    const broken = findBrokenCitations(['DOC.md'], root);

    expect(broken[0]?.doc).toBe('DOC.md');
    expect(broken[0]?.line).toBe(3);
  });

  it('follows markdown links as well as backticked paths', () => {
    // A reviewer clicks links; they are citations too, and a broken one is worse because it
    // renders as a link and 404s.
    const root = fixtureDir();
    writeFileSync(join(root, 'DOC.md'), 'See [the plan](./MISSING.md) for detail.');

    const broken = findBrokenCitations(['DOC.md'], root);

    expect(broken.map((entry) => entry.path)).toEqual(['MISSING.md']);
  });

  it('does not report prose that merely looks like a path', () => {
    // Without this the check is noise, and a noisy gate gets disabled. Commands, package
    // names and bare identifiers are not citations.
    const root = fixtureDir();
    writeFileSync(
      join(root, 'DOC.md'),
      [
        'Run `pnpm verify` and `node scripts/check-single-yjs.ts` from the root.',
        'The package is `@tessera/core` and the option is `gc: true`.',
        'Values like `Y.Map` and `p95` are not paths.',
      ].join('\n'),
    );

    const broken = findBrokenCitations(['DOC.md'], root);

    // `scripts/check-single-yjs.ts` is absent from this fixture root, so it is the only
    // legitimate finding — everything else must be ignored.
    expect(broken.map((entry) => entry.path)).toEqual(['scripts/check-single-yjs.ts']);
  });
});

/**
 * Scope, chosen deliberately rather than maximally.
 *
 * Not every document makes a claim about the present. ARCHITECTURE.md describes the target
 * design and names modules not yet written (`packages/crdt/src/tx.ts`), and PHASES.md cites
 * artifacts a future phase creates (`harness/CAUGHT.md`). Failing on those would make the
 * guard fire on correct, forward-looking prose — and a gate that cries wolf gets disabled,
 * which is worse than not having one.
 *
 * So the guard covers exactly the two ways this repository has actually lied:
 *  - **README.md**, which claims what is built *today* — defect D-2.
 *  - **every `bench/` script cited in any document**, because those citations claim a number
 *    is reproducible, and an unreproducible number is the failure mode the whole measurement
 *    envelope exists to prevent.
 */
const repoRoot = (): string => process.cwd().replace(/packages[\\/]harness$/, '');

group('the README cannot claim a file that does not exist', () => {
  it('cites nothing missing', () => {
    const broken = findBrokenCitations(['README.md'], repoRoot());

    expect(broken.map((entry) => `${entry.doc}:${String(entry.line)} -> ${entry.path}`)).toEqual(
      [],
    );
  });
});

group('every cited bench script exists, so every published number is reproducible', () => {
  it('holds across all documents', () => {
    const broken = findBrokenCitations(
      ['README.md', 'ARCHITECTURE.md', 'PHASES.md', 'CLAUDE.md'],
      repoRoot(),
      /^bench\//,
    );

    expect(broken.map((entry) => `${entry.doc}:${String(entry.line)} -> ${entry.path}`)).toEqual(
      [],
    );
  });
});
