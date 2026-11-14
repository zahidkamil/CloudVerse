# Design: Provider-neutral graph and Terraform plan ingest

## Overview

```
string | Blob | object
        │  readInput (JSON.parse, Blob.text)
        ▼
   parsePlan ── validatePlan ──► IngestError (invalid-json / not-a-plan / state-not-supported)
        │
        ▼
 redactSensitive (default on)
        │
        ▼
  nodes: resource_changes (managed) ── adapter.describe ──► GraphNode
  edges: configuration references + depends_on ───────────► GraphEdge(+Evidence)
        │
        ▼
   createGraph (validate, freeze, index) ──► { graph, diagnostics }
```

All code is plain TypeScript with no Node built-ins, so it runs in browsers, jsdom, and Node.

## Where it lives

| Package | Contents |
| --- | --- |
| `@cloudverse/core` | model, graph, plan validation, redaction, address helpers, ingest, `ProviderAdapter` interface, generic fallback adapter |
| `@cloudverse/provider-aws` | `awsAdapter` (scope from region; roles arrive with the roles spec) |

The generic fallback lives in `core` (a few lines), so there is no separate generic package.
Apps pass the adapters they want; core never imports a provider.

## Model

```ts
type Role = 'compute' | 'object-storage' | 'database' | 'identity' | 'network-container'
          | 'subnet' | 'traffic-filter' | 'gateway' | 'connectivity' | 'unknown';

interface GraphNode {
  id: string;            // full address, e.g. module.net.aws_subnet.a["x"]
  address: string;       // same as id
  baseAddress: string;   // indexes removed, matches the configuration address
  provider: string;      // aws | azure | gcp | <provider name>
  providerType: string;  // aws_instance
  name: string;          // Terraform resource name
  label: string;         // adapter label, else tags.Name, else name
  role: Role;            // 'unknown' until the roles spec
  scope?: { kind: string; id: string };   // e.g. { kind: 'region', id: 'us-east-1' }
  actions: readonly string[];             // create, update, delete, no-op, ...
  attrs: Readonly<Record<string, unknown>>;  // planned "after" values, redacted
}

interface GraphEdge {
  id: string;        // `${from}->${to}:${kind}`
  from: string; to: string;
  kind: 'reference' | 'depends_on' | string;
  assertion: 'declared' | 'inferred' | 'modeled';
  evidence: readonly Evidence[];   // never empty
}

interface Evidence { kind: string; summary: string; data?: Readonly<Record<string, unknown>> }
```

Edge direction: from the dependent resource to the resource it depends on.

## Key decisions

1. **Edges come only from configuration.** `configuration.*.resources[].expressions`
   (recursively, including nested blocks and lists) and `depends_on`. Both
   `aws_x.y.attr` and `aws_x.y` appear in `references`; they resolve to the same address and
   merge into one edge.
2. **Address resolution.** Indexes (`[0]`, `["k"]`) are stripped to find the configuration
   address. A reference resolves to `<module prefix><type>.<name>`; instances sharing that
   base address are all targets. `var.`, `local.`, `each.`, `count.`, `path.`, `terraform.`,
   `self.` and `data.` references are ignored. `module.x.output` references are not
   followed (diagnostic).
3. **Modules.** Child module resources are visited through `module_calls`, with the module
   path prefix, so references inside a module resolve within it. References passed as module
   inputs are not followed (documented limitation).
4. **Evidence everywhere.** `createGraph` rejects an edge without evidence, which also
   guarantees cross-provider edges are explained. Nothing infers edges from names or tags.
5. **Redaction runs first.** It walks the whole plan and masks values using Terraform's
   sensitive mirror trees, plus a key-name heuristic. It builds a new plan.
6. **Immutability.** `createGraph` copies and deep-freezes. Mutation APIs do not exist;
   building a graph is the only write path, and `theme`/`render` are linted away from it
   (`createGraph`, `ingestPlan`, `ingestPlanObject` may not be imported there).
7. **Errors vs diagnostics.** Fatal input problems throw `IngestError` with a stable code.
   Non-fatal oddities are returned as `diagnostics`.

## Testing

- Example tests with small synthetic plans (`*.dom.test.ts`, run in jsdom) and the real
  sample plans through `awsAdapter`.
- fast-check properties P1 to P6 from the requirements.
- Cross-check: an independent recomputation of references from the raw sample JSON must
  equal the ingested edge set.
