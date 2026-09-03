import * as Y from 'yjs';

import { assertSingleYjsInstance } from '@tessera/crdt';

/**
 * Invariant 2, checked from a **third resolution point**.
 *
 * `scripts/check-single-yjs.ts` walks the installed tree, and
 * `assertSingleYjsInstance()` guards one module graph from inside `@tessera/crdt`. Neither
 * covers the case this file exists for: `packages/harness` declares `yjs` as its own peer
 * dependency, so it resolves the module independently of `crdt` and of `relay`. If pnpm,
 * a bundler, or a future `noExternal` entry ever hands those two packages different copies,
 * this is where it surfaces — and it surfaces as a failing test rather than as
 * `Unexpected content type` from inside a nested-type write days later.
 *
 * That matters most here specifically: the convergence suite drives N replicas through this
 * package, so a second copy resolved at this boundary would corrupt every replica the suite
 * builds while leaving binary updates working perfectly.
 */

/** Well-known registry key populated by `assertSingleYjsInstance()`. */
const REGISTRY_KEY = Symbol.for('tessera.crdt.yjs-instance');

interface RegisteredInstance {
  readonly Doc: typeof Y.Doc;
  readonly witness: string;
}

type RegistryHost = typeof globalThis & { [REGISTRY_KEY]?: RegisteredInstance };

export interface ResolutionReport {
  /**
   * Does the `Y.Doc` this package resolved refer to the same constructor `@tessera/crdt`
   * registered? A constructor comparison is the thing that actually breaks — two copies
   * fail this while every byte-level operation still succeeds.
   */
  readonly sameConstructor: boolean;
  /** The constructor's source-text witness, for the failure message. */
  readonly witness: string;
  /** Did a nested `Y.Text` inside a `Y.Map` inside a `Y.Doc` survive a wire round trip? */
  readonly nestedTypeSurvivesRoundTrip: boolean;
}

const witnessOf = (Doc: typeof Y.Doc): string => {
  const name = Doc.name === '' ? 'anonymous' : Doc.name;
  return `${name}#${String(Doc.toString().length)}`;
};

/**
 * Build a nested document from **this** package's `Y` import and round-trip it through the
 * wire format.
 *
 * The round trip is the point rather than decoration: with two copies in the tree, binary
 * updates cross perfectly while nested types throw, so a test that only checked `applyUpdate`
 * would pass on a broken install. This exercises both halves.
 */
const nestedTypeSurvivesRoundTrip = (): boolean => {
  const source = new Y.Doc();
  const shapes = source.getMap<Y.Map<unknown>>('shapes');
  const shape = new Y.Map<unknown>();

  shapes.set('s1', shape);
  shape.set('text', new Y.Text('hello'));

  const replica = new Y.Doc();
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(source));

  const readBack = replica.getMap<Y.Map<unknown>>('shapes').get('s1');
  if (!(readBack instanceof Y.Map)) return false;

  const text = readBack.get('text');
  return text instanceof Y.Text && text.toJSON() === 'hello';
};

/**
 * Check that this package and `@tessera/crdt` share one Yjs instance.
 *
 * Registers via `assertSingleYjsInstance()` first — which throws on its own if the graph is
 * already split — then compares the registered constructor against the one resolved here.
 * Never throws: the report is the result, so a caller decides how loudly to fail.
 */
export const checkYjsResolution = (): ResolutionReport => {
  assertSingleYjsInstance();

  const registered = (globalThis as RegistryHost)[REGISTRY_KEY];

  return {
    sameConstructor: registered?.Doc === Y.Doc,
    witness: witnessOf(Y.Doc),
    nestedTypeSurvivesRoundTrip: nestedTypeSurvivesRoundTrip(),
  };
};
