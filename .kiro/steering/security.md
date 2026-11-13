# CloudVerse: Security and Data Handling

## User data stays in the browser

- Terraform plan/state JSON is parsed client-side. Imported data is never uploaded and the
  apps make no network requests while importing (a Playwright test asserts this).
- Apps ship a restrictive Content-Security-Policy (`connect-src 'self'`).
- A redaction pass strips values Terraform marks sensitive and secret-shaped attributes
  before graph construction. It is best effort. The UI tells users to import sanitized
  files and never promises that redaction is complete.
- No analytics, telemetry, or third-party scripts.

## Fixtures and samples are public

Everything under `fixtures/` and `packages/samples/data/` is published and bundled into
public web apps.

- Fixtures are synthetic. Never commit output from a real AWS account.
- `pnpm fixtures:generate` runs Terraform with mock credentials, provider skip flags, no
  data sources, and all ambient `AWS_*` / `TF_VAR_*` variables removed, so it cannot
  reach a real account.
- `pnpm scan:secrets` must pass before committing fixtures. It flags access keys,
  secret keys, private keys, tokens, secret-valued attributes, and any account ID other
  than the documented placeholders (`123456789012`, `000000000000`). It never prints a
  full matched value.
- A Kiro hook re-runs the scan and validation when fixture files are saved.
- Prefer fixtures with `manage_master_user_password = true` over literal passwords.

## Security claims

- Attack paths are **modeled** from configuration with listed evidence. Use "modeled
  path", "modeled exposure", "simulated remediation". Never "exploitable" or "confirmed".
- Configured connectivity is not reachability. Edge assertions are `declared`,
  `inferred`, or `modeled`. Cross-provider edges require explicit evidence (a reference
  or a declared link) and are never created from names, tags, or proximity.
- The advanced multi-cloud scenarios are synthetic and labeled as such.

## Optional AI generation (Tier 3)

- Keys are entered by the user, kept in memory only, and never persisted or logged.
- The proxy backend is stateless, uses allowlisted provider URLs (no SSRF), caps request
  size, rate limits, uses strict CORS, and validates model output against the ThemeSpec
  schema before returning it.
- With bring-your-own-key through a hosted backend, the operator can technically see the
  key in transit. Document this trust boundary.
- The feature is isolated: the apps must work fully with no backend and no key.

## Supply chain

- Pin exact dependency versions and commit the lockfile. Flag unusual package names.
- Do not install global tools without the owner's approval.
