# Where Terraform input goes

CloudVerse reads Terraform **plan JSON** (`terraform show -json`), not `.tf` files. There
are three ways to give it Terraform, depending on who you are.

| You are | Input | Where it goes | Status |
| --- | --- | --- | --- |
| A visitor of the deployed apps | a plan JSON file | the import control in the app (drop, pick, or paste) | built in Task 6 |
| A developer adding a built-in sample | `.tf` files | `fixtures/stacks/<id>/` | works now |
| A developer with only a plan JSON | plan JSON | not supported yet | see below |

## 1. Visitors: bring a plan JSON

Visitors never need Terraform installed to use the apps, but to import **their own**
infrastructure they need a plan file, produced wherever they run Terraform:

```sh
terraform init
terraform plan -out=tfplan
terraform show -json tfplan > plan.json
```

Then drop `plan.json` into the app. The file is parsed in the browser and never uploaded.

- **Sanitize first.** Remove real account IDs, secrets, and private names before importing.
  CloudVerse redacts values Terraform marks sensitive, but that is best effort.
- The import control arrives in Task 6. Until then the apps show the bundled samples only.
- State files (`terraform show -json > state.json`) and plan/state comparison arrive in Tier 2.

## 2. Developers: add a built-in sample from `.tf` files

Put Terraform sources in a new folder. The folder name becomes the sample id.

```
fixtures/stacks/<id>/
  versions.tf     provider pin + plan-only provider settings (copy from an existing stack)
  *.tf            your resources
  stack.json      { "title": "...", "description": "..." }
```

Then:

```sh
pnpm fixtures:generate <id>     # needs the Terraform CLI and registry access (dev only)
pnpm scan:secrets
pnpm fixtures:validate
pnpm test
```

This writes `packages/samples/data/<id>/{plan,meta,snippets}.json`. The samples package
discovers new folders automatically, so **no code changes are needed**: the new sample
appears in every app and test that lists `samples`.

Rules for stack sources:

- Plan-only. Copy the `provider "aws"` block with its `skip_*` flags from an existing
  stack so planning needs no real credentials. The generator also clears ambient `AWS_*`
  variables and uses mock credentials.
- No data sources, no real identifiers, and no literal passwords. Use
  `manage_master_user_password = true` for databases.
- Pin the provider to an exact version. Commit the generated `.terraform.lock.hcl`.
- Keep comments neutral. Resource blocks are shown to players as mission snippets.
- Only AWS stacks are wired into the generator for now. Azure and GCP arrive in Tier 2.

## 3. Developers with only a plan JSON

A bundled sample needs an HCL snippet for every resource (missions show them), and the
validator enforces that. Plan-only samples without source are not supported. If you only
have a plan, use the browser import in section 1 once Task 6 lands.

## Checks that protect you

- `pnpm scan:secrets [path ...]` flags credentials and non-placeholder account IDs.
- `pnpm fixtures:validate` checks that each sample is a real Terraform plan with matching
  snippets.
- A Kiro hook runs both whenever files under `fixtures/` or `packages/samples/data/` are saved.
- Never commit output from a real AWS account. Everything in those folders is published.
