/**
 * The gate on `harness/CAUGHT.md`.
 *
 * A methodology claim is only worth the artefact behind it, and an artefact nobody checks
 * rots into a story. `2.C4` names the three ways this particular file rots, and each is a
 * failure here rather than a note:
 *
 *  1. **A row missing a column.** A row without its shrink length or its wall-clock is a
 *     claim with the number left out, which is exactly the shape of a number that was never
 *     measured.
 *  2. **A `found` row whose seed is not in the corpus.** Without a corpus entry there is
 *     nothing to re-run, so the bug is a paragraph rather than a regression test.
 *  3. **A `found` row whose fixing commit touches only test files.** That is the signature of
 *     a bug "fixed" by deleting or weakening the test that found it.
 *
 * Everything is injected — the markdown, the corpus, and the file list per commit — so the
 * checker itself is testable, including its refusals. A gate whose failure path has never run
 * is not a gate.
 */

/** Columns every row must carry, by header text. A renamed column fails as loudly as a missing one. */
export const REQUIRED_COLUMNS = [
  'id',
  'class',
  'invariant fired',
  'seeds to failure',
  'shrinks',
  'shrink length',
  'wall-clock',
  'base seed',
  'corpus key',
  'fixing sha',
] as const;

export type CaughtClass = 'planted' | 'found';

export interface CaughtRow {
  readonly id: string;
  readonly class: string;
  readonly corpusKey: string;
  readonly fixingSha: string;
  /** Every cell by header, so a missing-column complaint can name the header. */
  readonly cells: Readonly<Record<string, string>>;
}

export interface CorpusEntry {
  readonly key: string;
  readonly baseSeed: number;
  readonly seedsToFailure: number;
  /** fast-check's replay path, which reproduces the *unshrunk* failure exactly. */
  readonly path: string;
}

export interface Corpus {
  readonly version: number;
  readonly entries: readonly CorpusEntry[];
}

export interface CaughtInputs {
  readonly markdown: string;
  readonly corpus: Corpus;
  /** Files a commit touched, repo-relative. Injected so the refusals are testable. */
  readonly filesTouched: (sha: string) => readonly string[];
}

/** A path that cannot contain a fix: only tests and evidence live here. */
const isTestOnly = (path: string): boolean =>
  path.includes('.test.') || path.startsWith('harness/') || path.endsWith('CAUGHT.md');

/**
 * Rows of the one table in `CAUGHT.md`.
 *
 * Deliberately strict about shape rather than clever about parsing: the table is the
 * interface, so a file that has drifted into a different format should fail rather than be
 * guessed at.
 */
export const parseRows = (markdown: string): { readonly rows: readonly CaughtRow[]; readonly problems: readonly string[] } => {
  const lines = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'));

  const cellsOf = (line: string): readonly string[] =>
    line
      .slice(1, line.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((cell) => cell.trim());

  const header = lines[0];
  if (header === undefined) return { rows: [], problems: ['CAUGHT.md contains no table at all'] };

  const headers = cellsOf(header).map((cell) => cell.toLowerCase().replace(/[*`]/g, ''));
  const problems: string[] = [];

  for (const required of REQUIRED_COLUMNS) {
    if (!headers.includes(required)) problems.push(`the table has no '${required}' column`);
  }
  if (problems.length > 0) return { rows: [], problems };

  const rows: CaughtRow[] = [];
  // Line 0 is the header and line 1 the separator; a table with neither has already failed.
  for (const [offset, line] of lines.slice(2).entries()) {
    const cells = cellsOf(line);
    if (cells.length !== headers.length) {
      problems.push(
        `row ${offset + 1} has ${cells.length} cells against ${headers.length} columns — a column is missing`,
      );
      continue;
    }

    const byHeader: Record<string, string> = {};
    headers.forEach((name, index) => {
      byHeader[name] = cells[index] ?? '';
    });

    const empty = REQUIRED_COLUMNS.filter((name) => (byHeader[name] ?? '').replace(/[-–—]/g, '') === '');
    if (empty.length > 0) {
      problems.push(`row ${offset + 1} leaves ${empty.join(', ')} empty`);
      continue;
    }

    rows.push({
      id: byHeader['id'] ?? '',
      class: byHeader['class'] ?? '',
      corpusKey: (byHeader['corpus key'] ?? '').replace(/[`]/g, ''),
      fixingSha: (byHeader['fixing sha'] ?? '').replace(/[`]/g, ''),
      cells: byHeader,
    });
  }

  return { rows, problems };
};

/** Every problem with the evidence, or an empty list. Never throws; the CLI decides the exit code. */
export const checkCaught = (inputs: CaughtInputs): readonly string[] => {
  const { rows, problems: parseProblems } = parseRows(inputs.markdown);
  const problems = [...parseProblems];

  const known = new Set(inputs.corpus.entries.map((entry) => entry.key));

  for (const row of rows) {
    if (row.class !== 'planted' && row.class !== 'found') {
      problems.push(`${row.id}: class is '${row.class}', which is neither planted nor found`);
      continue;
    }

    if (row.class === 'found' && !known.has(row.corpusKey)) {
      problems.push(
        `${row.id}: found rows must be re-runnable, and '${row.corpusKey}' is not in the corpus`,
      );
    }

    if (row.class === 'found') {
      const touched = inputs.filesTouched(row.fixingSha);
      if (touched.length === 0) {
        problems.push(`${row.id}: fixing sha ${row.fixingSha} touches no files, or does not exist`);
      } else if (touched.every(isTestOnly)) {
        problems.push(
          `${row.id}: fixing sha ${row.fixingSha} touches only tests and evidence — a bug fixed ` +
            'by changing the test that found it is not fixed',
        );
      }
    }
  }

  return problems;
};
