import type { Graph } from './graph.ts';
import type { Hierarchy } from './hierarchy.ts';

/** A stable, readable text form of a graph and its hierarchy, for the CLI and golden files. */
export interface GraphSummary {
  /** One line per hierarchy node, indented by depth. Resources show `[role]`. */
  readonly tree: readonly string[];
  /** One line per edge, sorted: `from -[kind/assertion]-> to`. */
  readonly edges: readonly string[];
}

export function summarizeGraph(graph: Graph, hierarchy: Hierarchy): GraphSummary {
  const tree: string[] = [];
  const walk = (id: string, depth: number) => {
    const node = hierarchy.node(id);
    if (!node) return;
    const role = node.kind === 'resource' ? ` [${graph.node(id)?.role ?? 'unknown'}]` : '';
    tree.push(`${'  '.repeat(depth)}${node.kind === 'resource' ? id : `${id} (${node.label})`}${role}`);
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(hierarchy.root, 0);
  const edges = graph.edges.map((edge) => `${edge.from} -[${edge.kind}/${edge.assertion}]-> ${edge.to}`).sort();
  return { tree, edges };
}
