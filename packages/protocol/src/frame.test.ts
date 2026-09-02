import * as encoding from 'lib0/encoding';
import { describe as group, expect, it } from 'vitest';

import { CloseCode, isPermanent } from './close-codes.ts';
import { NO_ACCESS, Role, facetsFor } from './facets.ts';
import { adjudicate, describe as label, peek, type Verdict } from './frame.ts';
import { OuterMessage, SyncMessage } from './messages.ts';

/** Build a frame the way y-websocket does: outer varUint, then the payload. */
function frame(outer: number, ...rest: readonly number[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, outer);
  for (const value of rest) encoding.writeVarUint(encoder, value);
  return encoding.toUint8Array(encoder);
}

const viewer = facetsFor(Role.Viewer);
const editor = facetsFor(Role.Editor);

group('peek - classification', () => {
  it('classifies the three sync steps', () => {
    expect(peek(frame(OuterMessage.Sync, SyncMessage.Step1))).toEqual({
      kind: 'sync',
      step: SyncMessage.Step1,
    });
    expect(peek(frame(OuterMessage.Sync, SyncMessage.Step2))).toEqual({
      kind: 'sync',
      step: SyncMessage.Step2,
    });
    expect(peek(frame(OuterMessage.Sync, SyncMessage.Update))).toEqual({
      kind: 'sync',
      step: SyncMessage.Update,
    });
  });

  it('classifies the non-sync envelopes', () => {
    expect(peek(frame(OuterMessage.Awareness))).toEqual({ kind: 'awareness' });
    expect(peek(frame(OuterMessage.QueryAwareness))).toEqual({ kind: 'query-awareness' });
    expect(peek(frame(OuterMessage.Auth, 0))).toEqual({ kind: 'auth', inner: 0 });
  });

  it('does not consume the bytes the caller still owns', () => {
    // The property the whole design rests on: the gate runs first, and the real handler
    // must still receive an untouched message. `readVarUint` advances a decoder, so sharing
    // one would hand the handler a frame with its type already eaten.
    const message = frame(OuterMessage.Sync, SyncMessage.Update);
    const before = Uint8Array.from(message);
    peek(message);
    peek(message);
    expect(Array.from(message)).toEqual(Array.from(before));
  });

  it('treats an unknown outer type as forward-compatible, not an error', () => {
    expect(peek(frame(99))).toEqual({ kind: 'unknown-outer', outer: 99 });
  });

  it('treats an unknown inner sync type as a violation', () => {
    // Inside a Sync envelope the vocabulary is closed, so this is a protocol error rather
    // than a newer dialect.
    expect(peek(frame(OuterMessage.Sync, 7))).toEqual({ kind: 'unknown-sync', inner: 7 });
  });

  it('never throws on malformed input', () => {
    const cases: readonly Uint8Array[] = [
      new Uint8Array(0),
      // A Sync envelope with no inner type at all.
      frame(OuterMessage.Sync),
      // A truncated multi-byte varUint: continuation bit set, no continuation byte.
      new Uint8Array([0x80]),
      new Uint8Array([0xff, 0xff]),
      // Sync envelope followed by a truncated inner varUint.
      new Uint8Array([0x00, 0x80]),
    ];
    for (const bytes of cases) {
      const result = peek(bytes);
      expect(result.kind, `bytes=[${Array.from(bytes).join(',')}]`).toBe('malformed');
    }
  });

  it('accepts a sync frame with an empty payload', () => {
    // An update carrying no structs is a legal no-op, not an error.
    expect(peek(frame(OuterMessage.Sync, SyncMessage.Update)).kind).toBe('sync');
  });
});

group('adjudicate - a viewer', () => {
  it('may read: Step1 is allowed', () => {
    expect(adjudicate(peek(frame(OuterMessage.Sync, SyncMessage.Step1)), viewer)).toEqual({
      action: 'allow',
    });
  });

  it('is DENIED, not silently dropped, for a document write', () => {
    // The load-bearing assertion of this package. Dropping the frame would not undo the
    // edit the client already applied - it would fork it permanently, persist the fork via
    // y-indexeddb, and leave nothing to heal it because resyncInterval defaults to -1.
    for (const step of [SyncMessage.Step2, SyncMessage.Update] as const) {
      const verdict: Verdict = adjudicate(peek(frame(OuterMessage.Sync, step)), viewer);
      expect(verdict.action).toBe('deny');
      if (verdict.action !== 'deny') throw new Error('unreachable');
      expect(verdict.code).toBe(CloseCode.PermissionDenied);
      // And the close must actually stop the reconnect loop, or the denied client returns
      // every ~2.5s forever with no jitter.
      expect(isPermanent(verdict.code)).toBe(true);
    }
  });

  it('may still broadcast presence', () => {
    // Deliberate: a viewer whose cursor nobody can see reads as a broken app rather than a
    // permission decision.
    expect(adjudicate(peek(frame(OuterMessage.Awareness)), viewer)).toEqual({ action: 'allow' });
  });
});

group('adjudicate - an editor', () => {
  it('may write the document and broadcast presence', () => {
    for (const step of [SyncMessage.Step1, SyncMessage.Step2, SyncMessage.Update] as const) {
      expect(adjudicate(peek(frame(OuterMessage.Sync, step)), editor)).toEqual({ action: 'allow' });
    }
    expect(adjudicate(peek(frame(OuterMessage.Awareness)), editor)).toEqual({ action: 'allow' });
  });

  it('is denied for an auth frame, which is server-to-client only', () => {
    const verdict = adjudicate(peek(frame(OuterMessage.Auth, 0)), editor);
    expect(verdict).toMatchObject({ action: 'deny', code: CloseCode.ProtocolError });
  });
});

group('adjudicate - fail-closed defaults', () => {
  it('NO_ACCESS denies reads and writes, and drops presence', () => {
    // The facets a socket holds between upgrade and ticket redemption. A gap in the
    // handshake must fail closed.
    expect(adjudicate(peek(frame(OuterMessage.Sync, SyncMessage.Step1)), NO_ACCESS)).toMatchObject({
      action: 'deny',
    });
    expect(
      adjudicate(peek(frame(OuterMessage.Sync, SyncMessage.Update)), NO_ACCESS),
    ).toMatchObject({ action: 'deny' });
    expect(adjudicate(peek(frame(OuterMessage.Awareness)), NO_ACCESS)).toMatchObject({
      action: 'drop',
    });
  });

  it('drops rather than denies for ephemeral traffic', () => {
    // Presence is self-superseding, so shedding it costs nothing. Closing a socket over a
    // cursor would be absurd - and would take the document channel down with it.
    const verdict = adjudicate(peek(frame(OuterMessage.QueryAwareness)), NO_ACCESS);
    expect(verdict.action).toBe('drop');
  });
});

group('metrics labels stay low-cardinality', () => {
  it('does not interpolate attacker-controlled values', () => {
    // An unbounded Prometheus label set is a memory leak a hostile client controls, so the
    // vocabulary is pinned rather than merely bounded: a new label has to be added here
    // deliberately, which is the moment to ask whether it is attacker-influenced.
    const ALLOWED = new Set([
      'sync.step1',
      'sync.step2',
      'sync.update',
      'awareness',
      'query-awareness',
      'auth',
      'unknown-outer',
      'unknown-sync',
      'malformed',
    ]);

    const seen = new Set<string>();
    for (let outer = 0; outer < 300; outer++) seen.add(label(peek(frame(outer))));
    for (let inner = 0; inner < 300; inner++) {
      seen.add(label(peek(frame(OuterMessage.Sync, inner))));
    }
    seen.add(label(peek(new Uint8Array(0))));
    seen.add(label(peek(new Uint8Array([0x80]))));

    // 600+ distinct inputs, none of which can mint a label.
    expect([...seen].filter((value) => !ALLOWED.has(value))).toEqual([]);
  });
});
