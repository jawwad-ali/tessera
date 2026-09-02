import * as Y from 'yjs';
import { describe, expect, it, afterEach } from 'vitest';
import {
  assertSingleYjsInstance,
  __registerForeignYjsForTests,
  __resetYjsInstanceRegistryForTests,
} from './yjs-instance.ts';

afterEach(() => {
  __resetYjsInstanceRegistryForTests();
});

describe('invariant 2 — exactly one Yjs instance', () => {
  it('registers on first call and is idempotent', () => {
    expect(() => {
      assertSingleYjsInstance();
    }).not.toThrow();
    // Called from several entry points on purpose (relay boot, board-host mount).
    expect(() => {
      assertSingleYjsInstance();
      assertSingleYjsInstance();
    }).not.toThrow();
  });

  it('throws, actionably, when a second instance is present', () => {
    // A subclass stands in for the second copy: a distinct constructor is precisely what a
    // mixed ESM/CJS graph produces, and it is otherwise unreproducible in one process
    // because both halves of the import resolve to the same module.
    //
    // Named `Doc` deliberately — in the real failure BOTH constructors are called `Doc`
    // (one from dist/yjs.cjs, one from src/yjs.js), so the message has to stay legible when
    // the names collide and only the bodies differ.
    class Doc extends Y.Doc {}
    __registerForeignYjsForTests(Doc);

    expect(() => {
      assertSingleYjsInstance();
    }).toThrow(/two Yjs instances/);

    let message = '';
    try {
      assertSingleYjsInstance();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    // The failure has to name the cause and the next command, because it fires at boot in
    // a container log where nobody has the architecture doc open.
    expect(message).toContain('Unexpected content type');
    expect(message).toContain('peerDependency');
    expect(message).toContain('pnpm arch');
    // And it must distinguish the two builds, or an operator cannot tell which half to fix.
    const witnesses = message.match(/Doc#\d+/g) ?? [];
    expect(witnesses).toHaveLength(2);
    expect(witnesses[0]).not.toBe(witnesses[1]);
  });

  it('the installed copy actually supports nested types', () => {
    // The behaviour the invariant exists to protect. With two copies in the tree this
    // throws `Unexpected content type` while binary updates keep working — so assert the
    // thing that breaks, not just the count of copies on disk.
    const doc = new Y.Doc();
    const shapes = doc.getMap<Y.Map<unknown>>('shapes');
    const shape = new Y.Map<unknown>();

    expect(() => {
      shapes.set('s1', shape);
      shape.set('text', new Y.Text('hello'));
    }).not.toThrow();

    const readBack = shapes.get('s1');
    expect(readBack).toBeInstanceOf(Y.Map);
    const text = readBack?.get('text');
    // `toJSON()` rather than `toString()`: typed as string, so this needs no cast and
    // stays honest about what a Y.Text actually is.
    expect(text instanceof Y.Text ? text.toJSON() : null).toBe('hello');

    // And it survives a round trip through the wire format, which is the other half of the
    // two-copy failure mode: updates cross even when nested types cannot.
    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
    expect(replica.getMap<Y.Map<unknown>>('shapes').get('s1')).toBeInstanceOf(Y.Map);
  });
});
