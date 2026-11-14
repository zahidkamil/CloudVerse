import { ROLES, ingestPlanObject, type Graph, type Hierarchy } from '@cloudverse/core';
import { ROOT_ID, summarizeGraph } from '@cloudverse/core';
import { samples } from '@cloudverse/samples';
import { describe, expect, it } from 'vitest';
import hauntedGolden from '../golden/haunted.json';
import webGolden from '../golden/web.json';
import { awsAdapter, awsRole } from './index.ts';

// Runs in jsdom with the real Terraform-generated sample plans.
// Golden files are produced by `pnpm run golden:update`; tests only compare.

const golden: Record<string, { tree: string[]; edges: string[] }> = { haunted: hauntedGolden, web: webGolden };
const ingest = (plan: unknown) => ingestPlanObject(plan, { adapters: [awsAdapter] });
const sample = (id: string) => {
  const found = samples.find((s) => s.id === id);
  if (!found) throw new Error(`missing sample ${id}`);
  return ingest(found.plan);
};

/** Single parent, acyclic, complete: checked through the public API only. */
function expectTree(graph: Graph, hierarchy: Hierarchy): void {
  const listed = hierarchy.nodes.map((n) => n.id);
  expect(new Set(listed).size).toBe(listed.length);
  for (const node of graph.nodes) expect(listed.filter((id) => id === node.id)).toHaveLength(1);
  for (const node of hierarchy.nodes) {
    if (node.id === ROOT_ID) continue;
    const parents = hierarchy.nodes.filter((other) => other.children.includes(node.id));
    expect(parents.map((p) => p.id), node.id).toEqual([node.parent]);
    const seen = new Set<string>();
    for (let at: string | undefined = node.id; at !== undefined; at = hierarchy.parentOf(at)) {
      expect(seen.has(at), `cycle at ${at}`).toBe(false);
      seen.add(at);
    }
    expect(seen.has(ROOT_ID)).toBe(true);
  }
}

describe('AWS roles, edges and hierarchy on the samples', () => {
  for (const { id } of samples) {
    describe(id, () => {
      const { graph, hierarchy, diagnostics } = sample(id);

      it('matches the golden tree and edges', () => {
        const summary = summarizeGraph(graph, hierarchy);
        expect({ tree: [...summary.tree], edges: [...summary.edges] }).toEqual(golden[id]);
      });

      it('has a valid tree: one parent each, acyclic, every node once', () => {
        expectTree(graph, hierarchy);
        expect(diagnostics).toEqual([]);
      });

      it('gives every node a real role, none unknown', () => {
        for (const node of graph.nodes) {
          expect(ROLES, node.id).toContain(node.role);
          expect(node.role, `${node.id} (${node.providerType})`).not.toBe('unknown');
        }
      });

      it('keeps IAM in the Global group and everything else under the region', () => {
        for (const node of graph.nodes) {
          const path = hierarchy.pathTo(node.id);
          expect(path.slice(0, 2)).toEqual([ROOT_ID, '~provider/aws']);
          expect(path[2], node.id).toBe(node.providerType.startsWith('aws_iam_') ? '~global/aws' : '~scope/aws/region/us-east-1');
        }
      });

      it('gives every edge evidence, and every inferred edge a kind from the rules', () => {
        const kinds = new Set(['allows-ingress', 'allows-egress', 'runs-as', 'grants-access', 'routes-via', 'guards']);
        for (const edge of graph.edges) {
          expect(edge.evidence.length).toBeGreaterThan(0);
          if (edge.assertion === 'inferred') expect(kinds.has(edge.kind), edge.id).toBe(true);
        }
      });

      it('carries declared evidence (with the expanded marker) unchanged', () => {
        const declared = graph.edges.filter((e) => e.assertion === 'declared');
        expect(declared.length).toBeGreaterThan(10);
        for (const edge of declared) {
          for (const evidence of edge.evidence) expect(typeof evidence.data?.expanded).toBe('boolean');
        }
      });
    });
  }

  it('haunted: the expected nesting, checked by hand rather than from the golden file', () => {
    const { hierarchy } = sample('haunted');
    const parent = (id: string) => hierarchy.parentOf(id);
    expect(parent('aws_vpc.kingdom')).toBe('~scope/aws/region/us-east-1');
    expect(parent('aws_subnet.graveyard')).toBe('aws_vpc.kingdom');
    expect(parent('aws_instance.mansion')).toBe('aws_subnet.graveyard');
    expect(parent('aws_db_instance.tomb')).toBe('aws_vpc.kingdom');
    expect(parent('aws_vpc_security_group_ingress_rule.tomb_from_mansion')).toBe('aws_security_group.tomb_ward');
    expect(parent('aws_route.graveyard_internet')).toBe('aws_route_table.graveyard_road');
    expect(parent('aws_s3_bucket_public_access_block.crypt')).toBe('aws_s3_bucket.crypt');
    expect(parent('aws_iam_role.mansion_spirit')).toBe('~global/aws');
    expect(parent('aws_iam_role_policy.mansion_spirit_access')).toBe('aws_iam_role.mansion_spirit');
  });

  it('haunted: semantic edges and their evidence', () => {
    const { graph } = sample('haunted');
    const inferred = graph.edges.filter((e) => e.assertion === 'inferred').map((e) => e.id).sort();
    expect(inferred).toEqual([
      'aws_instance.mansion->aws_iam_role.mansion_spirit:runs-as',
      'aws_s3_bucket_public_access_block.crypt->aws_s3_bucket.crypt:guards',
      'aws_security_group.tomb_ward->aws_security_group.mansion_gate:allows-ingress',
      'aws_subnet.graveyard->aws_internet_gateway.gate:routes-via',
    ]);
    const get = (id: string) => graph.edges.find((e) => e.id === id)?.evidence[0];
    expect(get('aws_security_group.tomb_ward->aws_security_group.mansion_gate:allows-ingress')?.data).toEqual({
      rule: 'aws_vpc_security_group_ingress_rule.tomb_from_mansion',
      protocol: 'tcp',
      fromPort: 5432,
      toPort: 5432,
    });
    expect(get('aws_subnet.graveyard->aws_internet_gateway.gate:routes-via')?.data).toMatchObject({ destination: '0.0.0.0/0' });
    // the bucket's public access block turns every setting off in haunted
    expect(get('aws_s3_bucket_public_access_block.crypt->aws_s3_bucket.crypt:guards')?.data).toMatchObject({
      allBlocked: false,
      block_public_acls: false,
    });
  });

  it('haunted: no edge for CIDR rules or a wildcard policy, which have no node to link', () => {
    const { graph } = sample('haunted');
    expect(graph.edges.filter((e) => e.kind === 'allows-egress' || e.kind === 'grants-access')).toEqual([]);
  });

  it('web: semantic edges in both directions, role access, and a fully blocking bucket', () => {
    const { graph } = sample('web');
    const ids = graph.edges.filter((e) => e.assertion === 'inferred').map((e) => e.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'aws_security_group.alb->aws_security_group.app:allows-egress',
        'aws_security_group.app->aws_security_group.alb:allows-ingress',
        'aws_instance.app->aws_iam_role.app:runs-as',
        'aws_iam_role.app->aws_s3_bucket.assets:grants-access',
        'aws_subnet.public_a->aws_internet_gateway.main:routes-via',
        'aws_subnet.public_b->aws_internet_gateway.main:routes-via',
      ]),
    );
    const guard = graph.edges.find((e) => e.kind === 'guards');
    expect(guard?.evidence[0]?.data).toMatchObject({ allBlocked: true });
    const grant = graph.edges.find((e) => e.kind === 'grants-access');
    expect(grant?.evidence[0]?.data?.policy).toBe('aws_iam_role_policy.app_assets');
  });

  it('web: security groups sit under the VPC, listeners under their load balancer', () => {
    const { hierarchy } = sample('web');
    expect(hierarchy.parentOf('aws_security_group.app')).toBe('aws_vpc.main');
    expect(hierarchy.parentOf('aws_lb_listener.http')).toBe('aws_lb.front');
    expect(hierarchy.parentOf('aws_instance.app')).toBe('aws_subnet.public_a');
    expect(hierarchy.parentOf('aws_vpc_security_group_egress_rule.alb_to_app')).toBe('aws_security_group.alb');
  });
});

describe('AWS classification', () => {
  it('gives unknown AWS types a role (unknown) instead of failing', () => {
    for (const type of ['aws_made_up_thing', 'aws_', '', 'constructor', '__proto__', 'toString']) {
      expect(ROLES).toContain(awsRole(type));
    }
    expect(awsRole('aws_made_up_thing')).toBe('unknown');
    expect(awsRole('constructor')).toBe('unknown');
  });

  it('classifies by exact type first, then by prefix', () => {
    expect(awsRole('aws_s3_bucket')).toBe('object-storage');
    expect(awsRole('aws_s3_bucket_public_access_block')).toBe('traffic-filter');
    expect(awsRole('aws_iam_anything_new')).toBe('identity');
    expect(awsRole('aws_vpc_security_group_vpc_association')).toBe('traffic-filter');
    expect(awsRole('aws_vpc')).toBe('network-container');
  });

  const plan = (resources: { type: string; name: string; provider: string; after?: object }[]) => ({
    format_version: '1.2',
    terraform_version: '1.16.0',
    planned_values: { root_module: {} },
    resource_changes: resources.map((r) => ({
      address: `${r.type}.${r.name}`,
      mode: 'managed',
      type: r.type,
      name: r.name,
      provider_name: `registry.terraform.io/hashicorp/${r.provider}`,
      change: { actions: ['create'], before: null, after: r.after ?? {}, after_unknown: {}, before_sensitive: false, after_sensitive: {} },
    })),
    configuration: {
      root_module: {
        resources: [
          {
            address: 'azurerm_storage_account.logs',
            mode: 'managed',
            type: 'azurerm_storage_account',
            name: 'logs',
            expressions: { bucket_hint: { references: ['aws_s3_bucket.data.id', 'aws_s3_bucket.data'] } },
          },
        ],
      },
    },
  });

  it('keeps unknown AWS types and other providers in the tree, with evidence on cross-provider edges', () => {
    const { graph, hierarchy } = ingest(
      plan([
        { type: 'aws_s3_bucket', name: 'data', provider: 'aws', after: { region: 'eu-west-1' } },
        { type: 'aws_made_up_thing', name: 'x', provider: 'aws', after: { region: 'eu-west-1' } },
        { type: 'azurerm_storage_account', name: 'logs', provider: 'azurerm', after: { region: 'x' } },
      ]),
    );
    expect(graph.node('aws_made_up_thing.x')?.role).toBe('unknown');
    expect(graph.node('azurerm_storage_account.logs')?.role).toBe('unknown');
    expect(hierarchy.childrenOf(ROOT_ID)).toEqual(['~provider/aws', '~provider/azure']);
    expect(hierarchy.parentOf('aws_made_up_thing.x')).toBe('~scope/aws/region/eu-west-1');
    expect(hierarchy.parentOf('azurerm_storage_account.logs')).toBe('~global/azure');
    const cross = graph.edges.filter((e) => graph.node(e.from)?.provider !== graph.node(e.to)?.provider);
    expect(cross.map((e) => e.id)).toEqual(['azurerm_storage_account.logs->aws_s3_bucket.data:reference']);
    for (const edge of cross) {
      expect(edge.evidence.length).toBeGreaterThan(0);
      expect(edge.evidence[0]?.data?.reference).toBe('aws_s3_bucket.data.id');
    }
    expectTree(graph, hierarchy);
  });
});
