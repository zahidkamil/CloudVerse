import { genericAdapter, providerIdFromName, type ProviderAdapter } from './adapter.ts';
import { collectReferences, resolveReference, stripIndexes } from './addresses.ts';
import { createGraph, type Graph } from './graph.ts';
import { buildHierarchy, type Hierarchy } from './hierarchy.ts';
import type { Evidence, GraphEdge, GraphNode } from './model.ts';
import { IngestError, parsePlan, type PlanConfigModule, type TerraformPlan } from './plan.ts';
import { redactSensitive } from './redact.ts';

export interface IngestOptions {
  /** Adapters for the providers you support. Others use the generic fallback. */
  readonly adapters?: readonly ProviderAdapter[];
  /** Remove sensitive values before building the graph. Default: true. */
  readonly redact?: boolean;
}

/** Something odd but not fatal, e.g. a reference that points outside the plan. */
export interface Diagnostic {
  readonly code: 'unresolved-reference' | 'module-output-reference';
  readonly message: string;
}

export interface IngestResult {
  readonly graph: Graph;
  /** Provider, scope and container tree over the graph's nodes. */
  readonly hierarchy: Hierarchy;
  readonly diagnostics: readonly Diagnostic[];
  readonly terraformVersion: string;
}

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined;

/**
 * Build a graph from a Terraform plan given as a JSON string, a `Blob`/`File`, or an
 * already-parsed object. Throws {@link IngestError} (and nothing else) if the input
 * cannot be used.
 */
export async function ingestPlan(input: string | Blob | object, options: IngestOptions = {}): Promise<IngestResult> {
  if (typeof input === 'string') return ingestPlanObject(parseJson(input), options);
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return ingestPlanObject(parseJson(await input.text()), options);
  }
  return ingestPlanObject(input, options);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new IngestError('invalid-json', `The file is not valid JSON (${reason}).`);
  }
}

/** Synchronous variant for data that is already parsed. */
export function ingestPlanObject(value: unknown, options: IngestOptions = {}): IngestResult {
  const parsed = parsePlan(value);
  const plan = options.redact === false ? parsed : redactSensitive(parsed);
  const adapters = options.adapters ?? [];

  const { nodes, instances } = buildNodes(plan, adapters);
  const diagnostics: Diagnostic[] = [];
  const edges = buildEdges(plan.configuration.root_module, instances, diagnostics);

  const graph = addDerivedEdges(createGraph(nodes, edges), adapters);
  return {
    graph,
    hierarchy: buildHierarchy(graph, adapters),
    diagnostics,
    terraformVersion: plan.terraform_version,
  };
}

/**
 * Ask each adapter for inferred edges and add them. Declared edges are copied as they
 * are; derived edges with the same id merge their evidence.
 */
function addDerivedEdges(declared: Graph, adapters: readonly ProviderAdapter[]): Graph {
  const derived = new Map<string, GraphEdge & { evidence: Evidence[] }>();
  for (const adapter of adapters) {
    for (const edge of adapter.relate?.(declared) ?? []) {
      if (edge.from === edge.to) continue;
      const id = `${edge.from}->${edge.to}:${edge.kind}`;
      const existing = derived.get(id);
      if (existing) existing.evidence.push(...edge.evidence);
      else derived.set(id, { id, from: edge.from, to: edge.to, kind: edge.kind, assertion: 'inferred', evidence: [...edge.evidence] });
    }
  }
  if (derived.size === 0) return declared;
  return createGraph(declared.nodes, [...declared.edges, ...derived.values()]);
}

function buildNodes(plan: TerraformPlan, adapters: readonly ProviderAdapter[]) {
  const nodes: GraphNode[] = [];
  /** configuration address -> ids of every instance */
  const instances = new Map<string, string[]>();

  for (const change of plan.resource_changes) {
    if (change.mode === 'data') continue;

    const provider = providerIdFromName(change.provider_name);
    const adapter = adapters.find((candidate) => candidate.id === provider) ?? genericAdapter;
    const values = asRecord(change.change.after) ?? asRecord(change.change.before) ?? {};
    const description = adapter.describe({
      address: change.address,
      type: change.type,
      name: change.name,
      provider,
      values,
    });

    const baseAddress = stripIndexes(change.address);
    nodes.push({
      id: change.address,
      address: change.address,
      baseAddress,
      provider,
      providerType: change.type,
      name: change.name,
      label: description.label ?? nameTag(values) ?? change.name,
      role: description.role,
      ...(description.scope ? { scope: description.scope } : {}),
      actions: change.change.actions,
      attrs: values,
    });

    const ids = instances.get(baseAddress);
    if (ids) ids.push(change.address);
    else instances.set(baseAddress, [change.address]);
  }
  return { nodes, instances };
}

function nameTag(values: Json): string | undefined {
  const name = asRecord(values.tags)?.Name;
  return typeof name === 'string' && name !== '' ? name : undefined;
}

function buildEdges(
  root: PlanConfigModule,
  instances: ReadonlyMap<string, readonly string[]>,
  diagnostics: Diagnostic[],
): GraphEdge[] {
  const edges = new Map<string, { from: string; to: string; kind: string; evidence: Evidence[]; seen: Set<string> }>();
  const reported = new Set<string>();

  const report = (code: Diagnostic['code'], message: string) => {
    if (reported.has(message)) return;
    reported.add(message);
    diagnostics.push({ code, message });
  };

  /** `evidenceKey` merges duplicates, e.g. `x.id` and `x` for the same attribute. */
  const addEdge = (from: string, to: string, kind: string, evidence: Evidence, evidenceKey: string) => {
    if (from === to) return;
    const id = `${from}->${to}:${kind}`;
    let edge = edges.get(id);
    if (!edge) {
      edge = { from, to, kind, evidence: [], seen: new Set() };
      edges.set(id, edge);
    }
    if (!edge.seen.has(evidenceKey)) {
      edge.seen.add(evidenceKey);
      edge.evidence.push(evidence);
    }
  };

  const visit = (module: PlanConfigModule, prefix: string) => {
    for (const resource of module.resources ?? []) {
      if (resource.mode === 'data') continue;
      const base = `${prefix}${resource.address}`;
      const sources = instances.get(base) ?? [];
      if (sources.length === 0) continue;

      const found = collectReferences(resource.expressions).map((entry) => ({
        kind: 'reference',
        path: entry.path,
        reference: entry.reference,
      }));
      const dependsOn = Array.isArray(resource.depends_on)
        ? resource.depends_on
            .filter((entry): entry is string => typeof entry === 'string')
            .map((reference) => ({ kind: 'depends_on', path: 'depends_on', reference }))
        : [];

      for (const entry of [...found, ...dependsOn]) {
        const resolved = resolveReference(entry.reference, prefix);
        if (resolved === null) continue;
        if (resolved.kind === 'module-output') {
          report('module-output-reference', `${base} uses a module output (${entry.reference}); module outputs are not followed.`);
          continue;
        }
        const targets = instances.get(resolved.address);
        if (!targets || targets.length === 0) {
          report('unresolved-reference', `${base} refers to ${resolved.address}, which is not in the plan.`);
          continue;
        }

        const expanded = sources.length > 1 || targets.length > 1;
        const evidence: Evidence = {
          kind: entry.kind,
          summary:
            entry.kind === 'depends_on'
              ? `${base} depends_on ${entry.reference}`
              : `${base} ${entry.path} references ${entry.reference}`,
          data: { source: base, path: entry.path, reference: entry.reference, expanded },
        };
        const evidenceKey = `${entry.path}|${resolved.address}`;
        for (const from of sources) {
          for (const to of targets) addEdge(from, to, entry.kind, evidence, evidenceKey);
        }
      }
    }
    for (const [name, call] of Object.entries(module.module_calls ?? {})) {
      if (call.module) visit(call.module, `${prefix}module.${name}.`);
    }
  };

  visit(root, '');

  return [...edges.entries()].map(([id, edge]) => ({
    id,
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    assertion: 'declared' as const,
    evidence: edge.evidence,
  }));
}
