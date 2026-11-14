# Requirements: Provider-neutral graph and Terraform plan ingest

## Introduction

CloudVerse turns Terraform plan JSON (`terraform show -json <planfile>`) into an immutable,
provider-neutral graph that every other package consumes. This spec covers the graph model,
provider adapters, plan ingest, and redaction of sensitive values. Everything must run in a
browser: no Node built-ins, no network, no file system.

Out of scope here: semantic roles and edges derived from IAM, security groups and similar
(roles spec), the containment hierarchy, state files, and plan/state diffing.

## Glossary

- **Plan**: the JSON produced by `terraform show -json` for a saved plan.
- **Graph**: nodes (resource instances) and edges (relationships), immutable once created.
- **Adapter**: a provider-specific object that describes a resource (role, label, scope).
- **Evidence**: a record explaining why an edge exists.
- **Assertion**: how strongly an edge is claimed: `declared`, `inferred`, or `modeled`.

## Requirements

### R1: Ingest from several input forms

**User story:** As a visitor, I want to give CloudVerse a plan however I have it, so I can
explore my infrastructure without installing anything.

1. WHEN the input is a JSON string, a `Blob`/`File`, or an already-parsed object, THE system
   SHALL produce a graph from it.
2. IF the input is not valid JSON, THEN THE system SHALL fail with an `IngestError` whose code
   is `invalid-json` and whose message is suitable to show a user.
3. IF the input is valid JSON but not a plan, THEN THE system SHALL fail with an `IngestError`
   whose code is `not-a-plan` and which names what is missing.
4. IF the input is a Terraform state file, THEN THE system SHALL fail with an `IngestError`
   whose code is `state-not-supported` and which says state support is planned.
5. THE system SHALL NOT throw any error other than `IngestError` for any string input.

### R2: Provider-neutral nodes

**User story:** As an app developer, I want one node shape for every cloud, so apps and
themes never branch on a provider.

1. THE system SHALL create exactly one node per managed resource instance in
   `resource_changes`, identified by its full Terraform address (including module path and
   `count`/`for_each` index).
2. THE system SHALL skip data sources.
3. Each node SHALL carry provider id, provider type, name, label, role, optional scope,
   planned actions, and attributes from the planned `after` value.
4. THE provider id SHALL be derived from the Terraform provider source (for example
   `registry.terraform.io/hashicorp/aws` becomes `aws`; `azurerm` becomes `azure`; `google`
   becomes `gcp`).
5. WHEN no adapter is registered for a resource's provider, THE system SHALL use a generic
   fallback adapter so that the resource still appears as a node with role `unknown`.
6. WHEN several providers appear in one plan, THE system SHALL place all of their nodes in
   one graph.

### R3: Declared relationships

**User story:** As a learner, I want to see what depends on what, taken straight from the
Terraform configuration.

1. WHEN a resource's configuration expression references another resource, THE system SHALL
   create an edge from the referencing node to the referenced node with kind `reference` and
   assertion `declared`.
2. WHEN a resource lists another resource in `depends_on`, THE system SHALL create an edge of
   kind `depends_on` with assertion `declared`.
3. THE system SHALL find references in nested blocks and lists, in the root module and in
   child modules.
4. WHEN a reference targets several instances (`count`/`for_each`) or the source has several
   instances, THE system SHALL create an edge for each pair and mark the evidence as
   expanded.
5. Multiple references between the same two nodes with the same kind SHALL produce one edge
   carrying every piece of evidence.
6. THE system SHALL NOT create edges for references to variables, locals, data sources, or
   resources that are not in the plan; unresolved resource references SHALL produce a
   diagnostic.
7. THE system SHALL NOT create an edge from a node to itself.

### R4: Evidence on every edge

**User story:** As a security reviewer, I want every relationship to be explainable, so
cross-cloud links are never guessed.

1. THE graph SHALL reject any edge with no evidence.
2. Each piece of evidence SHALL have a kind and a human-readable summary naming the source
   attribute path and the reference.
3. THE system SHALL NOT create an edge, in particular between nodes of different providers,
   from names, tags, or proximity.

### R5: Immutable, valid graph

1. THE graph SHALL reject duplicate node ids, edges whose endpoints are not nodes, and
   duplicate edge ids, with a `GraphError`.
2. THE graph, its nodes, edges and attributes SHALL be deeply frozen.
3. THE graph SHALL offer lookup of a node by id and the outgoing and incoming edges of a
   node.

### R6: Redaction of sensitive values

**User story:** As a visitor, I want sensitive values removed before CloudVerse builds
anything, because I may import a plan I did not fully sanitize.

1. WHEN a plan value is marked sensitive by Terraform (`before_sensitive`,
   `after_sensitive`, `sensitive_values`), THE system SHALL replace that value with the
   marker `[redacted]`, leaving null values unchanged.
2. THE system SHALL also redact string values under keys that look like secrets (password,
   secret, token, api key, private key, access key, credentials) and `constant_value`
   entries in configuration for such keys.
3. Redaction SHALL NOT change the shape of the plan or the values that are not sensitive,
   and SHALL NOT mutate its input.
4. Ingest SHALL redact by default, before any node is created.
5. Redaction is best effort. THE documentation and UI SHALL NOT claim it is complete.

### R7: Pluggable providers without changing the core

1. THE core SHALL define the adapter interface; a provider package SHALL implement it
   using only the core package.
2. THE AWS adapter SHALL set the region as node scope when the plan provides it.
3. Adding a provider adapter SHALL NOT require changes in the core.

## Correctness properties (tested with fast-check)

- **P1 References become edges:** for any generated acyclic plan, the set of edges equals the
  set of references declared in its configuration (excluding self and unresolved ones).
- **P2 Edges are evidenced and valid:** every edge in any ingested graph has evidence and its
  endpoints exist; node ids are unique.
- **P3 Redaction hides what is marked:** after redaction no value marked sensitive survives
  and every unmarked value is unchanged; the input is not mutated; redaction is idempotent.
- **P4 Ingest never throws foreign errors:** for any string, ingest either produces a graph
  or rejects with an `IngestError`.
- **P5 Index stripping:** stripping indexes from an address yields the same base address as
  the resource's configuration address.
- **P6 Graph indexes agree with the edge list:** the sum of outgoing edges over nodes and the
  sum of incoming edges both equal the number of edges.
