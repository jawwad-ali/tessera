import * as Y from 'yjs';

/**
 * The runtime half of invariant 2 (ARCHITECTURE.md §3, §11).
 *
 * `scripts/check-single-yjs.ts` walks the installed tree and catches version divergence
 * and duplicated physical installs. It cannot catch the case that actually bites, because
 * that one is not visible on disk: two module *instances* loaded from a single directory
 * through different export conditions. `yjs`'s exports map sends `import` to
 * `./src/yjs.js` and `require` to `./dist/yjs.cjs`, so a mixed graph — one package bundled
 * as CJS, another as ESM; a Next server component and a client component resolving
 * differently; a tsup bundle that inlines yjs while a peer imports it — produces two live
 * copies of the class table from one install.
 *
 * Measured consequence: `Ya.Doc !== Yb.Doc`, and
 * `docA.getMap('shapes').set('s1', new Yb.Map())` throws `Unexpected content type`.
 * Binary updates cross between the two copies perfectly, so sync looks completely healthy
 * until the first nested type — a `Y.Text` sticky note — at which point it fails in a way
 * that reads like a data-corruption bug rather than a packaging bug.
 *
 * Yjs does warn (`console.error('Yjs was already imported...')`) but that line is
 * invisible in a Next dev log or a container's stdout, which is precisely where it matters.
 * So we register our instance on a well-known global and fail loudly at startup instead.
 */

/**
 * `Symbol.for` is deliberate: it resolves through the cross-realm registry, so two module
 * instances in the same isolate see the *same* symbol and therefore find each other. A
 * plain `Symbol()` would be unique per instance and detect nothing.
 */
const REGISTRY_KEY = Symbol.for('tessera.crdt.yjs-instance');

interface Registration {
  /** Identity witness. Comparing a constructor is what actually breaks in the bad case. */
  readonly Doc: typeof Y.Doc;
  /** Printed in the failure so an operator can tell WHICH two builds collided. */
  readonly witness: string;
}

type RegistryHost = typeof globalThis & { [REGISTRY_KEY]?: Registration };

/**
 * Yjs does not export its own version, and reading `package.json` would need a
 * `node:`-flavoured import that ARCHITECTURE.md §3 forbids in this package.
 *
 * So the witness is the source text length of the `Doc` constructor. That sounds crude and
 * is exactly right for the job: the two builds that actually collide are the minified
 * `dist/yjs.cjs` and the unminified `src/yjs.js`, and their function text differs. A
 * witness that printed the same string for both — a `typeof` shape, say — would tell an
 * operator nothing at the moment they most need to know which half of the graph to fix.
 */
const witnessOf = (Doc: typeof Y.Doc): string => {
  // A minified build can leave the constructor anonymous, and a nameless witness in the
  // failure message is exactly as useless as no witness at all.
  const name = Doc.name === '' ? 'anonymous' : Doc.name;
  return `${name}#${String(Doc.toString().length)}`;
};

/**
 * Assert that this process holds exactly one live Yjs instance, and register ours.
 *
 * Call once, as early as possible: at relay boot, and at board-host mount in the browser.
 * It is idempotent and cheap — a symbol lookup and a reference comparison — so calling it
 * from several entry points is fine and is in fact the point.
 *
 * @throws if a different Yjs instance has already registered. This is not recoverable at
 *   runtime: the two class tables are already loaded, so failing at boot with an
 *   actionable message is strictly better than throwing `Unexpected content type` from
 *   inside a nested-type write days later.
 */
export const assertSingleYjsInstance = (): void => {
  const host = globalThis as RegistryHost;
  const existing = host[REGISTRY_KEY];

  if (existing === undefined) {
    Object.defineProperty(host, REGISTRY_KEY, {
      value: { Doc: Y.Doc, witness: witnessOf(Y.Doc) } satisfies Registration,
      writable: false,
      // Configurable so the test seam below can clear it. Locking it down would buy
      // tamper-resistance against code that already shares our realm — i.e. nothing —
      // at the cost of making the guard itself untestable.
      configurable: true,
      enumerable: false,
    });
    return;
  }

  if (existing.Doc !== Y.Doc) {
    throw new Error(
      'Tessera: two Yjs instances are loaded in this process.\n' +
        `  already registered: ${existing.witness}\n` +
        `  this module:        ${witnessOf(Y.Doc)}\n\n` +
        'Nested Y types cannot cross between them: setting a Y.Map created by one into a ' +
        'Y.Doc created by the other throws `Unexpected content type`. Binary updates DO ' +
        'cross, so sync will appear to work until the first nested type.\n\n' +
        'Usual causes: yjs added as a direct dependency of more than one workspace package ' +
        '(it is a peerDependency of @tessera/crdt precisely so this is an install error); a ' +
        'bundle that inlines yjs while something else imports it as a peer (see ' +
        "apps/relay/tsup.config.ts `noExternal`); or one half of the graph resolving the CJS " +
        'build and the other the ESM build.\n\n' +
        'Run `pnpm arch` and `node scripts/check-single-yjs.ts`.',
    );
  }
};

/**
 * Test seam. Clears the registration so a test can exercise both branches in one process.
 * Not exported from the package index — nothing in production has any business calling it.
 */
export const __resetYjsInstanceRegistryForTests = (): void => {
  // Reflect rather than `delete host[SYM]`: a computed delete is banned by lint because
  // it usually means an object is being used as a map, and this is the one case where a
  // symbol key is the point.
  Reflect.deleteProperty(globalThis, REGISTRY_KEY);
};

/**
 * Test seam. Registers a *foreign* Doc constructor, simulating the second instance that a
 * mixed ESM/CJS graph produces — which is otherwise unreproducible inside one test process,
 * since both halves of the import would resolve to the same module.
 *
 * Not exported from the package index.
 */
export const __registerForeignYjsForTests = (foreignDoc: typeof Y.Doc): void => {
  __resetYjsInstanceRegistryForTests();
  Object.defineProperty(globalThis, REGISTRY_KEY, {
    value: { Doc: foreignDoc, witness: witnessOf(foreignDoc) } satisfies Registration,
    writable: false,
    configurable: true,
    enumerable: false,
  });
};
