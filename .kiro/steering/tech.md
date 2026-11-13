# CloudVerse: Tech Stack and Commands

## Stack

- TypeScript (strict, ESM) in a pnpm workspace monorepo.
- Vite for apps. Vitest (node + jsdom projects) and fast-check for tests; Playwright
  for browser tests (added with the renderer). ESLint flat config.
- three.js with react-three-fiber/drei (introduced in Tasks 5 and 6), graphology for
  graph algorithms, zod for schemas.
- Dev tooling in `tools/*.ts` runs directly on Node (native type stripping), so it
  uses `erasableSyntaxOnly` TypeScript: no enums, namespaces, or parameter properties.
- Pytest is not used.

## Pinned toolchain (verified in Task 1)

| Tool | Version | Note |
| --- | --- | --- |
| Node.js | ^24.15 or >= 26 | developed on 26.13.1; `.nvmrc` says 26 and CI reads it |
| npm | 11.20.0 | |
| pnpm | 10.34.9 | pinned in `packageManager`; activated through Corepack |
| TypeScript | 6.0.3 | typescript-eslint 8.72.2 supports TypeScript < 6.1, so do not move to 7 yet |
| jsdom | 31.0.0 | needs Node ^24.15 or >= 26 (the `engines` range reflects this) |
| @types/node | 26.6.6 | matches the development runtime |
| Terraform | 1.16.0 (dev only) | AWS provider pinned to exactly 6.73.0 |

pnpm 12 does not activate through Corepack 0.34 (its package layout changed), so the
project pins pnpm 10. Dependencies are pinned to exact versions (`save-exact`).

## Commands

If `pnpm` is not on PATH, prefix with `corepack` (e.g. `corepack pnpm run test`).
Set `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` in non-interactive shells.

| Command | Purpose |
| --- | --- |
| `pnpm install` | install (CI uses `--frozen-lockfile`) |
| `pnpm run doctor` | report real tool versions; fails only on required tools |
| `pnpm lint` | ESLint, including package-boundary rules |
| `pnpm typecheck` | `tsc` for browser code and for Node tooling |
| `pnpm test` | Vitest, node and jsdom projects |
| `pnpm build` | build both apps to `apps/*/dist` |
| `pnpm scan:secrets` | scan fixtures/samples for credentials and real account IDs |
| `pnpm fixtures:validate` | validate committed sample data (no Terraform needed) |
| `pnpm fixtures:generate` | regenerate samples (needs Terraform and registry access) |

## Conventions

- Tests sit next to the code (`*.test.ts` for Node, `*.dom.test.ts` for jsdom). Anything
  shipped to visitors must have jsdom coverage.
- Prefer property-based tests (fast-check) for parsers, diffing, and graph invariants.
- Apps build with `base: './'` so one build works under any URL path (GitHub Pages).
- Hash-based routing in apps, because GitHub Pages has no SPA rewrites.
- No external CDNs, fonts, or APIs in shipped apps.
