import { describe as group, expect, it } from 'vitest';

import { extractValue } from './measure.ts';

/**
 * Turning a script's output into a registered number.
 *
 * The bench scripts print for humans, and rewriting them to emit JSON would mean editing the
 * evidence. So the extraction contract lives in `bench/expectations.json` instead, and this
 * is the function that applies it.
 */
group('a registered number is read out of a script’s output', () => {
  it('reads an integer out of a real crit1 line', () => {
    const stdout =
      'A  per-frame 2 keys, FLOAT   structs=  13600 v1= 134.0KB v2= 17.6KB   (+12000 structs, +107.2KB v1)';

    // `.source` of a real literal rather than a hand-escaped string: in JSON and in a
    // quoted string, `\(` has to be written `\\(`, and getting that wrong silently produces
    // a different regex rather than an error.
    expect(extractValue(stdout, /per-frame 2 keys, FLOAT.*?\(\+(\d+) structs/.source)).toBe(12000);
  });

  it('reads a decimal out of a real crit3 line', () => {
    const stdout = 'encodeStateAsUpdateV2    [V2]     0.22 MB   lossless   26.8x   = 230 KB';

    expect(extractValue(stdout, /encodeStateAsUpdateV2.*?lossless\s+([\d.]+)x/.source)).toBe(26.8);
  });

  it('reports a malformed pattern instead of crashing the run', () => {
    // Observed for real while writing this: a mis-escaped pattern threw a SyntaxError out of
    // the extractor and took the whole run down. A bad line in the expectations file has to
    // fail as one unmeasured claim, not as a crash that loses every other claim with it.
    expect(extractValue('structs=42', 'structs=(+')).toBeUndefined();
  });

  it('reports nothing when the pattern no longer matches', () => {
    // The failure this protects against: a script is edited, its output shape changes, and
    // the claim silently stops being checked while CI stays green.
    expect(extractValue('some other output entirely', 'structs=(\d+)')).toBeUndefined();
  });

  it('reports nothing rather than NaN when the capture is not a number', () => {
    expect(extractValue('value=abc', 'value=(\w+)')).toBeUndefined();
  });
});
