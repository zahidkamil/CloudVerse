// Rewrites the golden files that tests compare against.
//
//   pnpm run golden:update
//
// Run this only after reviewing a deliberate change to roles, edges or hierarchy, then read
// the git diff of packages/providers/aws/golden/ before committing. Tests never write.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestPlanObject, summarizeGraph } from '@cloudverse/core';
import { awsAdapter } from '@cloudverse/provider-aws';
const root = fileURLToPath(new URL('..', import.meta.url));
const samplesDir = join(root, 'packages/samples/data');
const dir = join(root, 'packages/providers/aws/golden');
mkdirSync(dir, { recursive: true });
// Read the files directly: the samples package uses Vite's import.meta.glob, which Node lacks.
for (const id of readdirSync(samplesDir).sort()) {
  const plan: unknown = JSON.parse(readFileSync(join(samplesDir, id, 'plan.json'), 'utf8'));
  const { graph, hierarchy } = ingestPlanObject(plan, { adapters: [awsAdapter] });
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(summarizeGraph(graph, hierarchy), null, 2)}\n`);
  console.log(`wrote golden/${id}.json`);
}
