import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ingestPlan, ingestPlanObject } from './ingest.ts';
import { IngestError } from './plan.ts';
import { addressOf, makePlan, type ResSpec } from './plan-builder.test-util.ts';

const PROVIDERS = [
  'registry.terraform.io/hashicorp/aws',
  'registry.terraform.io/hashicorp/azurerm',
  'registry.terraform.io/hashicorp/google',
];

/**
 * A random acyclic set of resources: resource i may reference only resources j < i, each
 * with 1 to 2 instances. Returns the specs and the exact edge ids we expect.
 */
const planArb = fc
  .integer({ min: 1, max: 8 })
  .chain((count) =>
    fc.tuple(
      fc.array(fc.integer({ min: 1, max: 2 }), { minLength: count, maxLength: count }),
      fc.array(fc.constantFrom(...PROVIDERS), { minLength: count, maxLength: count }),
      fc.array(fc.array(fc.tuple(fc.nat(), fc.constantFrom('id', '', 'arn')), { maxLength: 3 }), { minLength: count, maxLength: count }),
    ),
  )
  .map(([instanceCounts, providers, refChoices]) => {
    const specs: ResSpec[] = [];
    const expected = new Set<string>();
    const ids: string[][] = [];

    instanceCounts.forEach((instances, i) => {
      const refs: Record<string, string[]> = {};
      const wanted = new Set<number>();
      (refChoices[i] ?? []).forEach(([pick, attr], k) => {
        if (i === 0) return;
        const target = pick % i; // always an earlier resource, so no cycles
        wanted.add(target);
        // Terraform lists both `t.r1.id` and `t.r1` for an attribute reference.
        refs[`attr${k}`] = attr === '' ? [`t.r${target}`] : [`t.r${target}.${attr}`, `t.r${target}`];
      });

      ids[i] = [];
      for (let n = 0; n < instances; n++) {
        const spec: ResSpec = {
          type: 't',
          name: `r${i}`,
          provider: providers[i] ?? PROVIDERS[0]!,
          refs,
          ...(instances > 1 ? { index: n } : {}),
        };
        specs.push(spec);
        ids[i]!.push(addressOf(spec));
      }
      for (const target of wanted) {
        for (const from of ids[i]!) for (const to of ids[target]!) expected.add(`${from}->${to}:reference`);
      }
    });
    return { specs, expected };
  });

describe('ingest properties', () => {
  it('P1: edges equal exactly the declared references', () => {
    fc.assert(
      fc.property(planArb, ({ specs, expected }) => {
        const { graph } = ingestPlanObject(makePlan(specs));
        expect(new Set(graph.edges.map((e) => e.id))).toEqual(expected);
        expect(graph.edges).toHaveLength(expected.size);
      }),
    );
  });

  it('P2: every edge has evidence and valid endpoints, and node ids are unique', () => {
    fc.assert(
      fc.property(planArb, ({ specs }) => {
        const { graph } = ingestPlanObject(makePlan(specs));
        const ids = new Set(graph.nodes.map((n) => n.id));
        expect(ids.size).toBe(graph.nodes.length);
        for (const edge of graph.edges) {
          expect(edge.evidence.length).toBeGreaterThan(0);
          expect(edge.assertion).toBe('declared');
          expect(ids.has(edge.from) && ids.has(edge.to)).toBe(true);
          expect(edge.from).not.toBe(edge.to);
        }
      }),
    );
  });

  it('P2b: cross-provider edges exist only where a reference declares them', () => {
    fc.assert(
      fc.property(planArb, ({ specs, expected }) => {
        const { graph } = ingestPlanObject(makePlan(specs));
        for (const edge of graph.edges) {
          if (graph.node(edge.from)?.provider !== graph.node(edge.to)?.provider) {
            expect(expected.has(edge.id)).toBe(true);
            expect(edge.evidence.every((e) => e.kind === 'reference' && e.summary.includes('references'))).toBe(true);
          }
        }
      }),
    );
  });

  it('P4: any string either yields a graph or an IngestError', async () => {
    const inputs = fc.oneof(
      fc.string(),
      fc.jsonValue().map((value) => JSON.stringify(value)),
      fc.json(),
    );
    await fc.assert(
      fc.asyncProperty(inputs, async (input) => {
        try {
          const result = await ingestPlan(input);
          expect(result.graph).toBeDefined();
        } catch (error) {
          expect(error).toBeInstanceOf(IngestError);
        }
      }),
    );
  });

  it('P4b: mutated real-looking plans still only fail with IngestError', async () => {
    const base = makePlan([
      { type: 't', name: 'a', refs: { x: ['t.b.id'] } },
      { type: 't', name: 'b' },
    ]);
    const mutate = fc.tuple(
      fc.constantFrom('resource_changes', 'configuration', 'format_version', 'terraform_version'),
      fc.jsonValue(),
    );
    await fc.assert(
      fc.asyncProperty(mutate, async ([key, value]) => {
        try {
          await ingestPlan({ ...base, [key]: value });
        } catch (error) {
          expect(error).toBeInstanceOf(IngestError);
        }
      }),
    );
  });
});
