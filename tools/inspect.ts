// Prints the graph CloudVerse builds from a Terraform plan.
//
//   node tools/inspect.ts <plan.json | sample-id>     (or: pnpm inspect <plan.json | sample-id>)
//
// A sample id is a folder name under packages/samples/data (e.g. "haunted").
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IngestError, ingestPlan, summarizeGraph, type Diagnostic, type Graph, type Hierarchy } from '@cloudverse/core';
import { awsAdapter } from '@cloudverse/provider-aws';

const root = fileURLToPath(new URL('..', import.meta.url));
const samplesRoot = join(root, 'packages/samples/data');

export function formatGraph(
  graph: Graph,
  hierarchy: Hierarchy,
  diagnostics: readonly Diagnostic[],
  terraformVersion: string,
): string {
  const lines: string[] = [
    `Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges (Terraform ${terraformVersion})`,
    '',
    'NODES',
  ];
  for (const node of graph.nodes) {
    const scope = node.scope ? `${node.scope.kind}:${node.scope.id}` : 'no scope';
    lines.push(`  ${node.id}  [${node.provider}/${node.role}]  ${node.label}  ${scope}  ${node.actions.join(',')}`);
  }
  lines.push('', 'HIERARCHY');
  for (const line of summarizeGraph(graph, hierarchy).tree) lines.push(`  ${line}`);
  lines.push('', 'EDGES');
  for (const edge of graph.edges) {
    lines.push(`  ${edge.from} -> ${edge.to}  ${edge.kind}  ${edge.assertion}`);
    for (const evidence of edge.evidence) lines.push(`      ${evidence.summary}`);
  }
  if (diagnostics.length > 0) {
    lines.push('', 'DIAGNOSTICS');
    for (const diagnostic of diagnostics) lines.push(`  [${diagnostic.code}] ${diagnostic.message}`);
  }
  return lines.join('\n');
}

function usage(): string {
  const ids = existsSync(samplesRoot) ? readdirSync(samplesRoot).sort().join(', ') : 'none';
  return `Usage: node tools/inspect.ts <plan.json | sample-id>\nSamples: ${ids}`;
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const samplePath = join(samplesRoot, target, 'plan.json');
  const path = existsSync(target) ? target : existsSync(samplePath) ? samplePath : undefined;
  if (!path) {
    console.error(`Not a file or sample id: ${target}\n${usage()}`);
    process.exitCode = 2;
    return;
  }

  try {
    const { graph, hierarchy, diagnostics, terraformVersion } = await ingestPlan(readFileSync(path, 'utf8'), { adapters: [awsAdapter] });
    console.log(formatGraph(graph, hierarchy, diagnostics, terraformVersion));
  } catch (error) {
    if (!(error instanceof IngestError)) throw error;
    console.error(`Cannot read ${path}: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
