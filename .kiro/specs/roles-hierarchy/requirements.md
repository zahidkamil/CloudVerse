# Requirements: Roles, semantic edges and hierarchy

## Introduction

Task 2 turns a Terraform plan into a provider-neutral graph whose nodes all have the role
`unknown`. This feature gives nodes a meaningful role, adds a few semantic edges that
Terraform references alone do not express, and arranges nodes into a hierarchy
(provider, then region or global, then containers such as a VPC or subnet) that a layout
can turn into districts. Everything is deterministic, data-driven and provider-neutral in
core, with AWS knowledge kept in `@cloudverse/provider-aws`.

Terraform MCP was not available when this was written. Rules are grounded in the attributes
of the real plans in `@cloudverse/samples` and in the AWS provider's documented schema.

## Glossary

- **Role**: a provider-neutral answer to "what does this resource do?". Themes map roles
  to visuals, never resource types.
- **Semantic edge**: an `inferred` edge derived by a rule from declared edges and
  configuration values. It always carries evidence.
- **Container**: a real resource that contains others (VPC contains subnets).
- **Synthetic group**: a hierarchy node that is not a resource (root, provider, region, global).

## Requirements

### R1: Role taxonomy

**User story:** As a theme author, I want a small fixed set of roles so one recipe set
covers every provider.

1. THE `ROLES` list SHALL stay at ten values and each SHALL have a one-line description
   exported as `ROLE_DESCRIPTIONS`.
2. WHEN a provider has no rule for a resource type, THE node SHALL get the role `unknown`.
3. THE taxonomy SHALL be provider-neutral: each role SHALL be definable without naming a
   provider (documented in the design with AWS, Azure and GCP examples).

### R2: AWS classification

1. THE AWS adapter SHALL classify resource types from a table (exact types, then ordered
   prefix rules), with no per-resource code.
2. THE table SHALL cover every type in both samples; an unknown AWS type SHALL get `unknown`.
3. THE adapter SHALL keep setting the region scope; global IAM resources SHALL have no scope.

### R3: Semantic edges

1. THE adapter SHALL be able to derive edges from the declared graph by an optional `relate` hook.
2. Every derived edge SHALL have assertion `inferred` and at least one evidence entry that
   names the nodes and attributes it came from.
3. WHEN a security group rule refers to another security group through
   `referenced_security_group_id`, THE graph SHALL gain `allows-ingress` (ingress rule) or
   `allows-egress` (egress rule) from the rule's security group to the referenced one,
   with protocol and ports in the evidence.
4. WHEN an instance uses an instance profile that uses a role, THE graph SHALL gain
   `runs-as` from the instance to the role.
5. WHEN a role policy references a resource, THE graph SHALL gain `grants-access` from the
   role to that resource, unless the policy document is known and has no Allow statement.
   The evidence SHALL say the document was not evaluated.
6. WHEN a subnet is associated with a route table that has a route to a gateway (an
   internet, virtual private or NAT gateway; from an `aws_route` or an inline `route` block),
   THE graph SHALL gain `routes-via` from the subnet to the gateway, with the destination CIDR
   when it is known. Associations made to a gateway instead of a subnet SHALL NOT add one.
7. WHEN a public access block applies to a bucket, THE graph SHALL gain `guards` from the
   block to the bucket, with the four flags in the evidence. `guards` describes **bucket-level**
   S3 Block Public Access settings only. Account-level Block Public Access, bucket policies and
   ACLs are outside Task 3. With all four flags off the evidence SHALL say "bucket-level block
   settings are off", with all four on "all four bucket-level block settings are on", otherwise
   "some bucket-level block settings are off or not confirmed". In every case it SHALL record
   `level: 'bucket'` and `effectivePublicAccess: 'undetermined'`, and SHALL NOT say the bucket
   is or is not public.
8. Rules SHALL read declared evidence (reference paths), not guessed names or tags, because
   computed attributes are absent from plans.
9. Semantic edges SHALL NOT change or remove declared edges.

### R4: Hierarchy

1. THE core SHALL build a tree from a graph: root, one group per provider, one group per
   scope within a provider (such as `region us-east-1`), and a `global` group per provider
   for resources without a scope.
2. Adapters SHALL declare containers per resource type as data: ordered rules, each a type
   and optionally the attribute (`via`) that must make the first reference. A resource's
   parent SHALL be the nearest node (up to three declared edges away) found by the first
   rule that matches, otherwise its scope group, otherwise the provider's global group.
3. EVERY node except the root SHALL have exactly one parent.
4. THE hierarchy SHALL be acyclic and every resource SHALL appear exactly once.
5. THE hierarchy SHALL be deterministic: children are sorted by id.
6. Synthetic ids SHALL NOT collide with Terraform addresses.
7. THE hierarchy SHALL support a graph with several providers.

### R5: Carry-over from ingest

1. `expanded` markers and evidence from declared edges SHALL be preserved in the final graph.
2. Cross-provider edges SHALL have evidence. This holds for every edge already.
3. `ingestPlan` SHALL return the hierarchy next to the graph and SHALL still throw only `IngestError` for bad input. An adapter that returns an edge without evidence or with a missing endpoint is a programming error and fails loudly with `GraphError`.

### R6: Verification

1. Golden files SHALL record the tree and edges for `haunted` and `web`.
2. Tests SHALL cover single parent, acyclicity, completeness, determinism, evidence on
   semantic edges, unknown types, and a synthetic multi-provider plan.
3. Property tests SHALL cover the hierarchy invariants over generated plans.

## Correctness properties

- **P1 (single parent):** every non-root hierarchy node has exactly one parent that exists.
- **P2 (acyclic and complete):** walking parents from any node reaches the root; every graph node appears once.
- **P3 (evidence):** every non-declared edge has evidence; every edge, including cross-provider, has evidence.
- **P4 (declared preserved):** the declared edge set after semantic derivation equals the one before.
- **P5 (total roles):** every node has a role from `ROLES`, for any resource type.
- **P6 (determinism):** ingesting the same plan twice yields identical hierarchies.
