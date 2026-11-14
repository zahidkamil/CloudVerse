import type { ContainerRule, ProviderAdapter } from './adapter.ts';
import type { Graph } from './graph.ts';
import type { GraphNode } from './model.ts';

/**
 * What a hierarchy node is.
 * - root, provider, scope, global: synthetic groups (not resources)
 * - resource: a graph node
 */
export type HierarchyKind = 'root' | 'provider' | 'scope' | 'global' | 'resource';

export interface HierarchyNode {
  /** Synthetic ids start with `~`, which no Terraform address can. Resource ids are graph node ids. */
  readonly id: string;
  readonly kind: HierarchyKind;
  readonly label: string;
  /** Absent only on the root. */
  readonly parent?: string;
  /** Child ids, sorted. */
  readonly children: readonly string[];
}

/** A tree over a graph: root, providers, scopes (or global), then containers and resources. */
export interface Hierarchy {
  readonly root: string;
  readonly nodes: readonly HierarchyNode[];
  node(id: string): HierarchyNode | undefined;
  parentOf(id: string): string | undefined;
  childrenOf(id: string): readonly string[];
  /** Ids from the root down to `id`, inclusive. Empty if `id` is unknown. */
  pathTo(id: string): readonly string[];
}

export const ROOT_ID = '~root';
const providerId = (provider: string) => `~provider/${provider}`;
const scopeId = (provider: string, kind: string, id: string) => `~scope/${provider}/${kind}/${id}`;
const globalId = (provider: string) => `~global/${provider}`;

/** How far from a resource the search for its container goes, in declared edges. */
const MAX_CONTAINER_DEPTH = 3;

/**
 * Arrange graph nodes into a tree. A resource's parent is the nearest container its
 * adapter lists for its type (found through declared edges), else its scope group, else
 * its provider's global group. Every node except the root has exactly one parent, and
 * the result has no cycles.
 */
export function buildHierarchy(graph: Graph, adapters: readonly ProviderAdapter[] = []): Hierarchy {
  const entries = new Map<string, { kind: HierarchyKind; label: string; parent?: string }>();
  entries.set(ROOT_ID, { kind: 'root', label: 'All infrastructure' });

  /** Create the group a node falls back to, and the provider group above it. */
  const groupFor = (node: GraphNode): string => {
    const provider = providerId(node.provider);
    if (!entries.has(provider)) entries.set(provider, { kind: 'provider', label: node.provider, parent: ROOT_ID });
    if (!node.scope) {
      const id = globalId(node.provider);
      if (!entries.has(id)) entries.set(id, { kind: 'global', label: 'Global', parent: provider });
      return id;
    }
    const id = scopeId(node.provider, node.scope.kind, node.scope.id);
    if (!entries.has(id)) entries.set(id, { kind: 'scope', label: `${node.scope.kind} ${node.scope.id}`, parent: provider });
    return id;
  };

  const sorted = [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const chosen = new Map<string, string>();
  for (const node of sorted) {
    const adapter = adapters.find((candidate) => candidate.id === node.provider);
    const wanted = adapter?.containers?.[node.providerType];
    const container = wanted && wanted.length > 0 ? findContainer(graph, node, wanted) : undefined;
    chosen.set(node.id, container ?? groupFor(node));
  }

  // Cycle guard: cut any chain that loops back on itself.
  for (const node of sorted) {
    const seen = new Set<string>([node.id]);
    let current = chosen.get(node.id);
    while (current !== undefined && chosen.has(current)) {
      if (seen.has(current)) {
        // Only cut loops that pass through this node; other loops are cut when their own members are visited.
        if (current === node.id) chosen.set(node.id, groupFor(node));
        break;
      }
      seen.add(current);
      current = chosen.get(current);
    }
  }

  for (const node of sorted) {
    entries.set(node.id, { kind: 'resource', label: node.label, parent: chosen.get(node.id) as string });
  }

  const children = new Map<string, string[]>();
  for (const [id, entry] of entries) {
    if (entry.parent !== undefined) {
      const list = children.get(entry.parent);
      if (list) list.push(id);
      else children.set(entry.parent, [id]);
    }
  }
  const nodes: HierarchyNode[] = [...entries.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, entry]) =>
      Object.freeze({
        id,
        kind: entry.kind,
        label: entry.label,
        ...(entry.parent !== undefined ? { parent: entry.parent } : {}),
        children: Object.freeze((children.get(id) ?? []).sort()),
      }),
    );
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return Object.freeze({
    root: ROOT_ID,
    nodes: Object.freeze(nodes),
    node: (id: string) => byId.get(id),
    parentOf: (id: string) => byId.get(id)?.parent,
    childrenOf: (id: string) => byId.get(id)?.children ?? [],
    pathTo: (id: string) => {
      const path: string[] = [];
      for (let current = byId.get(id); current; current = current.parent ? byId.get(current.parent) : undefined) {
        path.unshift(current.id);
      }
      return path;
    },
  });
}

/**
 * Try each rule in order; the first that finds a node wins. A rule searches outgoing
 * declared edges breadth-first (nearest first, ties by id). `via` limits the first hop
 * to references made by one attribute.
 */
function findContainer(graph: Graph, start: GraphNode, rules: readonly ContainerRule[]): string | undefined {
  for (const rule of rules) {
    const seen = new Set<string>([start.id]);
    let frontier = [start.id];
    for (let depth = 1; depth <= MAX_CONTAINER_DEPTH; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const edge of graph.outgoing(id)) {
          if (edge.assertion !== 'declared' || seen.has(edge.to)) continue;
          if (depth === 1 && rule.via !== undefined && !edge.evidence.some((e) => e.data?.path === rule.via)) continue;
          seen.add(edge.to);
          next.push(edge.to);
        }
      }
      next.sort();
      const hit = next.find((id) => graph.node(id)?.providerType === rule.type);
      if (hit !== undefined) return hit;
      frontier = next;
    }
  }
  return undefined;
}
