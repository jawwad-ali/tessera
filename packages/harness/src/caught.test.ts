import { describe as group, expect, it } from 'vitest';

import { REQUIRED_COLUMNS, checkCaught } from './caught.ts';

/**
 * The gate's own refusals.
 *
 * A gate whose failure path has never run is not a gate — `pnpm bench:check` had to be
 * demonstrated failing on a perturbed expectation before it was believed, and this is the
 * same obligation. Each test below breaks the evidence file in one of the three ways `2.C4`
 * names, and asserts the checker notices.
 */

const HEADER = `| ${REQUIRED_COLUMNS.join(' | ')} |\n|${REQUIRED_COLUMNS.map(() => '---').join('|')}|`;

const row = (over: Partial<Record<string, string>> = {}): string => {
  const cells: Record<string, string> = {
    id: 'found-9',
    class: 'found',
    'invariant fired': 'distinct-index',
    'seeds to failure': '1492',
    shrinks: '48',
    'shrink length': '5 actions',
    'wall-clock': '473ms',
    'base seed': '20260903',
    'corpus key': 'found-9',
    'fixing sha': 'abc1234',
    ...over,
  };
  return `| ${REQUIRED_COLUMNS.map((name) => cells[name] ?? '').join(' | ')} |`;
};

const CORPUS = {
  version: 1,
  entries: [{ key: 'found-9', baseSeed: 20260903, seedsToFailure: 1492, path: '1491:1:1' }],
};

const touchedReal = (): readonly string[] => ['packages/core/src/scene/order.ts'];

group('caught', () => {
  it('passes a complete row backed by a corpus entry and a real fix', () => {
    expect(
      checkCaught({ markdown: `${HEADER}\n${row()}`, corpus: CORPUS, filesTouched: touchedReal }),
    ).toEqual([]);
  });

  it('refuses a row with a column left blank', () => {
    // The shape of a number that was never measured.
    const problems = checkCaught({
      markdown: `${HEADER}\n${row({ 'wall-clock': '' })}`,
      corpus: CORPUS,
      filesTouched: touchedReal,
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('wall-clock');
  });

  it('refuses a row with a column missing entirely', () => {
    const short = REQUIRED_COLUMNS.slice(0, -1);
    const problems = checkCaught({
      markdown: `| ${short.join(' | ')} |\n|${short.map(() => '---').join('|')}|\n| ${short.map(() => 'x').join(' | ')} |`,
      corpus: CORPUS,
      filesTouched: touchedReal,
    });

    expect(problems.join(' ')).toContain('fixing sha');
  });

  it('refuses a found row whose seed is not in the corpus', () => {
    // Without a corpus entry there is nothing to re-run, so the bug is a paragraph.
    const problems = checkCaught({
      markdown: `${HEADER}\n${row({ 'corpus key': 'never-recorded' })}`,
      corpus: CORPUS,
      filesTouched: touchedReal,
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('not in the corpus');
  });

  it('refuses a found row fixed only by touching tests', () => {
    // The signature of a bug "fixed" by weakening the test that found it.
    const problems = checkCaught({
      markdown: `${HEADER}\n${row()}`,
      corpus: CORPUS,
      filesTouched: () => ['packages/harness/src/converge.test.ts', 'harness/CAUGHT.md'],
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('only tests');
  });

  it('refuses a found row whose fixing sha does not exist', () => {
    const problems = checkCaught({
      markdown: `${HEADER}\n${row()}`,
      corpus: CORPUS,
      filesTouched: () => [],
    });

    expect(problems[0]).toContain('touches no files');
  });

  it('holds a planted row to the columns but not to the corpus', () => {
    // A planted mutant has no seed to preserve: it is reproduced by re-applying the mutant,
    // and its evidence is the commit where it passed. The column requirement still applies.
    expect(
      checkCaught({
        markdown: `${HEADER}\n${row({ id: 'planted-1', class: 'planted', 'corpus key': 'n/a' })}`,
        corpus: CORPUS,
        filesTouched: () => [],
      }),
    ).toEqual([]);
  });

  it('refuses a class that is neither planted nor found', () => {
    const problems = checkCaught({
      markdown: `${HEADER}\n${row({ class: 'probably' })}`,
      corpus: CORPUS,
      filesTouched: touchedReal,
    });

    expect(problems[0]).toContain('neither planted nor found');
  });

  it('refuses a file with no table at all', () => {
    const problems = checkCaught({
      markdown: '# CAUGHT\n\nNothing was caught, honestly.',
      corpus: CORPUS,
      filesTouched: touchedReal,
    });

    expect(problems[0]).toContain('no table');
  });
});
