import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGraph, GraphError } from './graph.ts';
import type { GraphEdge, GraphNode } from './model.ts';

const node = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  address: id,
  baseAddress: id,
  provider: 'aws',
  providerType: 'aws_thing',
  name: id,
  label: id,
  role: 'unknown',
  actions: ['create'],
  attrs: {},
  ...extra,
});

const edge = (from: string, to: string, kind = 'reference', evidence = [{ kind, summary: `${from} -> ${to}` }]): GraphEdge => ({
  id: `${from}->${to}:${kind}`,
  from,
  to,
  kind,
  assertion: 'declared',
  evidence,
});

describe('createGraph', () => {
  it('stores nodes and edges and answers lookups', () => {
    const graph = createGraph([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('a', 'c'), edge('b', 'c')]);
    expect(graph.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(graph.node('b')?.id).toBe('b');
    expect(graph.node('zzz')).toBeUndefined();
    expect(graph.outgoing('a').map((e) => e.to)).toEqual(['b', 'c']);
    expect(graph.incoming('c').map((e) => e.from)).toEqual(['a', 'b']);
    expect(graph.outgoing('c')).toEqual([]);
    expect(graph.incoming('unknown')).toEqual([]);
  });

  it('rejects duplicate node ids', () => {
    expect(() => createGraph([node('a'), node('a')], [])).toThrow(GraphError);
    expect(() => createGraph([node('a'), node('a')], [])).toThrow(/Duplicate node id: a/);
  });

  it('rejects duplicate edge ids', () => {
    expect(() => createGraph([node('a'), node('b')], [edge('a', 'b'), edge('a', 'b')])).toThrow(/Duplicate edge id/);
  });

  it('rejects edges to or from unknown nodes', () => {
    expect(() => createGraph([node('a')], [edge('a', 'missing')])).toThrow(/unknown node missing/);
    expect(() => createGraph([node('a')], [edge('missing', 'a')])).toThrow(/unknown node missing/);
  });

  it('rejects an edge with no evidence', () => {
    expect(() => createGraph([node('a'), node('b')], [edge('a', 'b', 'reference', [])])).toThrow(/no evidence/);
  });

  it('deeply freezes everything', () => {
    const graph = createGraph([node('a', { attrs: { tags: { Name: 'x' }, list: [1, 2] } }), node('b')], [edge('a', 'b')]);
    expect(Object.isFrozen(graph)).toBe(true);
    expect(Object.isFrozen(graph.nodes)).toBe(true);
    expect(Object.isFrozen(graph.nodes[0])).toBe(true);
    expect(Object.isFrozen(graph.nodes[0]?.attrs)).toBe(true);
    expect(Object.isFrozen((graph.nodes[0]?.attrs.tags as object))).toBe(true);
    expect(Object.isFrozen(graph.edges[0]?.evidence[0])).toBe(true);
    expect(() => {
      (graph.nodes[0] as { label: string }).label = 'changed';
    }).toThrow(TypeError);
    expect(() => {
      (graph.nodes[0]?.attrs.list as number[]).push(3);
    }).toThrow(TypeError);
  });

  it('copies its inputs so later changes cannot affect the graph', () => {
    const source = node('a', { attrs: { size: 1 } });
    const graph = createGraph([source], []);
    (source.attrs as Record<string, unknown>).size = 99;
    expect(graph.node('a')?.attrs.size).toBe(1);
  });
});

describe('graph properties', () => {
  // P2 + P6: for any valid graph, indexes agree with the edge list and nothing dangles.
  const graphArb = fc
    .integer({ min: 1, max: 12 })
    .chain((n) =>
      fc.record({
        n: fc.constant(n),
        pairs: fc.uniqueArray(fc.tuple(fc.nat({ max: n - 1 }), fc.nat({ max: n - 1 })), {
          selector: ([a, b]) => `${a}-${b}`,
          maxLength: 30,
        }),
      }),
    );

  it('keeps indexes consistent with the edge list (P6) and every edge evidenced and valid (P2)', () => {
    fc.assert(
      fc.property(graphArb, ({ n, pairs }) => {
        const nodes = Array.from({ length: n }, (_, i) => node(`n${i}`));
        const edges = pairs.map(([a, b]) => edge(`n${a}`, `n${b}`));
        const graph = createGraph(nodes, edges);

        const outgoing = graph.nodes.reduce((sum, nd) => sum + graph.outgoing(nd.id).length, 0);
        const incoming = graph.nodes.reduce((sum, nd) => sum + graph.incoming(nd.id).length, 0);
        expect(outgoing).toBe(graph.edges.length);
        expect(incoming).toBe(graph.edges.length);

        const ids = new Set(graph.nodes.map((nd) => nd.id));
        expect(ids.size).toBe(graph.nodes.length);
        for (const e of graph.edges) {
          expect(ids.has(e.from)).toBe(true);
          expect(ids.has(e.to)).toBe(true);
          expect(e.evidence.length).toBeGreaterThan(0);
        }
      }),
    );
  });
});
