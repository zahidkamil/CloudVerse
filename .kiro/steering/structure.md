# CloudVerse: Repository Structure and Boundaries

```
packages/
  core/                 provider-neutral graph, ingest, redaction, adapter interface and
                        generic fallback adapter (hierarchy and diff arrive later)
  providers/aws/        AWS adapter (depends on core only)
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

Graphs are immutable and building one is the only way to write one. `theme` and `render`
may read graphs (types, lookups) but may not import `createGraph`, `ingestPlan`, or
`ingestPlanObject` from `@cloudverse/core`. The UI kit and apps may, because they import
plans. This is enforced by lint and tested.

Adding a cloud: implement `ProviderAdapter` in a new `packages/providers/<name>` package
that depends only on `@cloudverse/core`, and pass it to `ingestPlan`. Core never changes.
