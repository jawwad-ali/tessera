// @ts-check
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

/**
 * Lint rules that encode Tessera's measured hazards.
 *
 * The generic rules are here because they are good; the `no-restricted-*` rules are here
 * because each one corresponds to a specific, measured way this class of app breaks, and a
 * comment in a review does not survive contact with a deadline. ARCHITECTURE.md §11 lists
 * the invariants; the graph-shaped ones live in .dependency-cruiser.cjs, the
 * semantic-but-static ones live here, and the behavioural ones live in the property suite.
 */
export default defineConfig(
  { ignores: ['**/dist/**', '**/.next/**', '**/coverage/**', '**/bench-out/**', '**/node_modules/**'] },

  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // The two tooling files that cannot be in the typechecked graph: this config
          // itself, and the dependency-cruiser config, which must stay CommonJS.
          // Everything else — including scripts/ — is real TypeScript and is typechecked;
          // `node` runs those directly via native type-stripping.
          allowDefaultProject: ['eslint.config.js', '.dependency-cruiser.cjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The Command union is the entire write API (ARCHITECTURE.md §5). A non-exhaustive
      // switch over it is a silently-ignored mutation, which in a CRDT means a replica that
      // diverges without erroring.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true },
      ],

      // y-indexeddb's own `_storeUpdate` drops its write promise with no `.catch`, so a
      // QuotaExceededError silently stops persistence while the sync indicator still reads
      // "synced". We are not repeating that in our own code.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
      '@typescript-eslint/no-misused-promises': 'error',

      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-param-reassign': ['error', { props: false }],
      'prefer-const': 'error',
      'object-shorthand': 'error',
    },
  },

  // ───────────────────────────────────────────────────────────────────────────────
  // packages/core — pure, deterministic, replayable.
  // ───────────────────────────────────────────────────────────────────────────────
  {
    files: ['packages/core/src/**/*.ts', 'packages/crdt/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message:
            'Never put a Date in the document. Measured: `s.set("createdAt", new Date(0))` is a ' +
            'real Date on the writing replica and arrives at every other replica as `{}` — ' +
            'instanceof Date === false, JSON.stringify === "{}". Type-identical in TypeScript, ' +
            'divergent at runtime, no error anywhere. Store epoch millis (number).',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            'Take the clock as an argument. Every write must be replayable by the property ' +
            'suite from a seed (ARCHITECTURE.md §13), and a hidden Date.now() makes a failing ' +
            'seed irreproducible. Inject a `now: () => number`.',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message:
            'Take randomness as an argument. Shape ids and the jitter on the fractional index ' +
            'both need entropy, and both must be seedable or the convergence suite cannot ' +
            'shrink a failure to a minimal repro. Inject a `rng: () => number`.',
        },
      ],
    },
  },

  // Structured logging only in shipped packages. Yjs prints
  // `console.error('Yjs was already imported...')` on the two-copy bug (invariant 2) and it
  // is trivially lost in a Next dev log or a container's stdout — so our own signal has to
  // go somewhere that is actually watched.
  {
    files: ['packages/*/src/**/*.ts', 'apps/web/**/*.{ts,tsx}'],
    rules: { 'no-console': ['error', { allow: ['warn', 'error'] }] },
  },

  // ───────────────────────────────────────────────────────────────────────────────
  // Relay: node-shaped, and the one place a raw socket write is legitimate.
  // ───────────────────────────────────────────────────────────────────────────────
  {
    files: ['apps/relay/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='close'][arguments.0.value>=1000][arguments.0.value<1100]",
          message:
            'Use packages/protocol close-codes. A denial must close in the 4400-4499 range: ' +
            'y-websocket 3.1.0 treats that range as permanent via defaultShouldReconnect and ' +
            'stops the reconnect loop by itself. A 1008 leaves the client reconnecting every ' +
            '~2.5s forever, with no jitter.',
        },
      ],
    },
  },

  // Tests and benchmarks: the rules above exist to protect production paths, and a property
  // suite legitimately needs a seeded PRNG, wall-clock timing and console output.
  {
    files: ['**/*.{test,spec,bench}.ts', 'packages/harness/**/*.ts', '**/*.config.{ts,js}'],
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
);
