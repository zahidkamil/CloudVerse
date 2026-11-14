# CloudVerse

A reusable framework that turns Terraform plan/state JSON into interactive, themed 3D
worlds, built for the Kiroween 2026 Skeleton Crew category.

> Status: foundation only (Task 1 of the plan). The apps currently list their bundled
> sample scenarios; the 3D renderer, graph engine, themes, and missions are built in the
> following tasks.

Two independent applications share the framework:

- **CloudVerse Explorer** (`apps/explorer`): Terraform education and infrastructure exploration.
- **CloudVerse Defense Lab** (`apps/defense-lab`): security investigation and simulated remediation.

A lightweight `templates/starter-app` for building your own app arrives in a later task.

## Quick start

You need **Node.js 24.15 or newer** (26 is used for development; see `.nvmrc`). You do
**not** need Terraform: sample infrastructure is committed and bundled with the apps.

Node.js 25 and later no longer bundle Corepack. If `corepack` is missing, run
`npm install -g corepack` first, or install the pinned pnpm directly
(`npm install -g pnpm@10.34.9`).

```sh
corepack enable            # activates the pnpm version pinned in package.json
pnpm install
pnpm run doctor              # reports your tool versions
pnpm test
pnpm build                 # builds apps/*/dist
pnpm --filter @cloudverse/app-explorer dev
```

If `corepack enable` is not permitted on your machine, prefix commands with `corepack`
instead, for example `corepack pnpm install`.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm run doctor` | check the environment |
| `pnpm lint` | ESLint, including package-boundary rules |
| `pnpm typecheck` | TypeScript for browser code and Node tooling |
| `pnpm test` | Vitest (Node and jsdom) |
| `pnpm build` | build both apps |
| `pnpm run inspect <plan.json \| sample-id>` | print the graph, roles and hierarchy built from a plan |
| `pnpm run golden:update` | rewrite golden files after a reviewed change to roles, edges or tree |
| `pnpm scan:secrets` | scan fixtures and samples for credentials |
| `pnpm fixtures:validate` | validate committed sample data |
| `pnpm fixtures:generate` | regenerate samples (development only; needs the Terraform CLI) |

## Your Terraform

CloudVerse reads Terraform plan JSON. To add built-in samples, put `.tf` files in
`fixtures/stacks/<id>/` and run `pnpm fixtures:generate <id>`. To explore your own
infrastructure in the apps, import a `terraform show -json` file (import UI arrives in
Task 6). Full details: [`docs/using-your-terraform.md`](docs/using-your-terraform.md).

## Privacy

Infrastructure JSON is processed in your browser and never uploaded. Use sanitized files.

## License

[MIT](LICENSE)

## Layout

See [`.kiro/steering/structure.md`](.kiro/steering/structure.md) for the package map and
the dependency rules that keep the framework reusable. Environment notes are in
[`docs/environment.md`](docs/environment.md).
