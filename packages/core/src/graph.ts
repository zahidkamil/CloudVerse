import type { GraphEdge, GraphNode } from './model.ts';

/** Thrown when nodes and edges do not form a valid graph. */
export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphError';
  }
}

/** An immutable graph with lookups. Build one with {@link createGraph}. */
export interface Graph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  node(id: string): GraphNode | undefined;
  outgoing(id: string): readonly GraphEdge[];
  incoming(id: string): readonly GraphEdge[];
}

const NONE: readonly GraphEdge[] = Object.freeze([]);

/**
 * Validate and freeze nodes and edges into a graph.
 *
 * Rejects duplicate node ids, duplicate edge ids, edges whose endpoints are not
 * nodes, and edges without evidence. Inputs are copied, so later changes to them
 * cannot affect the graph.
 */
export function createGraph(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Graph {
  const frozenNodes = nodes.map((node) => deepFreeze(structuredCopy(node)));
  const frozenEdges = edges.map((edge) => deepFreeze(structuredCopy(edge)));

  const byId = new Map<string, GraphNode>();
  for (const node of frozenNodes) {
    if (byId.has(node.id)) throw new GraphError(`Duplicate node id: ${node.id}`);
    byId.set(node.id, node);
  }

  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();
  const edgeIds = new Set<string>();
  for (const edge of frozenEdges) {
    if (edgeIds.has(edge.id)) throw new GraphError(`Duplicate edge id: ${edge.id}`);
    edgeIds.add(edge.id);
    if (!byId.has(edge.from)) throw new GraphError(`Edge ${edge.id} starts at unknown node ${edge.from}`);
    if (!byId.has(edge.to)) throw new GraphError(`Edge ${edge.id} ends at unknown node ${edge.to}`);
    if (edge.evidence.length === 0) throw new GraphError(`Edge ${edge.id} has no evidence`);
    push(outgoing, edge.from, edge);
    push(incoming, edge.to, edge);
  }

  return Object.freeze({
    nodes: Object.freeze(frozenNodes),
    edges: Object.freeze(frozenEdges),
    node: (id: string) => byId.get(id),
    outgoing: (id: string) => outgoing.get(id) ?? NONE,
    incoming: (id: string) => incoming.get(id) ?? NONE,
  });
}

function push(map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge): void {
  const list = map.get(key);
  if (list) list.push(edge);
  else map.set(key, [edge]);
}

/** Copy plain JSON-like data. Graph data never contains functions or class instances. */
function structuredCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(structuredCopy) as T;
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) copy[key] = structuredCopy(entry);
    return copy as T;
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}
