import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ProviderAdapter } from './adapter.ts';
import { GraphError } from './graph.ts';
import { ROOT_ID, type Hierarchy } from './hierarchy.ts';
import { ingestPlanObject } from './ingest.ts';
import { ROLE_DESCRIPTIONS, ROLES } from './model.ts';
import { makePlan, type ResSpec } from './plan-builder.test-util.ts';

// Runs in jsdom, as a browser would. Uses a tiny fake adapter so core is tested without any
// real provider.

const AZURE = 'registry.terraform.io/hashicorp/azurerm';

const fake: ProviderAdapter = {
  id: 'aws',
  describe: ({ values }) => ({
    role: 'unknown',
    ...(typeof values.region === 'string' ? { scope: { kind: 'region', id: values.region } } : {}),
  }),
  containers: {
    leaf: [{ type: 'mid', via: 'mid_id' }, { type: 'top' }],
    mid: [{ type: 'top' }],
  },
};

const region = { region: 'r1' };
const specs = (...list: ResSpec[]) => list;

/** Every structural rule the spec promises, checked on any hierarchy. */
function expectInvariants(hierarchy: Hierarchy, nodeIds: readonly string[]): void {
  const ids = hierarchy.nodes.map((n) => n.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of nodeIds) expect(ids.filter((x) => x === id)).toHaveLength(1);
  for (const node of hierarchy.nodes) {
    if (node.id === ROOT_ID) {
      expect(node.parent).toBeUndefined();
      continue;
    }
    // exactly one parent, which exists and lists this node as a child
    const parent = hierarchy.node(node.parent ?? '');
    expect(parent, node.id).toBeDefined();
    expect(parent?.children).toContain(node.id);
    expect(hierarchy.nodes.filter((other) => other.children.includes(node.id))).toHaveLength(1);
    // acyclic: walking up reaches the root within the number of nodes
    let current: string | undefined = node.id;
    let steps = 0;
    while (current !== undefined && current !== ROOT_ID) {
      current = hierarchy.parentOf(current);
      expect(++steps).toBeLessThanOrEqual(ids.length);
    }
    expect(current).toBe(ROOT_ID);
    expect(hierarchy.pathTo(node.id)[0]).toBe(ROOT_ID);
    expect(hierarchy.pathTo(node.id).at(-1)).toBe(node.id);
    const sorted = [...node.children].sort();
    expect(node.children).toEqual(sorted);
  }
}

describe('hierarchy', () => {
  it('groups by provider, then scope, then falls back to a Global group', () => {
    const { graph, hierarchy } = ingestPlanObject(
      makePlan(specs({ type: 'a', name: 'x', after: region }, { type: 'a', name: 'y' })),
      { adapters: [fake] },
    );
    expect(hierarchy.parentOf('a.x')).toBe('~scope/aws/region/r1');
    expect(hierarchy.parentOf('a.y')).toBe('~global/aws');
    expect(hierarchy.parentOf('~scope/aws/region/r1')).toBe('~provider/aws');
    expect(hierarchy.parentOf('~provider/aws')).toBe(ROOT_ID);
    expect(hierarchy.node('~global/aws')?.label).toBe('Global');
    expectInvariants(hierarchy, graph.nodes.map((n) => n.id));
  });

  it('keeps providers apart, and works without any adapter', () => {
    const { graph, hierarchy } = ingestPlanObject(
      makePlan(specs({ type: 'a', name: 'x' }, { type: 'vm', name: 'y', provider: AZURE })),
    );
    expect(hierarchy.childrenOf(ROOT_ID)).toEqual(['~provider/aws', '~provider/azure']);
    expect(hierarchy.parentOf('vm.y')).toBe('~global/azure');
    expectInvariants(hierarchy, graph.nodes.map((n) => n.id));
  });

  it('puts a resource under the nearest container, found through declared edges', () => {
    const { hierarchy } = ingestPlanObject(
      makePlan(
        specs(
          { type: 'top', name: 't', after: region },
          { type: 'mid', name: 'm', after: region, refs: { top_id: ['top.t'] } },
          { type: 'leaf', name: 'l', after: region, refs: { mid_id: ['mid.m'] } },
        ),
      ),
      { adapters: [fake] },
    );
    expect(hierarchy.pathTo('leaf.l')).toEqual([ROOT_ID, '~provider/aws', '~scope/aws/region/r1', 'top.t', 'mid.m', 'leaf.l']);
    expect(hierarchy.parentOf('leaf.l')).toBe('mid.m');
    expect(hierarchy.parentOf('mid.m')).toBe('top.t');
    expect(hierarchy.parentOf('top.t')).toBe('~scope/aws/region/r1');
  });

  it('uses `via` to choose between several references of the same type', () => {
    const { hierarchy } = ingestPlanObject(
      makePlan(
        specs(
          { type: 'mid', name: 'a', after: region },
          { type: 'mid', name: 'b', after: region },
          { type: 'leaf', name: 'l', after: region, refs: { other: ['mid.a'], mid_id: ['mid.b'] } },
        ),
      ),
      { adapters: [fake] },
    );
    expect(hierarchy.parentOf('leaf.l')).toBe('mid.b');
  });

  it('tries container rules in order and falls back to the next', () => {
    const { hierarchy } = ingestPlanObject(
      makePlan(specs({ type: 'top', name: 't', after: region }, { type: 'leaf', name: 'l', after: region, refs: { x: ['top.t'] } })),
      { adapters: [fake] },
    );
    expect(hierarchy.parentOf('leaf.l')).toBe('top.t'); // no mid reachable; the second rule wins
  });

  it('ignores a container that is too far away (more than three declared edges)', () => {
    const { hierarchy } = ingestPlanObject(
      makePlan(
        specs(
          { type: 'top', name: 't', after: region },
          { type: 'p', name: 'p1', after: region, refs: { x: ['top.t'] } },
          { type: 'p', name: 'p2', after: region, refs: { x: ['p.p1'] } },
          { type: 'p', name: 'p3', after: region, refs: { x: ['p.p2'] } },
          { type: 'leaf', name: 'l', after: region, refs: { x: ['p.p3'] } },
        ),
      ),
      { adapters: [fake] },
    );
    expect(hierarchy.parentOf('leaf.l')).toBe('~scope/aws/region/r1');
  });

  it('is deterministic and independent of the order of resources in the plan', () => {
    const list = specs(
      { type: 'top', name: 't', after: region },
      { type: 'mid', name: 'm', after: region, refs: { top_id: ['top.t'] } },
      { type: 'leaf', name: 'l' },
    );
    const first = ingestPlanObject(makePlan(list), { adapters: [fake] }).hierarchy;
    const again = ingestPlanObject(makePlan(list), { adapters: [fake] }).hierarchy;
    const reversed = ingestPlanObject(makePlan([...list].reverse()), { adapters: [fake] }).hierarchy;
    expect(again.nodes).toEqual(first.nodes);
    expect(reversed.nodes).toEqual(first.nodes);
  });

  it('never produces a cycle, even when references and container rules loop', () => {
    const looping: ProviderAdapter = {
      ...fake,
      containers: { a: [{ type: 'b' }], b: [{ type: 'a' }] },
    };
    const { graph, hierarchy } = ingestPlanObject(
      makePlan(
        specs(
          { type: 'a', name: 'one', after: region, refs: { x: ['b.two'] } },
          { type: 'b', name: 'two', after: region, refs: { x: ['a.one'] } },
          { type: 'a', name: 'three', after: region, refs: { x: ['a.one'] } },
        ),
      ),
      { adapters: [looping] },
    );
    expectInvariants(hierarchy, graph.nodes.map((n) => n.id));
  });

  it('keeps synthetic ids apart from Terraform addresses', () => {
    const { hierarchy } = ingestPlanObject(makePlan(specs({ type: 'a', name: 'x', after: region })), { adapters: [fake] });
    for (const node of hierarchy.nodes) {
      expect(node.kind === 'resource' ? !node.id.startsWith('~') : node.id.startsWith('~')).toBe(true);
    }
  });

  it('is frozen', () => {
    const { hierarchy } = ingestPlanObject(makePlan(specs({ type: 'a', name: 'x' })), { adapters: [fake] });
    expect(Object.isFrozen(hierarchy)).toBe(true);
    expect(Object.isFrozen(hierarchy.nodes)).toBe(true);
    expect(hierarchy.pathTo('nope')).toEqual([]);
  });
});

describe('hierarchy properties', () => {
  const planArb = fc
    .integer({ min: 1, max: 9 })
    .chain((count) =>
      fc.tuple(
        fc.array(fc.constantFrom('a', 'b', 'c'), { minLength: count, maxLength: count }),
        fc.array(fc.constantFrom('aws', 'azure', 'other'), { minLength: count, maxLength: count }),
        fc.array(fc.boolean(), { minLength: count, maxLength: count }),
        // any resource may reference any other, so reference cycles are possible
        fc.array(fc.array(fc.nat(), { maxLength: 3 }), { minLength: count, maxLength: count }),
      ),
    )
    .map(([types, providers, scoped, refs]) =>
      types.map<ResSpec>((type, i) => ({
        type,
        name: `r${i}`,
        provider: `registry.terraform.io/hashicorp/${providers[i] === 'azure' ? 'azurerm' : providers[i]}`,
        ...(scoped[i] ? { after: region } : {}),
        refs: Object.fromEntries((refs[i] ?? []).map((pick, k) => [`attr${k}`, [`${types[pick % types.length]}.r${pick % types.length}`]])),
      })),
    );

  const adapters: ProviderAdapter[] = [
    { ...fake, containers: { a: [{ type: 'b' }, { type: 'c' }], b: [{ type: 'a' }], c: [{ type: 'c' }, { type: 'a' }] } },
  ];

  it('P1/P2: one parent each, acyclic, complete, sorted', () => {
    fc.assert(
      fc.property(planArb, (list) => {
        const { graph, hierarchy } = ingestPlanObject(makePlan(list), { adapters });
        expectInvariants(hierarchy, graph.nodes.map((n) => n.id));
      }),
    );
  });

  it('P6: the same plan gives the same hierarchy', () => {
    fc.assert(
      fc.property(planArb, (list) => {
        const one = ingestPlanObject(makePlan(list), { adapters }).hierarchy;
        const two = ingestPlanObject(makePlan([...list].reverse()), { adapters }).hierarchy;
        expect(two.nodes).toEqual(one.nodes);
      }),
    );
  });
});

describe('derived edges', () => {
  const rules: ProviderAdapter = {
    ...fake,
    relate: (graph) => {
      const from = graph.node('a.x');
      const to = graph.node('b.y');
      return from && to
        ? [
            { from: from.id, to: to.id, kind: 'works-with', evidence: [{ kind: 'rule', summary: 'first' }] },
            { from: from.id, to: to.id, kind: 'works-with', evidence: [{ kind: 'rule', summary: 'second' }] },
            { from: from.id, to: from.id, kind: 'works-with', evidence: [{ kind: 'rule', summary: 'self' }] },
          ]
        : [];
    },
  };
  const plan = () => makePlan(specs({ type: 'a', name: 'x', refs: { r: ['b.y'] } }, { type: 'b', name: 'y' }));

  it('adds inferred edges with evidence, merges duplicates, drops self edges', () => {
    const { graph } = ingestPlanObject(plan(), { adapters: [rules] });
    const derived = graph.edges.filter((e) => e.assertion === 'inferred');
    expect(derived.map((e) => e.id)).toEqual(['a.x->b.y:works-with']);
    expect(derived[0]?.evidence.map((e) => e.summary)).toEqual(['first', 'second']);
  });

  it('P4: leaves declared edges exactly as they were', () => {
    const without = ingestPlanObject(plan(), { adapters: [fake] }).graph.edges;
    const withRules = ingestPlanObject(plan(), { adapters: [rules] }).graph.edges.filter((e) => e.assertion === 'declared');
    expect(withRules).toEqual(without);
    expect(withRules[0]?.evidence[0]?.data).toMatchObject({ path: 'r', expanded: false });
  });

  it('carries the `expanded` marker of declared edges through derivation', () => {
    const { graph } = ingestPlanObject(
      makePlan(specs({ type: 'a', name: 'x', index: 0, refs: { r: ['b.y'] } }, { type: 'a', name: 'x', index: 1, refs: { r: ['b.y'] } }, { type: 'b', name: 'y' })),
      { adapters: [rules] },
    );
    const declared = graph.edges.filter((e) => e.assertion === 'declared');
    expect(declared).toHaveLength(2);
    expect(declared.every((e) => e.evidence[0]?.data?.expanded === true)).toBe(true);
  });

  it('P3: refuses a derived edge without evidence rather than hiding it', () => {
    const bad: ProviderAdapter = {
      ...fake,
      relate: () => [{ from: 'a.x', to: 'b.y', kind: 'claims', evidence: [] }],
    };
    expect(() => ingestPlanObject(plan(), { adapters: [bad] })).toThrow(GraphError);
  });

  it('keeps cross-provider edges, each with evidence', () => {
    const cross: ProviderAdapter = {
      ...fake,
      relate: (graph) => [
        { from: 'a.x', to: 'vm.y', kind: 'linked', evidence: [{ kind: 'explicit', summary: `${graph.nodes.length} nodes` }] },
      ],
    };
    const { graph } = ingestPlanObject(makePlan(specs({ type: 'a', name: 'x' }, { type: 'vm', name: 'y', provider: AZURE })), {
      adapters: [cross],
    });
    const edge = graph.edges.find((e) => e.kind === 'linked');
    expect(graph.node(edge?.from ?? '')?.provider).not.toBe(graph.node(edge?.to ?? '')?.provider);
    expect(edge?.evidence.length).toBeGreaterThan(0);
  });
});

describe('roles', () => {
  it('describes every role', () => {
    for (const role of ROLES) expect(ROLE_DESCRIPTIONS[role].length).toBeGreaterThan(0);
    expect(Object.keys(ROLE_DESCRIPTIONS).sort()).toEqual([...ROLES].sort());
  });

  it('gives resources from providers without an adapter the role unknown', () => {
    const { graph } = ingestPlanObject(makePlan(specs({ type: 'vm', name: 'y', provider: AZURE })));
    expect(graph.nodes[0]?.role).toBe('unknown');
  });
});
