# Fixture stacks

Synthetic Terraform configurations used to generate the sample plans bundled with the
apps. They are **plan-only**: they are never applied and never contact AWS.

| Stack | Purpose |
| --- | --- |
| `stacks/web` | load balancer in front of an app server, with scoped IAM access to a private bucket (Terraform learning) |
| `stacks/haunted` | public web server, over-permissive IAM role, storage bucket, private database (security investigation) |

Each stack contains `.tf` files and a `stack.json` (title and description). Resource
blocks are shown to players as mission snippets, so keep comments neutral and do not
reveal intended findings.

**To add your own stack, create `fixtures/stacks/<id>/` with your `.tf` files and a
`stack.json`, then run `pnpm fixtures:generate <id>`.** It is picked up automatically.
Details: `docs/using-your-terraform.md`.

Regenerate with `pnpm fixtures:generate` (see `docs/environment.md`). Output goes to
`packages/samples/data/<stack>/` and is committed.

Rules:

- No data sources and no real identifiers. Use documented placeholder values.
- Use `manage_master_user_password = true` instead of literal passwords.
- Run `pnpm scan:secrets` and `pnpm fixtures:validate` before committing.
