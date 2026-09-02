import { describe as group, expect, it } from 'vitest';

import {
  CloseCode,
  MAX_CLOSE_REASON_BYTES,
  clampReason,
  defaultReason,
  isPermanent,
  utf8ByteLength,
} from './close-codes.ts';

group('close codes carry the reconnect policy', () => {
  it('denials that cannot be retried are in the permanent range', () => {
    // y-websocket 3.1.0: defaultShouldReconnect = !(code >= 4400 && code < 4500).
    // If one of these ever falls outside it, every denied client returns every ~2.5s with
    // no jitter, forever - which is a self-inflicted outage, not a bug in the client.
    for (const code of [
      CloseCode.ProtocolError,
      CloseCode.Unauthenticated,
      CloseCode.PermissionDenied,
      CloseCode.RoomGone,
      CloseCode.EpochStale,
    ]) {
      expect(isPermanent(code), `code ${String(code)}`).toBe(true);
    }
  });

  it('denials that SHOULD be retried are not', () => {
    // A rate limit or a drain is transient by definition. Marking them permanent would
    // strand a user whose only mistake was a burst.
    expect(isPermanent(CloseCode.RateLimited)).toBe(false);
    expect(isPermanent(CloseCode.Draining)).toBe(false);
  });

  it('every code has a reason that fits in a close frame', () => {
    for (const code of Object.values(CloseCode)) {
      const reason = defaultReason(code);
      expect(reason).not.toBe('');
      expect(utf8ByteLength(reason)).toBeLessThanOrEqual(MAX_CLOSE_REASON_BYTES);
    }
  });
});

group('clampReason', () => {
  it('leaves a short reason untouched', () => {
    expect(clampReason('room not found')).toBe('room not found');
  });

  it('clamps to the RFC 6455 limit', () => {
    const long = 'x'.repeat(500);
    const clamped = clampReason(long);
    expect(utf8ByteLength(clamped)).toBe(MAX_CLOSE_REASON_BYTES);
  });

  it('never splits a multi-byte code point', () => {
    // A boundary that lands mid-sequence is the interesting case: an invalid close frame is
    // dropped, so the client is left with no reason at all.
    for (const filler of ['é', '€', '🙂']) {
      // Overshoot the cap by a variable amount so the boundary falls at every offset
      // within a character.
      for (let count = 30; count <= 130; count++) {
        const clamped = clampReason(filler.repeat(count));
        expect(utf8ByteLength(clamped)).toBeLessThanOrEqual(MAX_CLOSE_REASON_BYTES);
        // Decomposing into CODE POINTS is the intent here, not an accident: the property
        // under test is that clamping never leaves a partial character behind, so every
        // code point in the result must be the whole filler character.
        // (`Array.from` rather than spread — same string iterator, and it does not trip the
        // grapheme-safety lint rule that exists to catch the accidental version of this.)
        expect(Array.from(clamped).every((character) => character === filler)).toBe(true);
        expect(utf8ByteLength(clamped) % utf8ByteLength(filler)).toBe(0);
      }
    }
  });

  it('handles a surrogate pair astride the boundary', () => {
    // 🙂 is 4 UTF-8 bytes and 2 UTF-16 units. With 121 single-byte characters ahead of it
    // there are 2 bytes left - not enough - so it must be dropped whole.
    const reason = `${'a'.repeat(121)}🙂`;
    const clamped = clampReason(reason);
    expect(clamped).toBe('a'.repeat(121));
    expect(utf8ByteLength(clamped)).toBe(121);
  });
});

group('utf8ByteLength', () => {
  it('agrees with the platform encoder', () => {
    // The arithmetic exists so this package needs no DOM or node types, but it still has to
    // be right. TextEncoder is available in the test environment even though it is not in
    // the package's lib, so the equivalence is checkable here.
    const encoder = new TextEncoder();
    const samples = [
      '',
      'ascii',
      'café',
      '€100',
      '🙂🙂🙂',
      'mixed é € 🙂 text',
      'ticket missing, expired, or already redeemed',
    ];
    for (const sample of samples) {
      expect(utf8ByteLength(sample), sample).toBe(encoder.encode(sample).byteLength);
    }
  });
});
