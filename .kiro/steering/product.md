# CloudVerse: Product

CloudVerse is a reusable framework that turns Terraform plan/state JSON into an
interactive, themed 3D world. It is the Kiroween 2026 "Skeleton Crew" submission:
the point is the reusable skeleton, proven by independent applications.

## Deliverables

- Two independently hosted web apps (public, no install, no API keys):
  - **CloudVerse Explorer**: Terraform education and infrastructure exploration
    (inspection, plan/state diff, dependency impact, beginner/intermediate missions).
  - **CloudVerse Defense Lab**: security investigation and simulated remediation
    (modeled attack paths, before/after comparison, security missions).
- A public open-source repository with a lightweight starter template
  (`templates/starter-app`), clone-and-run instructions, automated tests, and
  extension guides.
- Both apps support the same themes, graph interfaces, rendering engine, UI kit,
  and Challenge Engine. "Attack City" and "Cloud Metro" are demo scenarios, not apps.

## Principles

1. **Framework first.** Apps are thin compositions of packages. A developer must be
   able to add a provider, theme, mission, or app without modifying the framework.
2. **Browser first.** Visitors install nothing. Terraform JSON is parsed in the
   browser. The Terraform CLI is a development-time tool for generating fixtures only.
3. **Deterministic.** Scoring, analysis, and theme validation are deterministic and
   tested. No LLM decides scores or alters infrastructure.
4. **Honest security language.** Paths are "modeled" from configuration evidence,
   never "exploitable". Configured connectivity is not confirmed reachability.
5. **Readable over decorative.** Themes never hide severity, diff, or path overlays.
6. **Lean enough to be clear.** The skeleton must be understandable in one diagram and
   one page. Do not add a package, abstraction, or configuration option without a
   concrete need from an app. `templates/starter-app` stays tiny. Prefer deleting to
   generalizing.

## Constraints

- Deadline: December 4, 2026, 5 PM Eastern. Judges need both apps live through
  January 29, 2027.
- Tiers: Tier 1 essential MVP, Tier 2 differentiators (plan/state diff, theme
  composition), Tier 3 stretch (runtime LLM, first-person navigation, advanced
  multi-cloud security analysis). Do not start a tier before the previous one is solid.
