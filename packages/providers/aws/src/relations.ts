import type { DerivedEdge, Evidence, Graph, GraphEdge, GraphNode } from '@cloudverse/core';

// Semantic edges for AWS. Every rule reads declared edges and the attribute path recorded in
// their evidence, because computed attributes (such as referenced_security_group_id) are not
// in a plan's values. Nothing here looks at names or tags.

/** Nodes this node points at through one attribute (or attributes matching a pattern), optionally of one type. */
function targets(graph: Graph, node: GraphNode, path: string | RegExp, type?: string | readonly string[]): GraphNode[] {
  const found: GraphNode[] = [];
  const wanted = type === undefined ? undefined : typeof type === 'string' ? [type] : type;
  const matches = (value: unknown) => (typeof path === 'string' ? value === path : typeof value === 'string' && path.test(value));
  for (const edge of graph.outgoing(node.id)) {
    if (edge.assertion !== 'declared' || !edge.evidence.some((e) => matches(e.data?.path))) continue;
    const target = graph.node(edge.to);
    if (target && (wanted === undefined || wanted.includes(target.providerType))) found.push(target);
  }
  return found;
}

const ofType = (graph: Graph, type: string) => graph.nodes.filter((node) => node.providerType === type);
const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

/** For ICMP, the provider's from_port and to_port hold the ICMP type and code, not ports. */
const ICMP = new Set(['icmp', 'icmpv6', '1', '58']);

function describePorts(rule: GraphNode): string {
  const protocol = text(rule.attrs.ip_protocol);
  const from = num(rule.attrs.from_port);
  const to = num(rule.attrs.to_port);
  const proto = protocol === undefined || protocol === '-1' ? 'all protocols' : protocol;
  if (from === undefined || to === undefined) return proto;
  if (protocol !== undefined && ICMP.has(protocol.toLowerCase())) return `${proto} type ${from} code ${to}`;
  return `${proto} ${from === to ? from : `${from}-${to}`}`;
}

function securityGroupRules(graph: Graph): DerivedEdge[] {
  const out: DerivedEdge[] = [];
  for (const [type, kind, verb] of [
    ['aws_vpc_security_group_ingress_rule', 'allows-ingress', 'ingress to'],
    ['aws_vpc_security_group_egress_rule', 'allows-egress', 'egress from'],
  ] as const) {
    for (const rule of ofType(graph, type)) {
      const owners = targets(graph, rule, 'security_group_id', 'aws_security_group');
      const peers = targets(graph, rule, 'referenced_security_group_id', 'aws_security_group');
      for (const owner of owners) {
        for (const peer of peers) {
          out.push({
            from: owner.id,
            to: peer.id,
            kind,
            evidence: [
              {
                kind: 'security-group-rule',
                summary: `${rule.address} allows ${verb} ${owner.address} with ${peer.address} (${describePorts(rule)})`,
                data: {
                  rule: rule.address,
                  protocol: text(rule.attrs.ip_protocol) ?? null,
                  fromPort: num(rule.attrs.from_port) ?? null,
                  toPort: num(rule.attrs.to_port) ?? null,
                },
              },
            ],
          });
        }
      }
    }
  }
  return out;
}

function instanceRoles(graph: Graph): DerivedEdge[] {
  const out: DerivedEdge[] = [];
  for (const instance of ofType(graph, 'aws_instance')) {
    for (const profile of targets(graph, instance, 'iam_instance_profile', 'aws_iam_instance_profile')) {
      for (const role of targets(graph, profile, 'role', 'aws_iam_role')) {
        out.push({
          from: instance.id,
          to: role.id,
          kind: 'runs-as',
          evidence: [
            {
              kind: 'instance-profile',
              summary: `${instance.address} uses ${profile.address}, which uses ${role.address}`,
              data: { instance: instance.address, profile: profile.address, role: role.address },
            },
          ],
        });
      }
    }
  }
  return out;
}

/**
 * False only when the policy document is known and has no Allow statement, so a reference
 * cannot mean access. A computed document (the usual case when it references another
 * resource) cannot be read, so it stays possible.
 */
function mayAllow(policy: GraphNode): boolean {
  const document = text(policy.attrs.policy);
  if (document === undefined) return true;
  try {
    const parsed: unknown = JSON.parse(document);
    const statements = (parsed as { Statement?: unknown } | null)?.Statement;
    const list = Array.isArray(statements) ? statements : statements === undefined ? [] : [statements];
    return list.some((entry) => (entry as { Effect?: unknown } | null)?.Effect === 'Allow');
  } catch {
    return true;
  }
}

function policyGrants(graph: Graph): DerivedEdge[] {
  const out: DerivedEdge[] = [];
  for (const policy of ofType(graph, 'aws_iam_role_policy')) {
    if (!mayAllow(policy)) continue;
    const roles = targets(graph, policy, 'role', 'aws_iam_role');
    const granted = graph.outgoing(policy.id).filter((edge: GraphEdge) => edge.assertion === 'declared');
    for (const role of roles) {
      for (const edge of granted) {
        if (edge.to === role.id) continue;
        const paths = edge.evidence.map((e) => e.data?.path).filter((path): path is string => typeof path === 'string');
        out.push({
          from: role.id,
          to: edge.to,
          kind: 'grants-access',
          evidence: [
            {
              kind: 'role-policy',
              summary: `${policy.address} (attached to ${role.address}) references ${edge.to} in ${paths.join(', ')}; the policy document is not evaluated`,
              data: { policy: policy.address, role: role.address, paths, policyEvaluated: false },
            },
          ],
        });
      }
    }
  }
  return out;
}

/** The documented gateway targets: `gateway_id` is an internet or virtual private gateway. */
const GATEWAY_TYPES = ['aws_internet_gateway', 'aws_vpn_gateway'] as const;
const INLINE_GATEWAY = /^route\[\d+\]\.gateway_id$/;
const INLINE_NAT = /^route\[\d+\]\.nat_gateway_id$/;

interface RouteVia {
  readonly source: GraphNode;
  readonly gateways: readonly GraphNode[];
  readonly destination: string | null;
}

/** Gateways a route table sends traffic to, from standalone `aws_route` resources and inline `route` blocks. */
function routesOf(graph: Graph, table: GraphNode): RouteVia[] {
  const found: RouteVia[] = [];
  for (const route of ofType(graph, 'aws_route')) {
    if (!targets(graph, route, 'route_table_id', 'aws_route_table').some((candidate) => candidate.id === table.id)) continue;
    found.push({
      source: route,
      gateways: [...targets(graph, route, 'gateway_id', GATEWAY_TYPES), ...targets(graph, route, 'nat_gateway_id', 'aws_nat_gateway')],
      destination: text(route.attrs.destination_cidr_block) ?? null,
    });
  }
  // Inline blocks are a set, so their order in the plan can differ from the configuration; no destination is claimed.
  found.push({
    source: table,
    gateways: [...targets(graph, table, INLINE_GATEWAY, GATEWAY_TYPES), ...targets(graph, table, INLINE_NAT, 'aws_nat_gateway')],
    destination: null,
  });
  return found;
}

function subnetRoutes(graph: Graph): DerivedEdge[] {
  const out: DerivedEdge[] = [];
  for (const association of ofType(graph, 'aws_route_table_association')) {
    // An association with gateway_id instead of subnet_id is an edge association, not a subnet's route.
    const subnets = targets(graph, association, 'subnet_id', 'aws_subnet');
    for (const table of targets(graph, association, 'route_table_id', 'aws_route_table')) {
      for (const route of routesOf(graph, table)) {
        for (const subnet of subnets) {
          for (const gateway of route.gateways) {
            out.push({
              from: subnet.id,
              to: gateway.id,
              kind: 'routes-via',
              evidence: [
                {
                  kind: 'route',
                  summary: `${subnet.address} uses ${table.address} (${association.address}), whose route ${route.source === table ? 'block' : route.source.address} sends ${route.destination ?? 'traffic'} to ${gateway.address}`,
                  data: {
                    association: association.address,
                    route: route.source.address,
                    routeTable: table.address,
                    destination: route.destination,
                    inline: route.source === table,
                  },
                },
              ],
            });
          }
        }
      }
    }
  }
  return out;
}

const BLOCK_FLAGS = ['block_public_acls', 'block_public_policy', 'ignore_public_acls', 'restrict_public_buckets'] as const;

function publicAccessBlocks(graph: Graph): DerivedEdge[] {
  const out: DerivedEdge[] = [];
  for (const block of ofType(graph, 'aws_s3_bucket_public_access_block')) {
    const flags: Record<string, boolean | null> = {};
    for (const flag of BLOCK_FLAGS) flags[flag] = typeof block.attrs[flag] === 'boolean' ? (block.attrs[flag] as boolean) : null;
    const allBlocked = BLOCK_FLAGS.every((flag) => flags[flag] === true);
    for (const bucket of targets(graph, block, 'bucket', 'aws_s3_bucket')) {
      const evidence: Evidence = {
        kind: 'public-access-block',
        summary: `${block.address} applies to ${bucket.address}; ${allBlocked ? 'all four block settings are on' : 'not every block setting is confirmed on'}`,
        data: { block: block.address, allBlocked, ...flags },
      };
      out.push({ from: block.id, to: bucket.id, kind: 'guards', evidence: [evidence] });
    }
  }
  return out;
}

/** Derive AWS semantic edges from a declared graph. */
export function relateAws(graph: Graph): readonly DerivedEdge[] {
  return [
    ...securityGroupRules(graph),
    ...instanceRoles(graph),
    ...policyGrants(graph),
    ...subnetRoutes(graph),
    ...publicAccessBlocks(graph),
  ];
}
