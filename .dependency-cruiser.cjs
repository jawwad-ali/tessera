/**
 * Architectural invariants, enforced.
 *
 * ARCHITECTURE.md §3 states one rule that carries the whole codebase: `packages/core`
 * imports no yjs, no react and no node. §11 lists ten invariants. The ones that are
 * expressible as a dependency graph live here and fail CI; the rest live in
 * `packages/core/src/invariants.ts` and fail the property suite.
 *
 * Every rule cites the reason. A rule without a reason gets deleted by the next person
 * who hits it at 1am, which is exactly when it is load-bearing.
 *
 * Run: `pnpm arch`
 */

/** Packages permitted to touch the Yjs family. Everything else goes through @tessera/crdt. */
const YJS_OWNERS = '^(packages/crdt|packages/harness|apps/relay)/';

/**
 * The Yjs family: the CRDT itself, its providers, and its wire protocols.
 *
 * Matches both the RESOLVED path (`node_modules/yjs/...`) and the BARE SPECIFIER
 * (`yjs`). The second half matters more than it looks: `packages/core` has no yjs
 * dependency, so an import there does not resolve at all — and without the bare-specifier
 * alternative the violation is reported as `not-to-unresolvable`, which fails CI with
 * entirely the wrong explanation. A rule whose message does not name the actual mistake
 * is a rule someone deletes at 1am.
 */
const YJS_FAMILY = '(^|node_modules/)(yjs|y-websocket|y-indexeddb|y-protocols|@y/[^/]+)(/|$)';

/** Same reasoning: match the bare specifier as well as the resolved path. */
const REACT_FAMILY = '(^|node_modules/)(react|react-dom|next)(/|$)';

/** react-dom and react only — `next` is legitimately absent from these rules' targets. */
const REACT_RUNTIME = '(^|node_modules/)(react|react-dom)(/|$)';

module.exports = {
  forbidden: [
    // ───────────────────────────────────────────────────────────────────────────
    // The load-bearing rule. §3.
    // ───────────────────────────────────────────────────────────────────────────
    {
      name: 'core-imports-no-yjs',
      severity: 'error',
      comment:
        'ARCHITECTURE.md §3. packages/core must run with zero yjs present. This is what ' +
        'lets MemoryStore and the fast-check property suite drive the real command ' +
        'vocabulary and the real invariants against N in-process replicas with no ' +
        'browser, no network and no CRDT — and it is what keeps the CRDT swappable, ' +
        'which is how single-player gets built first behind the same SceneStore seam.',
      from: { path: '^packages/core/' },
      to: { path: YJS_FAMILY },
    },
    {
      name: 'core-imports-no-react',
      severity: 'error',
      comment:
        'ARCHITECTURE.md §6. The renderer reads core\'s scene store, which is a plain Map. ' +
        'React owns the toolbar, panels and presence list and nothing else. The cost model ' +
        'is (commits/sec x work/commit) and shape count only enters the second term: one ' +
        'person dragging one shape at 120Hz is 120 commits/sec, which dies at five shapes. ' +
        'A react import inside core is the first step back toward that.',
      from: { path: '^packages/core/' },
      to: { path: REACT_FAMILY },
    },
    {
      name: 'core-imports-no-node',
      severity: 'error',
      comment:
        'ARCHITECTURE.md §3. core must be loadable in a browser main thread, in an ' +
        'OffscreenCanvas worker, and in a bare node test with no shims. A node: builtin ' +
        'breaks the worker renderer before it is written.',
      from: { path: '^packages/core/' },
      to: { dependencyTypes: ['core'] },
    },

    // ───────────────────────────────────────────────────────────────────────────
    // The wire package stays wire-only. §3, §9.
    // ───────────────────────────────────────────────────────────────────────────
    {
      name: 'protocol-stays-pure',
      severity: 'error',
      comment:
        'ARCHITECTURE.md §9. packages/protocol is message-type constants, frame reading and ' +
        'permission facets. It is imported by both the browser and the relay, and the gate ' +
        'must be able to read the two varUints WITHOUT instantiating a document — the whole ' +
        'point is that coarse authorisation costs no Y.Doc. lib0 for framing is the only ' +
        'dependency it may have.',
      from: { path: '^packages/protocol/' },
      to: {
        path: 'node_modules/',
        pathNot: '(^|node_modules/)lib0(/|$)',
      },
    },
    {
      name: 'protocol-imports-no-node',
      severity: 'error',
      comment:
        'ARCHITECTURE.md §9. The same frame-reading code runs in the browser provider and ' +
        'in the relay gate. One node: import and the browser half stops building.',
      from: { path: '^packages/protocol/' },
      to: { dependencyTypes: ['core'] },
    },

    // ───────────────────────────────────────────────────────────────────────────
    // One choke point for the CRDT. §3, §6.
    // ───────────────────────────────────────────────────────────────────────────
    {
      name: 'yjs-only-through-crdt',
      severity: 'error',
      comment:
        'ARCHITECTURE.md §3 and invariant 3. Every write goes through SceneStore.apply with ' +
        'an explicit origin, and the only place a Y type is touched is ' +
        'packages/crdt/src/tx.ts. Scattering yjs imports is how a gesture ends up committed ' +
        'per frame without an origin: 60,000 wire messages instead of 1,000, and an undo ' +
        'stack with 180 entries for one drag.',
      from: { path: '^(packages|apps)/', pathNot: YJS_OWNERS },
      to: { path: YJS_FAMILY },
    },
    {
      name: 'crdt-has-no-ui',
      severity: 'error',
      comment:
        'ARCHITECTURE.md §3. The CRDT binding runs identically in the browser, in the relay ' +
        'and in a headless test. A react import would make the relay depend on a UI ' +
        'framework and would make the binding untestable in node.',
      from: { path: '^packages/crdt/' },
      to: { path: REACT_FAMILY },
    },
    {
      name: 'crdt-imports-no-node',
      severity: 'error',
      comment:
        'ARCHITECTURE.md §3. The binding is shared by the browser and the relay, so it may ' +
        'not assume node. Persistence and sockets live in apps/relay.',
      from: { path: '^packages/crdt/' },
      to: { dependencyTypes: ['core'] },
    },

    // ───────────────────────────────────────────────────────────────────────────
    // App-layer separation. §3.
    // ───────────────────────────────────────────────────────────────────────────
    {
      name: 'react-only-in-web',
      severity: 'error',
      comment:
        'ARCHITECTURE.md §3. apps/web is the only package permitted to import react. If a ' +
        'shared package needs UI, the boundary is wrong.',
      from: { path: '^(packages/|apps/relay/)' },
      to: { path: REACT_RUNTIME },
    },
    {
      name: 'relay-has-no-ui',
      severity: 'error',
      comment: 'ARCHITECTURE.md §3. The relay is transport, gate, room and persistence. Nothing else.',
      from: { path: '^apps/relay/' },
      to: { path: '(^|node_modules/)(react|react-dom|next|tailwindcss)(/|$)' },
    },
    {
      name: 'apps-do-not-import-each-other',
      severity: 'error',
      comment:
        'ARCHITECTURE.md §3. web and relay are separate deploy targets — Vercel cannot hold ' +
        'a WebSocket upgrade, so they are two artefacts. Anything they genuinely share is a ' +
        'package, and making that explicit is what keeps the shared surface small enough to ' +
        'reason about.',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/([^/]+)/', pathNot: '^apps/$1/' },
    },
    {
      name: 'harness-is-dev-only',
      severity: 'error',
      comment:
        'ARCHITECTURE.md §3. The property suite, load client and measurement harness must ' +
        'never end up in a shipped bundle. It depends on everything; nothing depends on it.',
      from: { pathNot: '^(packages/harness|.*\\.(test|spec|bench)\\.ts)' },
      to: { path: '^packages/harness/' },
    },

    // ───────────────────────────────────────────────────────────────────────────
    // Graph hygiene.
    // ───────────────────────────────────────────────────────────────────────────
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A cycle means the layering in §3 has been violated somewhere, and it also breaks ' +
        'the chunked cold-load hydration in §7, which walks the scene in a defined order.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment:
        'An unreachable module is either dead or the graph is lying. Either way somebody ' +
        'should look.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.json$',
          '(^|/)(package|package-lock)\\.json$',
          '(^|/)(eslint|vitest|next|tsup|playwright|postcss)\\.config\\.(js|ts|mjs|cjs)$',
          // App Router convention files are entry points: the framework imports them by path,
          // so nothing in the graph does. `page`, `layout`, `loading`, `error`, `route`.
          '^apps/web/app/.*\\.tsx?$',
          // Playwright discovers specs by glob, the same way.
          '\\.spec\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'An import that does not resolve is a build that works only on the machine that wrote it.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-duplicate-dep-types',
      severity: 'warn',
      comment:
        'A package listed as both a dependency and a devDependency resolves differently in ' +
        'CI than locally. yjs in particular is a peer of @tessera/crdt on purpose ' +
        '(invariant 2) — a stray direct dependency is how a second copy gets into the tree.',
      from: {},
      to: { moreThanOneDependencyType: true, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'no-dev-dep-in-src',
      severity: 'error',
      comment:
        'Shipping code must not reach into a devDependency. The relay in particular is ' +
        'bundled by tsup, so a devDependency import is either a broken production bundle or ' +
        'a dev tool shipped to users.',
      from: { path: '^(packages|apps)/[^/]+/src/', pathNot: '\\.(test|spec|bench)\\.ts$' },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|dist|\\.next|coverage|bench-out)/' },

    // Resolve through the workspace tsconfig `paths`, and see type-only imports too —
    // without this, a `import type { Shape } from 'yjs'` inside core would slip past the
    // purity rules.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
      mainFields: ['module', 'main', 'types'],
    },

    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)' },
      archi: { collapsePattern: '^(packages|apps)/[^/]+' },
    },
  },
};
