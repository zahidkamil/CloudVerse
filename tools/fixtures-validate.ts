// Validates the committed sample data without needing Terraform.
//
//   node tools/fixtures-validate.ts          (or: pnpm fixtures:validate)
//
// Each directory under packages/samples/data must contain plan.json, meta.json
// and snippets.json, the plan must look like `terraform show -json` output, and
// every planned resource must have an HCL snippet (and vice versa).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listPlanAddresses, validatePlanShape } from './plan-shape.ts';

export const REQUIRED_FILES = ['plan.json', 'meta.json', 'snippets.json'] as const;
const REQUIRED_META_KEYS = ['id', 'title', 'description', 'generated', 'terraformVersion', 'providers'] as const;

export function validateSampleDir(dir: string, expectedId: string): string[] {
  const problems: string[] = [];

  for (const file of REQUIRED_FILES) {
    if (!existsSync(join(dir, file))) problems.push(`${expectedId}: missing ${file}`);
  }
  if (problems.length > 0) return problems;

  const read = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const plan = read('plan.json');
  const meta = read('meta.json') as Record<string, unknown>;
  const snippets = read('snippets.json') as Record<string, unknown>;

  for (const issue of validatePlanShape(plan)) problems.push(`${expectedId}: plan.json ${issue.path}: ${issue.message}`);

  for (const key of REQUIRED_META_KEYS) {
    if (!(key in meta)) problems.push(`${expectedId}: meta.json missing "${key}"`);
  }
  if (meta.id !== expectedId) problems.push(`${expectedId}: meta.json id "${String(meta.id)}" must match directory name`);

  const addresses = new Set(listPlanAddresses(plan));
  for (const address of addresses) {
    if (typeof snippets[address] !== 'string') problems.push(`${expectedId}: no HCL snippet for ${address}`);
  }
  for (const address of Object.keys(snippets)) {
    if (!addresses.has(address)) problems.push(`${expectedId}: snippet ${address} has no matching resource in the plan`);
  }

  return problems;
}

export function validateAllSamples(dataRoot: string): string[] {
  if (!existsSync(dataRoot)) return [`sample data directory not found: ${dataRoot}`];
  const ids = readdirSync(dataRoot).filter((entry) => statSync(join(dataRoot, entry)).isDirectory());
  if (ids.length === 0) return ['no sample directories found'];
  return ids.flatMap((id) => validateSampleDir(join(dataRoot, id), id));
}

function main(): void {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const problems = validateAllSamples(join(root, 'packages/samples/data'));
  if (problems.length === 0) {
    console.log('Fixture validation passed.');
    return;
  }
  console.error(`Fixture validation failed with ${problems.length} problem(s):`);
  problems.forEach((problem) => console.error(`  ${problem}`));
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
