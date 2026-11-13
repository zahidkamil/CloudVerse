# CloudVerse: Repository Structure and Boundaries

```
packages/
  core/                 provider-neutral graph, ingest, hierarchy, diff
  providers/aws/        AWS adapter (depends on core only)
  providers/generic/    fallback adapter for unsupported types
  analysis/             modeled attack paths, impact, remediation patches
  layout/               layout strategies
  theme/                ThemeSpec schema, recipe DSL, library, validator (data only)
  challenge/            missions, objectives, deterministic scoring
  render/               three.js renderer, camera controllers, interaction events
  ui-kit/               reusable UI shared by every app
  samples/              bundled sanitized sample plans (generated, committed)
apps/
  explorer/             CloudVerse Explorer
  defense-lab/          CloudVerse Defense Lab
templates/starter-app/  lightweight starter template (added in Task 6)
fixtures/stacks/        Terraform sources used to generate samples (dev-time only)
tools/                  Node-only dev tooling and its tests
docs/                   environment notes and extension guides
```

## Boundary rules (enforced by `eslint.config.mjs` and tested in `tools/lint-boundaries.test.ts`)

- Packages are used only through their public entry point (`src/index.ts`, declared in
  `exports`). Never deep-import `@cloudverse/*/src/...`.
- Apps never import each other.
- `core` depends on no other CloudVerse package. Providers depend on `core` only.
- `theme` and `render` never import `analysis`, `challenge`, or providers. A theme
  can therefore never read or change infrastructure facts.
- `analysis` and `layout` never import presentation packages.
- `ui-kit` never imports apps, `analysis`, or providers. Apps register app-specific
  panel sections instead.
- `samples` depends on no other CloudVerse package.
- Browser-targeted code (everything under `packages/` and `apps/`) never uses Node
  built-ins. Node-only code lives in `tools/`.

When adding a rule, add a failing-then-passing case to `tools/lint-boundaries.test.ts`.

TODO (Task 2): once `core` exposes graph mutation APIs, forbid `theme`/`render` from
importing them and record the exact rule here.
