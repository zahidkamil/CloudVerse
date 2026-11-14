import { ingestPlanObject, validatePlan } from '@cloudverse/core';
import { getSample, samples } from '@cloudverse/samples';
import { describe, expect, it } from 'vitest';
import { awsAdapter } from './index.ts';

// Runs in jsdom with the real Terraform-generated sample plans.
type RawPlan = {
  resource_changes: { address: string; mode: string }[];
  configuration: { root_module: { resources: { address: string; expressions?: unknown; depends_on?: string[] }[] } };
};

/**
 * Independent recomputation of the expected edges straight from the raw JSON, written
 * differently from the core implementation on purpose: any `references` string whose
 * first two dot-separated parts name a resource in the plan is an edge.
 */
function expectedEdges(raw: RawPlan): Set<string> {
  const known = new Set(raw.resource_changes.filter((c) => c.mode === 'managed').map((c) => c.address));
  const found = new Set<string>();
  const strings = (value: unknown, out: string[] = []): string[] => {
    if (Array.isArray(value)) value.forEach((v) => strings(v, out));
    else if (value && typeof value === 'object') {
      for (const [key, v] of Object.entries(value)) {
        if (key === 'references' && Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === 'string'));
        else strings(v, out);
      }
    }
    return out;
  };
  for (const resource of raw.configuration.root_module.resources) {
    for (const reference of [...strings(resource.expressions), ...(resource.depends_on ?? [])]) {
      const target = reference.split('.').slice(0, 2).join('.');
      if (known.has(target) && target !== resource.address) found.add(`${resource.address}->${target}`);
    }
  }
  return found;
}

describe('AWS adapter with the sample plans', () => {
  it('has samples to test', () => {
    expect(samples.length).toBeGreaterThanOrEqual(2);
  });

  for (const sample of samples) {
    describe(sample.id, () => {
      const raw = sample.plan as RawPlan;
      const { graph, diagnostics } = ingestPlanObject(sample.plan, { adapters: [awsAdapter] });

      it('is a valid plan', () => {
        expect(validatePlan(sample.plan)).toEqual([]);
      });

      it('creates one AWS node per resource, with no diagnostics', () => {
        expect(graph.nodes).toHaveLength(raw.resource_changes.length);
        expect(graph.nodes.every((n) => n.provider === 'aws')).toBe(true);
        expect(diagnostics).toEqual([]);
      });

      it('scopes regional resources to their region and leaves global IAM resources unscoped', () => {
        for (const node of graph.nodes) {
          if (node.providerType.startsWith('aws_iam_')) {
            expect(node.scope, node.id).toBeUndefined(); // IAM is global: it has no region
          } else {
            expect(node.scope, node.id).toEqual({ kind: 'region', id: 'us-east-1' });
          }
        }
      });

      it('matches an independent recomputation of every declared reference (P1)', () => {
        const actual = new Set(graph.edges.filter((e) => e.kind === 'reference').map((e) => `${e.from}->${e.to}`));
        expect(actual).toEqual(expectedEdges(raw));
        expect(actual.size).toBeGreaterThan(10);
      });

      it('gives every edge evidence; reference edges stay declared, rule edges are inferred', () => {
        for (const edge of graph.edges) {
          expect(edge.assertion).toBe(edge.kind === 'reference' || edge.kind === 'depends_on' ? 'declared' : 'inferred');
          expect(edge.evidence.length).toBeGreaterThan(0);
        }
      });

      it('is immutable', () => {
        expect(Object.isFrozen(graph)).toBe(true);
        expect(Object.isFrozen(graph.nodes[0]?.attrs)).toBe(true);
      });
    });
  }

  it('haunted: connects the web server to its subnet, security group, and instance profile', () => {
    const { graph } = ingestPlanObject(getSample('haunted')?.plan, { adapters: [awsAdapter] });
    const targets = graph.outgoing('aws_instance.mansion').map((e) => e.to);
    expect(targets).toEqual(
      expect.arrayContaining(['aws_subnet.graveyard', 'aws_security_group.mansion_gate', 'aws_iam_instance_profile.mansion']),
    );
    expect(graph.node('aws_instance.mansion')?.label).toBe('haunted-mansion');
    expect(graph.node('aws_instance.mansion')?.scope).toEqual({ kind: 'region', id: 'us-east-1' });
  });

  it('haunted: links the database rule to both security groups', () => {
    const { graph } = ingestPlanObject(getSample('haunted')?.plan, { adapters: [awsAdapter] });
    const rule = 'aws_vpc_security_group_ingress_rule.tomb_from_mansion';
    expect(graph.outgoing(rule).map((e) => e.to).sort()).toEqual(['aws_security_group.mansion_gate', 'aws_security_group.tomb_ward']);
  });

  it('web: follows references inside nested blocks', () => {
    const { graph } = ingestPlanObject(getSample('web')?.plan, { adapters: [awsAdapter] });
    const edge = graph.edges.find((e) => e.from === 'aws_lb_listener.http' && e.to === 'aws_lb_target_group.app');
    expect(edge?.evidence[0]?.summary).toBe('aws_lb_listener.http default_action[0].target_group_arn references aws_lb_target_group.app.arn');
  });

  it('works without the adapter too, with generic nodes', () => {
    const { graph } = ingestPlanObject(getSample('haunted')?.plan);
    expect(graph.nodes.every((n) => n.scope === undefined && n.role === 'unknown')).toBe(true);
    const withAdapter = ingestPlanObject(getSample('haunted')?.plan, { adapters: [awsAdapter] }).graph;
    expect(graph.edges.every((e) => e.assertion === 'declared')).toBe(true);
    expect(withAdapter.edges.filter((e) => e.assertion === 'declared').map((e) => e.id)).toEqual(graph.edges.map((e) => e.id));
  });
});
