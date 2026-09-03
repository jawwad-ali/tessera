import { describe as group, expect, it } from 'vitest';

import { CloseCode, isPermanent } from './close-codes.ts';
import { resolveEpoch } from './handshake.ts';

/**
 * The returning client.
 *
 * A board can be rebuilt into a fresh `Y.Doc` — that is the only operation that resets struct
 * count and client-id cardinality — and a rebuild gives every shape new struct ids. A client
 * holding a cache from before the rebuild has state that no longer relates to the document:
 * merging it would resurrect deleted shapes and duplicate array entries, and both replicas
 * would converge on it, so nothing would look broken.
 *
 * These tests describe what that client experiences, not how the check is implemented.
 */
group('a returning client is admitted or refused by epoch', () => {
  it('is admitted when its cache matches the room', () => {
    expect(resolveEpoch({ clientEpoch: 3, roomEpoch: 3 })).toEqual({ action: 'accept' });
  });

  it('is refused when its cache predates a rebuild', () => {
    const verdict = resolveEpoch({ clientEpoch: 2, roomEpoch: 3 });

    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') throw new Error('unreachable');
    expect(verdict.code).toBe(CloseCode.EpochStale);
  });

  it('stops retrying rather than hammering the relay forever', () => {
    // The client only clears its cache and reloads if the close is *permanent*. On a
    // non-permanent code the provider retries with min(2^n * 100, 2500)ms and no jitter, so
    // a refused client would return every ~2.5s indefinitely and never recover.
    const verdict = resolveEpoch({ clientEpoch: 1, roomEpoch: 9 });

    if (verdict.action !== 'deny') throw new Error('expected a denial');
    expect(isPermanent(verdict.code)).toBe(true);
  });

  it('is refused when it somehow holds a NEWER epoch than the room', () => {
    // Real scenario: the relay was restored from a backup taken before the last rebuild.
    // The client's cache is not merely stale, it is from a future the server no longer has.
    // Admitting it would merge state the room cannot reconcile.
    const verdict = resolveEpoch({ clientEpoch: 4, roomEpoch: 3 });

    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') throw new Error('unreachable');
    expect(verdict.code).toBe(CloseCode.EpochStale);
  });

  it('tells the client what to do, within a close frame’s limit', () => {
    // The reason travels in a close frame, capped at 123 bytes of UTF-8 by RFC 6455. An
    // over-long reason makes the close frame itself invalid, so the client learns nothing.
    const verdict = resolveEpoch({ clientEpoch: 2, roomEpoch: 3 });

    if (verdict.action !== 'deny') throw new Error('expected a denial');
    expect(verdict.reason).toMatch(/epoch/i);
    expect(new TextEncoder().encode(verdict.reason).byteLength).toBeLessThanOrEqual(123);
  });
});
