// Generates sample data from the Terraform stacks under fixtures/stacks.
//
//   node tools/fixtures-generate.ts [stack ...]     (or: pnpm fixtures:generate)
//
// DEVELOPMENT-TIME ONLY. Requires the Terraform CLI and network access to the
// Terraform registry to download the AWS provider. The committed output in
// packages/samples/data is what apps, tests, and CI use, so none of them need
// Terraform.
//
// Safety: Terraform runs with mock credentials and every provider "skip" flag set
// in the stack, with all ambient AWS credentials and profiles removed from the
// environment, so it cannot reach a real AWS account.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractResourceBlocks } from './hcl-snippets.ts';
import { validatePlanShape } from './plan-shape.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const stacksRoot = join(root, 'fixtures/stacks');
const dataRoot = join(root, 'packages/samples/data');
const pluginCache = join(root, '.cache/terraform-plugins');

/** Environment with no ambient AWS identity, only mock credentials. */
export function sandboxedEnv(base: NodeJS.ProcessEnv, pluginCacheDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (!key.startsWith('AWS_') && !key.startsWith('TF_VAR_') && !key.startsWith('TF_CLI')) env[key] = value;
  }
  return {
    ...env,
    AWS_ACCESS_KEY_ID: 'mock-access-key',
    AWS_SECRET_ACCESS_KEY: 'mock-secret-key',
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_CONFIG_FILE: '/dev/null',
    AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
    TF_IN_AUTOMATION: '1',
    TF_INPUT: '0',
    TF_PLUGIN_CACHE_DIR: pluginCacheDir,
    CHECKPOINT_DISABLE: '1',
  };
}

function terraform(args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  return execFileSync('terraform', args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

interface StackInfo {
  title: string;
  description: string;
}

function generateStack(stack: string): void {
  const stackDir = join(stacksRoot, stack);
  const info = JSON.parse(readFileSync(join(stackDir, 'stack.json'), 'utf8')) as StackInfo;
  const env = sandboxedEnv(process.env, pluginCache);
  const scratch = mkdtempSync(join(tmpdir(), `cloudverse-${stack}-`));

  try {
    console.log(`[${stack}] terraform init`);
    terraform(['init', '-backend=false', '-no-color'], stackDir, env);

    console.log(`[${stack}] terraform plan`);
    const planFile = join(scratch, 'plan.bin');
    terraform(['plan', '-lock=false', '-no-color', `-out=${planFile}`], stackDir, env);

    console.log(`[${stack}] terraform show -json`);
    const plan = JSON.parse(terraform(['show', '-json', planFile], stackDir, env)) as Record<string, unknown>;

    const issues = validatePlanShape(plan);
    if (issues.length > 0) {
      throw new Error(`${stack}: generated plan is malformed: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
    }

    const snippets: Record<string, string> = {};
    for (const file of readdirSync(stackDir).filter((name) => name.endsWith('.tf')).sort()) {
      Object.assign(snippets, extractResourceBlocks(readFileSync(join(stackDir, file), 'utf8')));
    }

    const providerVersions = readLockedProviders(join(stackDir, '.terraform.lock.hcl'));
    const meta = {
      id: stack,
      title: info.title,
      description: info.description,
      generated: true,
      terraformVersion: String(plan.terraform_version),
      providers: providerVersions,
    };

    const outDir = join(dataRoot, stack);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
    writeFileSync(join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
    writeFileSync(join(outDir, 'snippets.json'), `${JSON.stringify(snippets, null, 2)}\n`);
    console.log(`[${stack}] wrote ${Object.keys(snippets).length} snippets to ${outDir}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Reads exact provider versions from the committed Terraform dependency lock file. */
export function readLockedProviders(lockFile: string): Record<string, string> {
  const text = readFileSync(lockFile, 'utf8');
  const providers: Record<string, string> = {};
  for (const match of text.matchAll(/provider\s+"registry\.terraform\.io\/([^"]+)"\s*\{\s*version\s*=\s*"([^"]+)"/g)) {
    if (match[1] && match[2]) providers[match[1]] = match[2];
  }
  return providers;
}

function main(): void {
  mkdirSync(pluginCache, { recursive: true });
  const requested = process.argv.slice(2);
  const available = readdirSync(stacksRoot).sort();
  const stacks = requested.length > 0 ? requested : available;

  for (const stack of stacks) {
    if (!available.includes(stack)) throw new Error(`Unknown stack "${stack}". Available: ${available.join(', ')}`);
    generateStack(stack);
  }
  console.log('Done. Run "pnpm scan:secrets" and "pnpm fixtures:validate" before committing.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
