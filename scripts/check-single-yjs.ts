/**
 * Invariant 2 (ARCHITECTURE.md §3, §11): exactly one *physical* copy of yjs.
 *
 * Measured: two physical copies of the SAME version — including one resolved as ESM and
 * one as CJS — give `Ya.Doc !== Yb.Doc`, so `docA.getMap('shapes').set('s1', new Yb.Map())`
 * throws `Unexpected content type`. Binary updates still cross perfectly between the two
 * copies, so a two-copy tree looks completely healthy right up until the first nested type
 * (a `Y.Text` sticky note), at which point it fails in a way that reads like a data bug.
 *
 * Yjs itself prints `console.error('Yjs was already imported...')`, which is invisible in a
 * Next dev log or a container's stdout. So we check the tree instead of trusting the warning.
 *
 * Note carefully what this does and does not catch. It is a *static* check over the
 * installed tree: it catches version divergence and duplicated physical installs, which is
 * what a bad lockfile or a stray direct dependency produces. It cannot catch two module
 * *instances* loaded from one directory through different export conditions — that is a
 * runtime property, guarded by `assertSingleYjsInstance()` in `@tessera/crdt`.
 *
 * Written in TypeScript and run by bare `node` via native type-stripping, so it is covered
 * by `pnpm typecheck` and still executable in CI before anything is built.
 *
 * Run: `node scripts/check-single-yjs.ts`
 */
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface Copy {
  readonly version: string;
  /** Every path that resolves here, so a failure can name the offending link. */
  readonly aliases: Set<string>;
}

/** realpath -> copy. Symlinks collapse onto their target, so pnpm links are not miscounted. */
const copies = new Map<string, Copy>();

/** Read a `version` out of a package.json without trusting its shape. */
const readVersion = (packageDir: string): string | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  } catch {
    return undefined; // not a package dir, or unreadable
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const version: unknown = (parsed as Record<string, unknown>)['version'];
  return typeof version === 'string' ? version : undefined;
};

const record = (dir: string): void => {
  let real: string;
  try {
    real = realpathSync(dir);
  } catch {
    return; // dangling link
  }
  const version = readVersion(real);
  if (version === undefined) return;

  const existing = copies.get(real);
  if (existing) {
    existing.aliases.add(dir);
    return;
  }
  copies.set(real, { version, aliases: new Set([dir]) });
};

/** Walk node_modules trees, following the pnpm virtual store, without cycling. */
const walk = (dir: string, depth = 0): void => {
  if (depth > 8) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.name === 'yjs') {
      record(full);
      continue;
    }
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name === 'node_modules' || entry.name.startsWith('@') || entry.name === '.pnpm') {
      walk(full, depth + 1);
    } else if (depth === 0) {
      try {
        if (statSync(full).isDirectory()) walk(join(full, 'node_modules'), depth + 1);
      } catch {
        /* dangling link */
      }
    }
  }
};

walk('node_modules');
for (const workspace of ['packages', 'apps']) {
  try {
    for (const name of readdirSync(workspace)) walk(join(workspace, name, 'node_modules'), 1);
  } catch {
    /* workspace dir absent */
  }
}

if (copies.size === 0) {
  console.error('check-single-yjs: no yjs found. Run `pnpm install` first.');
  process.exit(1);
}

const versions = new Set([...copies.values()].map((copy) => copy.version));

if (copies.size > 1 || versions.size > 1) {
  console.error(
    `check-single-yjs: FAIL — ${String(copies.size)} physical copies, ` +
      `${String(versions.size)} version(s).\n`,
  );
  for (const [real, { version, aliases }] of copies) {
    console.error(`  ${version}  ${real}`);
    for (const alias of aliases) if (alias !== real) console.error(`      linked from ${alias}`);
  }
  console.error(
    '\nPin it in pnpm-workspace.yaml `overrides`, and keep yjs a peerDependency of\n' +
      '@tessera/crdt so a stray direct dependency is an install error rather than a second\n' +
      'copy. Two copies make nested Y types throw `Unexpected content type` while binary\n' +
      'updates keep working, so the bug hides until the first nested type.',
  );
  process.exit(1);
}

// The guard above establishes size === 1, but neither indexing nor iterator destructuring
// can express that under `noUncheckedIndexedAccess` without a cast or a `!`. Iterating the
// single entry needs no assertion at all, which is the honest way to say it.
for (const [real, copy] of copies) {
  console.log(
    `check-single-yjs: ok — yjs ${copy.version}, 1 physical copy at ${real} ` +
      `(${String(copy.aliases.size)} link(s))`,
  );
}
