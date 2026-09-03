# CLAUDE.md — Tessera

A multiplayer whiteboard with CRDT sync. Hand-written renderer, hand-written relay, no hosted
sync SDK and no canvas library.

**Where the truth lives, in precedence order:**

1. **[ARCHITECTURE.md](./ARCHITECTURE.md)** — binding. Module boundaries, the shape schema,
   the relay's layering, 10 enforced invariants. Constraints marked **[M]** were measured;
   they are not opinions and they are not re-litigated.
2. **[PHASES.md](./PHASES.md)** — the tracker. Phase status, exit criteria, the
   DEMO-COMPLETE gate, the decision log (D1/D2/D3), the cut list, and the known defects in
   the current commit. **Update it in the same commit as the work**, or the work is untracked.
3. This file — how to work in the repo.
4. Skill defaults — see the precedence rule below.

---

## Skills: mandatory

**Load the skill BEFORE writing, not after.** These skills govern structure, not just syntax.
Loading `code-quality` after the file is written means reviewing code that is already shaped
wrong, which costs a rewrite instead of a decision. If a task matches a trigger below, invoke
the skill in the same turn you start the work.

| Trigger | Skill | Why it is mandatory here |
|---|---|---|
| **ANY** `.ts` / `.tsx` file is written, edited, reviewed or created | **`code-quality`** | Every source file in this repo is TypeScript. This is the single most-triggered skill in the project and it governs file structure, error handling and testability — the things that are expensive to retrofit. |
| Anything under `apps/web/app/` or any App Router pattern (`page.tsx`, `layout.tsx`, `route.ts`, `'use client'`, `next/navigation`) | **`nextjs-app-router`** | The canvas host has a real SSR boundary: it mounts `dynamic(ssr: false)` and every `devicePixelRatio` / `window` / `matchMedia` read must be client-only or hydration breaks. |
| Any React component, page, layout, toolbar, panel, modal, or presence list | **`ui-ux-engineering`** | The stack is already Tailwind + shadcn/ui, which is what this skill assumes. It catches the missing-states and accessibility gaps that make a portfolio piece read as a prototype. |
| Any `Dockerfile`, `docker-compose.yml`, `.dockerignore`, or containerisation of the relay | **`docker`** | The relay is a separate deploy target with its own image (Phase 9–10). |
| Pushing to GitHub, writing or rewriting `README.md`, making the repo public, preparing the portfolio presentation | **`github-repo-seo`** | Phase 0 makes the repo public. This is also the moment defect **D-2** (the README overclaiming) must be fixed. |
| Authoring a `Workflow` script | **`workflow-authoring`** | Required before passing a script to the Workflow tool. |
| Publishing an Artifact of any kind, including a Markdown one | **`artifact-design`** | Non-negotiable per the tool contract. |

### Mandatory review skills

Run these rather than reviewing by eye. They are the cheapest quality step available.

| When | Skill |
|---|---|
| Before closing any phase in PHASES.md | **`code-review`** |
| After a phase lands, for reuse/simplification/altitude cleanups | **`simplify`** |
| Before Phase 10 closes, and before any commit touching `apps/relay/src/` | **`security-review`** |

---

## Skills: conditional

Load these only when the trigger actually fires. Each carries a project-specific caveat.

| Skill | When | Caveat |
|---|---|---|
| **`postgres-neon`** | Phase 9 — setting up Postgres, connections, migrations | **Consult for Neon setup and connection handling only.** This skill is Prisma-oriented, and ARCHITECTURE.md §10 deliberately rejects Prisma for raw `pg` (no expressive `ON CONFLICT … WHERE version`, so optimistic concurrency drops to `$executeRaw` anyway). Also: `pg` must stay pinned `>= 8.23.0` — older 8.x silently `JSON.stringify`s a `Uint8Array` into `bytea` and corrupts the document with no error. |
| **`dataviz`** | Any chart, graph or dashboard — including turning `docs/measurements.md` rows into figures | Read before the first line of chart code. |
| **`frontend-design`** | The landing page, or visual polish beyond component correctness | Pairs with `ui-ux-engineering`, does not replace it. |
| **`design-to-code`** | Only if given a screenshot, Figma export or mockup to implement | — |
| **`artifact-diagramming`** | Diagrams inside a published artifact | — |
| **`artifact-capabilities`** | An artifact needing live data, persistence, or shared state | Load **before** passing `capabilities`. |
| **`run`** | Asked to start the app, screenshot it, or confirm a change in the real app | Note: measurements must come from `next build && next start`, **never** `next dev` — StrictMode double-invokes effects and yields two rAF loops, invalidating any number. |
| **`skill-creator`** | Only if authoring or modifying a skill | — |

---

## Skills: present but NOT applicable to this project

Do not load these. Listed explicitly so the decision is already made and no turn is spent on it.

| Skill(s) | Why not |
|---|---|
| `python`, `fastapi` | No Python in this repo. |
| `spring-boot` | No Java. |
| `kubernetes` | The relay deploys as a single container (Fly / Railway / ACA). No manifests, and Redis/affinity/multi-instance are on the cut list. |
| `openai-agents-sdk`, `claude-api` | No LLM or agent code in the product. |
| `n8n-*` (7 skills) | No n8n workflows. |
| `claude-seo:*` (19 skills) | Not a marketing site. `github-repo-seo` covers repository discoverability, which is the only relevant slice. |
| `oss-contribute` | This is our own repo, not an upstream contribution. |
| `azure:*` | Listed by the runtime, but the `plugin:azure:azure` MCP server times out, so treat as unavailable. If Azure Container Apps is chosen for the relay, verify the server connects first. |

---

## Precedence when a skill and this project disagree

**ARCHITECTURE.md and PHASES.md win.** A skill encodes good general practice; this project has
constraints that were established by running code, and several of them are deliberately
unusual. Where they conflict, follow the project and say so in the commit message.

Known conflicts, already decided:

- **Prisma vs raw `pg`** — `postgres-neon` prefers Prisma; ARCHITECTURE.md §10 rejects it. Raw
  `pg` wins.
- **A canvas library** — any advice to reach for Konva, Fabric, react-konva or a tldraw SDK is
  refused by design. The hand-written renderer *is* the project. Enforced: `pnpm arch`.
- **`Y.Map` iteration** — no matter how natural it looks, nothing derives draw order from map
  iteration. Three byte-identical replicas iterate in three different orders (measured).
- **A `Date` in the document** — never. It converges at the byte level and diverges at the
  content level. `DocValue` makes it a compile error; lint bans `new Date()` in `core`/`crdt`.

---

## Non-negotiables for any code change

These are the invariants most easily broken by a well-intentioned edit. Full list in
ARCHITECTURE.md §11.

- **`packages/core` imports no `yjs`, no `react`, no `node:*`** — and no platform globals
  either (no DOM lib, `types: []`). This is what lets the property suite drive the real
  command vocabulary with no browser and no CRDT.
- **One resolved `yjs`.** It is a `peerDependency` of `@tessera/crdt` on purpose so a second
  copy is an install error, not a silent `Unexpected content type` days later.
- **Every write goes through `SceneStore.apply` with an explicit origin.** The only place a
  `Y` type is written is `packages/crdt/src/tx.ts`.
- **One gesture = one transaction = one undo step**, committed on pointerup, never per frame.
  At most one *hot* key per command.
- **Convergence is the normalised byte digest plus the content digest** — never state vectors,
  never `toJSON()`.

---

## Before you commit

```bash
pnpm verify   # typecheck → typecheck:pure → lint → arch → test
```

All five must pass. `pnpm arch` failing is an architecture violation, not a lint nit — read
the rule's `comment` field, which states the measured reason it exists.

Then: **update PHASES.md in the same commit.** Tick the tasks and only the exit criteria whose
verifier you actually ran. Fill `Actual` and `Unplanned` when a phase closes — those two
numbers are the only thing that makes the next estimate honest.

Commit messages carry the reasoning that is not visible in the diff: what was measured, what
was rejected and why, and what a test now prevents.

---

## Current state

Commit `e61aedf` · 77 tests · `pnpm verify` green · **four known defects (D-1…D-4) recorded in
PHASES.md**, including a red CI step and a README that overclaims. Phase 0 exists to fix them.
Check PHASES.md before starting anything.
