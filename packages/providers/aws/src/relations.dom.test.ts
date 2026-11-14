import { ingestPlanObject } from '@cloudverse/core';
import { samples } from '@cloudverse/samples';
import { describe, expect, it } from 'vitest';
import { awsAdapter } from './index.ts';

// Edge cases found by comparing the AWS provider 6.73.0 docs (via Terraform MCP) with the
// sample plans. Each test edits a copy of a real sample plan and ingests it.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function edited(id: string, change: (plan: Json) => void) {
  const found = samples.find((s) => s.id === id);
  const plan = structuredClone(found?.plan) as Json;
  change(plan);
  return ingestPlanObject(plan, { adapters: [awsAdapter] }).graph;
}
const change = (plan: Json, address: string) => plan.resource_changes.find((r: Json) => r.address === address).change;
const config = (plan: Json, address: string) => plan.configuration.root_module.resources.find((r: Json) => r.address === address);
const refs = (...references: string[]) => ({ references });

/** Add a resource that exists only in the edited plan. */
function addResource(plan: Json, type: string, name: string, provider = 'registry.terraform.io/hashicorp/aws') {
  plan.resource_changes.push({
    address: `${type}.${name}`,
    mode: 'managed',
    type,
    name,
    provider_name: provider,
    change: { actions: ['create'], before: null, after: { region: 'us-east-1' }, after_unknown: {}, before_sensitive: false, after_sensitive: {} },
  });
  plan.configuration.root_module.resources.push({ address: `${type}.${name}`, mode: 'managed', type, name, expressions: {} });
}

describe('routes-via: documented route forms', () => {
  it('follows a virtual private gateway in aws_route.gateway_id', () => {
    const graph = edited('haunted', (plan) => {
      addResource(plan, 'aws_vpn_gateway', 'vpn');
      config(plan, 'aws_route.graveyard_internet').expressions.gateway_id = refs('aws_vpn_gateway.vpn.id', 'aws_vpn_gateway.vpn');
    });
    expect(graph.edges.map((e) => e.id)).toContain('aws_subnet.graveyard->aws_vpn_gateway.vpn:routes-via');
  });

  it('follows nat_gateway_id', () => {
    const graph = edited('haunted', (plan) => {
      addResource(plan, 'aws_nat_gateway', 'nat');
      const expressions = config(plan, 'aws_route.graveyard_internet').expressions;
      delete expressions.gateway_id;
      expressions.nat_gateway_id = refs('aws_nat_gateway.nat.id', 'aws_nat_gateway.nat');
    });
    expect(graph.edges.map((e) => e.id)).toContain('aws_subnet.graveyard->aws_nat_gateway.nat:routes-via');
  });

  it('follows inline route blocks of aws_route_table, without claiming a destination', () => {
    const graph = edited('haunted', (plan) => {
      plan.resource_changes = plan.resource_changes.filter((r: Json) => r.address !== 'aws_route.graveyard_internet');
      const root = plan.configuration.root_module;
      root.resources = root.resources.filter((r: Json) => r.address !== 'aws_route.graveyard_internet');
      config(plan, 'aws_route_table.graveyard_road').expressions.route = [
        { gateway_id: refs('aws_internet_gateway.gate.id', 'aws_internet_gateway.gate') },
      ];
    });
    const edge = graph.edges.find((e) => e.id === 'aws_subnet.graveyard->aws_internet_gateway.gate:routes-via');
    expect(edge?.evidence[0]?.data).toMatchObject({ inline: true, destination: null, route: 'aws_route_table.graveyard_road' });
  });

  it('ignores an association made to a gateway rather than a subnet', () => {
    const graph = edited('haunted', (plan) => {
      const expressions = config(plan, 'aws_route_table_association.graveyard').expressions;
      delete expressions.subnet_id;
      expressions.gateway_id = refs('aws_internet_gateway.gate.id', 'aws_internet_gateway.gate');
    });
    expect(graph.edges.filter((e) => e.kind === 'routes-via')).toEqual([]);
  });

  it('marks standalone routes as not inline', () => {
    const graph = edited('web', () => {});
    const edge = graph.edges.find((e) => e.kind === 'routes-via');
    expect(edge?.evidence[0]?.data).toMatchObject({ inline: false, destination: '0.0.0.0/0' });
  });
});

describe('security group rules: ICMP', () => {
  it('describes from_port and to_port as an ICMP type and code, not a port range', () => {
    const graph = edited('haunted', (plan) => {
      Object.assign(change(plan, 'aws_vpc_security_group_ingress_rule.tomb_from_mansion').after, {
        ip_protocol: 'icmp',
        from_port: 8,
        to_port: 0,
      });
    });
    const edge = graph.edges.find((e) => e.kind === 'allows-ingress');
    expect(edge?.evidence[0]?.summary).toContain('icmp type 8 code 0');
    expect(edge?.evidence[0]?.summary).not.toContain('icmp 8');
  });

  it('says "all protocols" for -1 without ports', () => {
    const graph = edited('haunted', (plan) => {
      Object.assign(change(plan, 'aws_vpc_security_group_ingress_rule.tomb_from_mansion').after, {
        ip_protocol: '-1',
        from_port: null,
        to_port: null,
      });
    });
    expect(graph.edges.find((e) => e.kind === 'allows-ingress')?.evidence[0]?.summary).toContain('(all protocols)');
  });
});

describe('grants-access: a reference is not proof of Allow', () => {
  const withPolicy = (document: string | undefined) =>
    edited('haunted', (plan) => {
      change(plan, 'aws_iam_role_policy.mansion_spirit_access').after.policy = document;
      config(plan, 'aws_iam_role_policy.mansion_spirit_access').expressions.policy = refs('aws_s3_bucket.crypt.arn', 'aws_s3_bucket.crypt');
    }).edges.filter((e) => e.kind === 'grants-access');
  const doc = (effect: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: effect, Action: 's3:*', Resource: 'x' }] });

  it('adds an edge for a known Allow policy and says the document was not evaluated', () => {
    const edges = withPolicy(doc('Allow'));
    expect(edges.map((e) => e.id)).toEqual(['aws_iam_role.mansion_spirit->aws_s3_bucket.crypt:grants-access']);
    expect(edges[0]?.evidence[0]?.data).toMatchObject({ policyEvaluated: false });
  });

  it('adds no edge for a known policy that only denies', () => {
    expect(withPolicy(doc('Deny'))).toEqual([]);
  });

  it('keeps the edge when the policy is computed or unreadable', () => {
    expect(withPolicy(undefined)).toHaveLength(1);
    expect(withPolicy('not json')).toHaveLength(1);
  });
});

describe('guards: public access block flags', () => {
  it('does not claim "off" for flags that are missing; only that they are not all confirmed on', () => {
    const graph = edited('web', (plan) => {
      delete change(plan, 'aws_s3_bucket_public_access_block.assets').after.restrict_public_buckets;
    });
    const edge = graph.edges.find((e) => e.kind === 'guards');
    expect(edge?.evidence[0]?.data).toMatchObject({ allBlocked: false, state: 'mixed-or-unknown', restrict_public_buckets: null, block_public_acls: true });
    expect(edge?.evidence[0]?.summary).toContain('some bucket-level block settings are off or not confirmed');
  });

  it('with all four flags off, says the bucket-level settings are off and leaves effective access undetermined', () => {
    const edge = edited('haunted', () => {}).edges.find((e) => e.kind === 'guards');
    expect(edge?.evidence[0]?.data).toMatchObject({ level: 'bucket', state: 'all-off', effectivePublicAccess: 'undetermined' });
    const summary = edge?.evidence[0]?.summary ?? '';
    expect(summary).toContain('bucket-level block settings are off');
    expect(summary).toContain('Effective public access is not determined');
    expect(summary).not.toMatch(/\bpublic\b(?! access)/i); // never says the bucket is public
  });

  it('with all four flags on, still leaves effective access undetermined', () => {
    const edge = edited('web', () => {}).edges.find((e) => e.kind === 'guards');
    expect(edge?.evidence[0]?.data).toMatchObject({ level: 'bucket', state: 'all-on', effectivePublicAccess: 'undetermined' });
    expect(edge?.evidence[0]?.summary).toContain('all four bucket-level block settings are on');
  });
});
