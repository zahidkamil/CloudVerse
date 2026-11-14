# Design: Roles, semantic edges and hierarchy

## Where things live

| Piece | Package | File |
| --- | --- | --- |
| `ROLES`, `ROLE_DESCRIPTIONS` | core | `model.ts` |
| `ProviderAdapter.relate`, `.containers` | core | `adapter.ts` |
| `buildHierarchy` | core | `hierarchy.ts` |
| `summarizeGraph` (text form for CLI and golden files) | core | `summary.ts` |
| Role table | provider-aws | `roles.ts` |
| Semantic edge rules | provider-aws | `relations.ts` |
| Container table | provider-aws | `containers.ts` |

No new package. The generic fallback stays in core and now also needs nothing extra:
no `containers` and no `relate` means every resource goes to its scope or the provider's
global group.

## Role taxonomy

Ten roles. Each is defined without naming a provider.

| Role | Meaning | AWS | Azure | GCP |
| --- | --- | --- | --- | --- |
| compute | runs code | instance, lambda | virtual machine, function | compute instance |
| object-storage | stores blobs | s3 bucket | storage container | storage bucket |
| database | stores structured data | db instance, dynamodb | sql database | sql instance |
| identity | who may act, and what they may do | iam role, policy, profile | managed identity, role assignment | service account |
| network-container | a private network boundary | vpc | virtual network | vpc network |
| subnet | a slice of a network | subnet | subnet | subnetwork |
| traffic-filter | decides what may reach a resource | security group and rules, public access block | network security group | firewall rule |
| gateway | a way in or out | internet gateway, load balancer | application gateway | load balancer |
| connectivity | plumbing that links things | route, route table, association | route table | route |
| unknown | no rule matched | any other type | any other type | any other type |

Judgement calls: load balancers are `gateway` (a front door); messaging has no role of its
own and is `unknown` until an app needs one (leanness). The public access block is a
`traffic-filter` because it decides what the public may reach.

## Adapter interface (additions, both optional)

```ts
interface ProviderAdapter {
  id: string;
  describe(resource): ResourceDescription;
  /** Derive inferred edges from the declared graph. */
  relate?(graph: Graph): readonly DerivedEdge[];
  /** type -> ordered container rules `{ type, via? }`. */
  containers?: Readonly<Record<string, readonly ContainerRule[]>>;
}
interface DerivedEdge { from; to; kind; evidence: readonly Evidence[] }
```

Ingest order: nodes, declared edges, `createGraph`, then for each adapter `relate(graph)`.
Derived edges are merged by id (`from->to:kind`), given assertion `inferred`, and the graph is
created again. Declared edges are copied unchanged (P4). A derived id never equals a declared id
because kinds differ; if a rule used a declared kind the merge would throw a `GraphError`, which
is a programming error and is reported as such.

## Semantic rules (AWS)

Rules read declared edges and the evidence `data.path` on them, because computed
attributes (such as `referenced_security_group_id`) are missing from `after`.

| Kind | From to | Derived from |
| --- | --- | --- |
| `allows-ingress` | SG to peer SG | ingress rule with a declared `referenced_security_group_id` edge and a `security_group_id` edge |
| `allows-egress` | SG to peer SG | egress rule, same shape |
| `runs-as` | instance to role | instance to profile (`iam_instance_profile`) to role (`role`) |
| `grants-access` | role to resource | role policy to role (`role`) plus any other declared target of the policy |
| `routes-via` | subnet to gateway | association to subnet and route table; route to route table and gateway (`gateway_id`) |
| `guards` | public access block to bucket | declared `bucket` edge; the four **bucket-level** flags from attributes. Account-level Block Public Access, bucket policies and ACLs are not read, so effective public access is always `undetermined` |

CIDR-based rules produce no edge: there is no node on the other end. Their CIDR and ports
stay in node attributes for Task 7.

## Hierarchy

```
~root
  ~provider/aws
    ~scope/aws/region/us-east-1
      aws_vpc.kingdom
        aws_subnet.graveyard
          aws_instance.mansion
    ~global/aws
      aws_iam_role.mansion_spirit
```

- Synthetic ids start with `~`, which no Terraform address can.
- `containers` example: `aws_instance: [{ type: aws_subnet, via: subnet_id }, { type: aws_vpc }]`.
  Rules are tried in order. Each rule walks outgoing declared edges breadth-first to depth 3
  (ties by id) and takes the first node of its type. `via` limits the first hop to references
  made by that attribute. It exists because an ingress rule that names two security groups
  belongs under the one in `security_group_id`, not the one in `referenced_security_group_id`.
- No match: the node's scope group (`kind/id`), else the provider's `global` group.
- Cycle guard: parents are chosen, then each chain is walked. A loop through a node is cut at that node,
  which falls back to its group. Plans with reference cycles can trigger it, so the property
  test generates them on purpose.
- Result type: `Hierarchy { root, nodes, node(id), parentOf(id), childrenOf(id), pathTo(id) }`,
  where each `HierarchyNode` is `{ id, kind: 'root'|'provider'|'scope'|'global'|'resource', label, parent?, graphNode?, children }`.

## Golden files

`packages/providers/aws/golden/<sample>.json` holds `{ tree: string[], edges: string[] }` from
`summarizeGraph`. Reviewed by hand once. Regenerate with `pnpm run golden:update` (a tool under
`tools/`, since packages cannot use the file system). Tests compare, never write.

## Risks

- The nearest-container search is a heuristic over declared edges. It is deterministic and
  tested, and tables can be corrected without code changes.
- A DB instance sits under its VPC, not a subnet, because it spans a subnet group.
- `count` and `for_each` keep Task 2's approximation (all instance pairs, `expanded` in evidence).

## Verification against provider docs

Checked with the Terraform MCP against `hashicorp/aws` 6.73.0 (pinned in both fixtures' lock
files) and the `haunted` and `web` plans.

| Rule | Docs confirm | Plan evidence | Result |
| --- | --- | --- | --- |
| SG ingress/egress | `security_group_id` is the owner; `referenced_security_group_id` is the source (ingress) or destination (egress); one of CIDR, prefix list or reference is required; ICMP `from_port`/`to_port` are type/code | `referenced_security_group_id` and `security_group_id` are unknown at plan time; only the reference paths exist. Ports and protocol are known | Direction and rule confirmed. Fixed ICMP wording |
| Instance, profile, role | instance `iam_instance_profile` is the profile **name**; profile `role` is the role name | known `role`/`iam_instance_profile` values are names; references point at `.name` | Confirmed, no change |
| Role policy | `role` is the role name; `policy` is a JSON document | `role` unknown; web `policy` unknown (it references the bucket); haunted `policy` known with `Resource: "*"` | A reference does not prove Allow. Now skipped when a known document has no Allow, and evidence says it was not evaluated |
| Subnet and routes | association has `subnet_id` or `gateway_id`; `aws_route.gateway_id` is an internet or virtual private gateway, `nat_gateway_id` is NAT; `aws_route_table` can hold inline `route` blocks | `subnet_id`, `route_table_id`, `gateway_id` unknown; destination CIDR known | Fixed: VPN gateway, inline routes (no destination claimed, since a set's order may differ), gateway associations ignored |
| S3 public access block | four flags default to `false`; `bucket` required | `bucket` unknown; flags known (haunted all false, web all true) | Confirmed. Evidence now states the level is bucket, uses "bucket-level block settings are off" when all four are off, and records effective public access as undetermined |

Not covered, by choice: inline `ingress`/`egress` blocks of `aws_security_group`,
`aws_security_group_rule` (the docs call both legacy), account-level public access blocks (`aws_s3_account_public_access_block`; `guards` is bucket-level only),
and route targets other than gateways (peering, transit gateway, endpoints).
