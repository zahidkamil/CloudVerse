# Development Environment Notes

Verified on the development machine (macOS, Apple Silicon) after upgrading Node.js.

## Verified tools

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 26.13.1 | managed by nvm; `.nvmrc` pins the major (26) and CI reads it |
| npm | 11.20.0 | |
| Corepack | 0.36.0 | **not bundled with Node 26**; installed globally with npm (see below) |
| pnpm | 10.34.9 | resolved through the Corepack shim, so plain `pnpm` works |
| Terraform | 1.16.0 | only for `pnpm fixtures:generate` |
| Terraform registry | reachable | the AWS provider download works |
| Playwright | see "Playwright" below | added with the renderer (Task 5) |

## Decisions that came from the environment

- **pnpm 10, not 12.** pnpm 12.18.0 failed to activate through Corepack 0.34.2 because
  its package layout changed (the expected `bin/pnpm.cjs` is missing). pnpm 10.34.9
  activates cleanly. Revisit when Corepack is upgraded.
- **TypeScript 6.0.3, not 7.** typescript-eslint 8.72.2 supports TypeScript below 6.1.
- **jsdom 31 and `@types/node` 26.** After the move to Node 26 the earlier Node 24.11
  limits no longer apply. `engines` is `^24.15.0 || >=26.0.0` because jsdom 31 needs it,
  and `engine-strict` makes installs fail clearly on older Node.
- **Dev scripts run on Node directly** (`node tools/x.ts`, native type stripping), so no
  extra runner dependency is needed.

## Corepack on Node 26

Node 25 and later no longer ship Corepack, so it is installed per Node version with
`npm install -g corepack`. That also creates `pnpm` and `yarn` shims in the Node bin
directory, and the shim picks the version pinned in `packageManager`, so plain `pnpm`
works. If you switch Node versions with nvm, repeat the install for the new version.
CI is unaffected: `pnpm/action-setup` installs pnpm itself.

## Where things run

- Install, lint, typecheck, test, and build need only Node and pnpm (no Terraform, no
  cloud credentials, no network except the package registry for `install`).
- CI (`.github/workflows/ci.yml`) runs the same steps on `ubuntu-latest` with the Node
  version from `.nvmrc`.
- Terraform is development-time only. Output is committed under `packages/samples/data`.

## Regenerating fixtures

```sh
pnpm fixtures:generate            # all stacks
pnpm fixtures:generate haunted    # one stack
pnpm scan:secrets && pnpm fixtures:validate
```

The script runs Terraform with mock credentials and removes ambient `AWS_*` and
`TF_VAR_*` variables, so it cannot reach a real account. Each stack commits its
`.terraform.lock.hcl`; the lock records hashes for the platform it was generated on
(darwin_arm64). Other platforms can regenerate by running `terraform init` first, which
extends the lock file locally.
