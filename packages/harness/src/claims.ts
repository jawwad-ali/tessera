import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Citation checking: a document may not name a file that does not exist.
 *
 * This exists because the repository already shipped the failure once — the README
 * advertised bitmap caches, LOD by zoom and relay persistence while `apps/relay/src` was
 * empty. Prose drifts from the tree silently, and the only reliable fix is a gate.
 */

export interface Citation {
  /** Document the citation was found in, repo-relative. */
  readonly doc: string;
  /** The cited path, repo-relative. */
  readonly path: string;
  /** 1-indexed line, so it can be fixed without searching. */
  readonly line: number;
}

/**
 * A backticked token is a path only if it contains a separator **and** ends in a short
 * lowercase extension.
 *
 * Both halves earn their place. Without the separator, `Y.Map` and `p95` read as paths.
 * Without the extension, `@tessera/core` and `gc: true` do. The consequence is that bare
 * directory citations are not checked, which is a deliberate limit: this guard is about
 * files a reviewer can open.
 */
const PATH_TOKEN = /[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.*-]+)+\.[a-z][a-z0-9]{0,4}/g;

/** Backticked spans, which is where this project writes paths. */
const CODE_SPAN = /`([^`\n]+)`/g;

/** Relative markdown links. A broken one is worse than broken prose: it renders and 404s. */
const RELATIVE_LINK = /\]\(\.{0,2}\/?([^)\s#]+)(?:#[^)\s]*)?\)/g;

/** A glob stands for a set that may legitimately be empty, so it is not a checkable claim. */
const isGlob = (path: string): boolean => path.includes('*');

const citationsInLine = (line: string): readonly string[] => {
  const found: string[] = [];

  for (const span of line.matchAll(CODE_SPAN)) {
    const inner = span[1];
    if (inner === undefined) continue;
    // A span may be a whole command — `node scripts/check-single-yjs.ts` — so extract the
    // path-shaped tokens from inside it rather than testing the span as a unit.
    for (const token of inner.matchAll(PATH_TOKEN)) found.push(token[0]);
  }

  for (const link of line.matchAll(RELATIVE_LINK)) {
    const target = link[1];
    if (target === undefined) continue;
    if (/^(https?:|mailto:)/.test(target)) continue;
    found.push(target);
  }

  return found;
};

/**
 * Find citations in `docs` that point at paths absent from `repoRoot`.
 *
 * @param docs Repo-relative document paths. A document that does not exist is skipped rather
 *   than reported: the caller chooses the list, and a missing document is that caller's bug,
 *   not a false citation.
 * @param only Restrict checking to citations matching this pattern. Used to hold every
 *   document to the bench-script rule while holding only the README to the full one.
 */
export const findBrokenCitations = (
  docs: readonly string[],
  repoRoot: string,
  only?: RegExp,
): readonly Citation[] => {
  const broken: Citation[] = [];

  for (const doc of docs) {
    const absolute = join(repoRoot, doc);
    if (!existsSync(absolute)) continue;

    const lines = readFileSync(absolute, 'utf8').split(/\r?\n/);

    lines.forEach((line, index) => {
      for (const path of citationsInLine(line)) {
        if (isGlob(path)) continue;
        if (only && !only.test(path)) continue;
        if (existsSync(join(repoRoot, path))) continue;
        broken.push({ doc, path, line: index + 1 });
      }
    });
  }

  return broken;
};
