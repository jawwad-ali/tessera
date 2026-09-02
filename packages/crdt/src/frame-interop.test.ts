import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { OuterMessage, SyncMessage, adjudicate, facetsFor, peek, Role } from '@tessera/protocol';
import { describe as group, expect, it } from 'vitest';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

/**
 * Interoperability tests for the permission gate.
 *
 * `packages/protocol` transcribes the wire vocabulary by hand, because the gate must
 * classify a frame without importing yjs (ARCHITECTURE.md §9) and `y-protocols/sync` pulls
 * yjs in transitively. Transcription is a liability: a constant that drifts, or a frame
 * shape I assumed rather than checked, produces a gate that looks correct and admits the
 * wrong traffic.
 *
 * So these tests live here, in the one package permitted to touch a Y type, and they build
 * frames with the REAL `y-protocols` writers against a REAL document. This is the test that
 * would catch the transcription being wrong.
 */

/** Wrap a payload the way y-websocket does: outer envelope varUint, then the payload. */
function envelope(outer: number, writePayload: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, outer);
  writePayload(encoder);
  return encoding.toUint8Array(encoder);
}

function seededDoc(): Y.Doc {
  const doc = new Y.Doc();
  const shapes = doc.getMap<Y.Map<unknown>>('shapes');
  doc.transact(() => {
    const shape = new Y.Map<unknown>();
    shapes.set('s1', shape);
    shape.set('t', { x: 10, y: 20, w: 80, h: 60, rot: 0 });
  }, 'test');
  return doc;
}

group('the gate classifies frames the real provider emits', () => {
  it('recognises a genuine SyncStep1', () => {
    const doc = seededDoc();
    const frame = envelope(OuterMessage.Sync, (encoder) => {
      syncProtocol.writeSyncStep1(encoder, doc);
    });
    expect(peek(frame)).toEqual({ kind: 'sync', step: SyncMessage.Step1 });
  });

  it('recognises a genuine SyncStep2', () => {
    const doc = seededDoc();
    const remote = new Y.Doc();
    const frame = envelope(OuterMessage.Sync, (encoder) => {
      // Step2 as the provider actually writes it: the diff against a peer's state vector.
      syncProtocol.writeSyncStep2(encoder, doc, Y.encodeStateVector(remote));
    });
    expect(peek(frame)).toEqual({ kind: 'sync', step: SyncMessage.Step2 });
  });

  it('recognises a genuine incremental Update', () => {
    const doc = seededDoc();
    let captured: Uint8Array | undefined;
    doc.on('update', (update: Uint8Array) => {
      captured = update;
    });
    doc.getMap<Y.Map<unknown>>('shapes').get('s1')?.set('t', { x: 11, y: 20, w: 80, h: 60, rot: 0 });

    // Copy to a const so the narrowing survives into the closure below — a cast or a `!`
    // would work too, and both would be lying about a value that genuinely might be absent.
    const update = captured;
    if (update === undefined) throw new Error('the document emitted no update');

    const frame = envelope(OuterMessage.Sync, (encoder) => {
      syncProtocol.writeUpdate(encoder, update);
    });
    expect(peek(frame)).toEqual({ kind: 'sync', step: SyncMessage.Update });
  });

  it('recognises a genuine awareness update', () => {
    const doc = seededDoc();
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalStateField('c', [1235, 678]);

    const frame = envelope(OuterMessage.Awareness, (encoder) => {
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]),
      );
    });
    expect(peek(frame)).toEqual({ kind: 'awareness' });
    awareness.destroy();
  });

  it('an empty update is still a well-formed Update frame', () => {
    // Two synced peers exchange exactly this, and treating it as malformed would deny a
    // perfectly healthy client.
    const doc = seededDoc();
    const emptyDiff = Y.encodeStateAsUpdate(doc, Y.encodeStateAsUpdate(doc));
    const frame = envelope(OuterMessage.Sync, (encoder) => {
      syncProtocol.writeUpdate(encoder, emptyDiff);
    });
    expect(peek(frame)).toEqual({ kind: 'sync', step: SyncMessage.Update });
  });
});

group('the gate composes with the real reader', () => {
  it('leaves the frame fully consumable by readSyncMessage after peeking', () => {
    // The property the gate's whole design rests on, verified end to end against the real
    // reader rather than against my own assertion about decoder positions. If `peek` shared
    // a decoder with the handler, the handler would see a message with its type already
    // eaten and would silently mis-parse it.
    const author = seededDoc();
    const server = new Y.Doc();

    const frame = envelope(OuterMessage.Sync, (encoder) => {
      syncProtocol.writeSyncStep2(encoder, author, Y.encodeStateVector(server));
    });

    // Gate first, exactly as the relay does.
    const classified = peek(frame);
    expect(classified).toEqual({ kind: 'sync', step: SyncMessage.Step2 });
    expect(adjudicate(classified, facetsFor(Role.Editor))).toEqual({ action: 'allow' });

    // Then the real handler, on the ORIGINAL bytes with a fresh decoder.
    const decoder = decoding.createDecoder(frame);
    const reply = encoding.createEncoder();
    expect(decoding.readVarUint(decoder)).toBe(OuterMessage.Sync); // strip the envelope
    syncProtocol.readSyncMessage(decoder, reply, server, 'relay', (error) => {
      throw error;
    });

    // And the document actually arrived, which is the only proof that matters.
    const shape = server.getMap<Y.Map<unknown>>('shapes').get('s1');
    expect(shape).toBeInstanceOf(Y.Map);
    expect(shape?.get('t')).toEqual({ x: 10, y: 20, w: 80, h: 60, rot: 0 });
  });

  it('denies a viewer the same frame an editor is allowed', () => {
    const author = seededDoc();
    const frame = envelope(OuterMessage.Sync, (encoder) => {
      syncProtocol.writeSyncStep2(encoder, author, Y.encodeStateVector(new Y.Doc()));
    });
    const classified = peek(frame);

    expect(adjudicate(classified, facetsFor(Role.Editor))).toEqual({ action: 'allow' });
    expect(adjudicate(classified, facetsFor(Role.Viewer))).toMatchObject({ action: 'deny' });
  });

  it('lets a viewer send Step1, because that is a read', () => {
    // A read-only client must be able to ask for state, or it can never render the board it
    // is allowed to see.
    const frame = envelope(OuterMessage.Sync, (encoder) => {
      syncProtocol.writeSyncStep1(encoder, new Y.Doc());
    });
    expect(adjudicate(peek(frame), facetsFor(Role.Viewer))).toEqual({ action: 'allow' });
  });
});

group('transcribed constants match y-protocols', () => {
  it('agrees with the installed sync protocol', () => {
    // The constants are duplicated in packages/protocol on purpose (it must not import
    // yjs). This is the test that stops the duplicate from drifting.
    expect(SyncMessage.Step1).toBe(syncProtocol.messageYjsSyncStep1);
    expect(SyncMessage.Step2).toBe(syncProtocol.messageYjsSyncStep2);
    expect(SyncMessage.Update).toBe(syncProtocol.messageYjsUpdate);
  });

  it('agrees with the awareness protocol timings the relay depends on', async () => {
    const { ProviderDefaults } = await import('@tessera/protocol');
    expect(ProviderDefaults.awarenessOutdatedMs).toBe(awarenessProtocol.outdatedTimeout);
    // Half the outdated timeout is the re-announce interval, and it is why the relay must
    // keep a client's own awareness echo in the fan-out: that echo is what feeds the
    // provider's 30s inbound-message liveness timer.
    expect(ProviderDefaults.awarenessReannounceMs).toBe(awarenessProtocol.outdatedTimeout / 2);
    expect(ProviderDefaults.reconnectTimeoutMs).toBeGreaterThan(
      ProviderDefaults.awarenessReannounceMs,
    );
  });
});
