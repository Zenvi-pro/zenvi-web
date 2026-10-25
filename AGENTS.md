# zenvi-web — agent doctrine

Rules for humans and coding agents working in this repo. Keep this file true.
Read `docs/ARCHITECTURE.md` before your first change.

## Stack

- Node 22+ (CI uses 22; local machines may run newer). npm workspaces.
- TypeScript 5.9, strict, ESM only. Vitest for tests. ESLint flat config.
- `apps/editor`: React 19, Vite 7, Tailwind CSS 4, Radix primitives, lucide icons.
- Internal packages export `src/index.ts` directly; no build step between packages.

## Package boundaries (enforced in review)

- `@zenvi/engine` is pure: no `window`, `document`, DOM types, `fs`, `path`,
  `process`, `Buffer`. If you need a platform capability, define an interface in
  the engine and implement it in `render-web`, `render-node`, `cli`, `cloud` or
  the editor.
- Only `@zenvi/engine` owns domain rules (keyframes, transforms, timeline math,
  edits, tool semantics). Other packages call it; they do not re-implement it.
  A second implementation of a domain rule is a bug.
- Every editing capability is a tool in `packages/engine/src/tools`. UI gestures
  call the same ops the tools call.

## Project data and history

- The project JSON is the desktop's (`.zvn`). Preserve unknown keys. Never drop
  fields you do not understand.
- Mutations go through `ProjectDocument` (`apply` / `transaction`). Do not
  mutate `project` objects in place outside the history layer.
- One user intent = one transaction = one undo step. Validate before opening a
  transaction. Failed, cancelled and no-op operations must not create undo steps.

## Tools

- Assistant-compatible tools keep the backend's exact names and argument names
  (`docs/specs/backend-frontend-tools.json`). Arguments arrive as strings from
  the backend agent; coerce them the way zenvi-core `tool_handlers.py` does.
- Results: failures start with `Error:`. Mutating tools return a structured
  receipt (`data`) listing created/changed ids.
- Tools never throw for user errors; they return an error result. They throw
  only for programmer errors.
- `packages/engine/src/tools/schemas.gen.ts` is generated from zenvi-core
  (`scripts/gen-tool-schemas.py`); never edit it by hand. Desktop tools and
  arguments not ported yet live in `packages/engine/src/tools/pending.ts`:
  port one, then delete its line.

## Tests

- Tests live next to code: `src/**/*.test.ts`. Run everything with `npm test`,
  one package with `npx vitest run --project engine`.
- Every bug fix adds a regression test when practical.
- Tests must be parallel-safe: unique temp dirs (`fs.mkdtemp`), no fixed ports,
  no shared files.
- Media fixtures are generated with ffmpeg at test time (`testsrc2`, `sine`),
  not committed, except tiny images under `fixtures/`.

## Style

- Small modules with one job. Explicit types on exported functions.
- No `any` in exported signatures. Prefer discriminated unions over flags.
- Comments explain why, not what. Cite libopenshot/zenvi-core sources
  (`libopenshot/src/KeyFrame.cpp:123`) when porting behavior.
- No speculative abstractions, no dead code, no TODO without an owner/issue.

## Security

- Never commit secrets. Local secrets live in `~/.config/zenvi-dev/*.env`.
- Cloud endpoints authenticate every request (Supabase JWT or Zenvi token) and
  authorize by owner. Signed URLs are short-lived and scoped to one blob.
- Treat MCP tool inputs and project JSON from the network as untrusted:
  validate with zod, bound sizes, never touch paths outside the project's
  sandbox on the server.

## Git

- Author: `Jashan Pratap Singh <88160290+jashanpratapsingh@users.noreply.github.com>`.
- Work on `jashan/<topic>` branches; PRs target `main` and follow
  `docs/PR_FORMAT.md`.
