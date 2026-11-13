// Environment doctor: reports what this machine can actually do before work starts.
//
//   node tools/doctor.ts        (or: pnpm doctor)
//
// Required tools fail the check. Optional tools only warn, because the deployed
// apps and CI never need them (Terraform is development-time only).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type Status = 'ok' | 'warn' | 'fail';

export interface Check {
  name: string;
  status: Status;
  detail: string;
  hint?: string;
}

export interface EnvInfo {
  /** e.g. "v24.11.1" */
  node: string | null;
  npm: string | null;
  corepack: string | null;
  pnpm: { version: string; via: 'path' | 'corepack' } | null;
  /** Version pinned in package.json "packageManager", e.g. "10.34.9" */
  pinnedPnpm: string | null;
  terraform: string | null;
  playwright: string | null;
  registryReachable: boolean | null;
}

export const MIN_NODE = [22, 12, 0] as const;

export function parseVersion(raw: string): number[] | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(raw);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function isAtLeast(version: number[], min: readonly number[]): boolean {
  for (let i = 0; i < min.length; i++) {
    const a = version[i] ?? 0;
    const b = min[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

export function evaluateEnvironment(info: EnvInfo): { checks: Check[]; ok: boolean } {
  const checks: Check[] = [];
  const minNode = MIN_NODE.join('.');

  // Node.js (required)
  const nodeVersion = info.node ? parseVersion(info.node) : null;
  if (!nodeVersion) {
    checks.push({ name: 'Node.js', status: 'fail', detail: 'not found', hint: `Install Node.js ${minNode} or newer.` });
  } else if (!isAtLeast(nodeVersion, MIN_NODE)) {
    checks.push({
      name: 'Node.js',
      status: 'fail',
      detail: `${info.node} is too old`,
      hint: `CloudVerse needs Node.js ${minNode} or newer.`,
    });
  } else {
    checks.push({ name: 'Node.js', status: 'ok', detail: String(info.node) });
  }

  // npm (informational)
  checks.push(
    info.npm
      ? { name: 'npm', status: 'ok', detail: info.npm }
      : { name: 'npm', status: 'warn', detail: 'not found', hint: 'Not required if pnpm is available.' },
  );

  // Corepack (informational, it is how the pinned pnpm is activated)
  checks.push(
    info.corepack
      ? { name: 'Corepack', status: 'ok', detail: info.corepack }
      : {
          name: 'Corepack',
          status: info.pnpm?.via === 'path' ? 'warn' : 'fail',
          detail: 'not found',
          hint: 'Node.js 25+ no longer bundles Corepack. Install it ("npm install -g corepack") or install the pinned pnpm directly.',
        },
  );

  // pnpm (required)
  if (!info.pnpm) {
    checks.push({
      name: 'pnpm',
      status: 'fail',
      detail: 'not available',
      hint: `Run "corepack pnpm --version" to activate the pinned version${
        info.pinnedPnpm ? ` (${info.pinnedPnpm})` : ''
      }, or run "corepack enable".`,
    });
  } else if (info.pinnedPnpm && info.pnpm.version !== info.pinnedPnpm) {
    checks.push({
      name: 'pnpm',
      status: 'warn',
      detail: `${info.pnpm.version} via ${info.pnpm.via}, project pins ${info.pinnedPnpm}`,
      hint: 'Use "corepack pnpm" so the pinned version is used.',
    });
  } else {
    checks.push({ name: 'pnpm', status: 'ok', detail: `${info.pnpm.version} via ${info.pnpm.via}` });
  }

  // Terraform (optional, development-time fixture generation only)
  checks.push(
    info.terraform
      ? { name: 'Terraform', status: 'ok', detail: `${info.terraform} (optional, fixture generation only)` }
      : {
          name: 'Terraform',
          status: 'warn',
          detail: 'not found',
          hint: 'Optional. Only needed to regenerate fixtures; committed fixtures work without it.',
        },
  );

  // Terraform registry reachability (optional)
  if (info.registryReachable === false) {
    checks.push({
      name: 'Terraform registry',
      status: 'warn',
      detail: 'unreachable',
      hint: 'Fixture generation downloads the AWS provider. Committed fixtures still work.',
    });
  } else if (info.registryReachable === true) {
    checks.push({ name: 'Terraform registry', status: 'ok', detail: 'reachable' });
  }

  // Playwright (optional until browser tests are added)
  checks.push(
    info.playwright
      ? { name: 'Playwright', status: 'ok', detail: info.playwright }
      : {
          name: 'Playwright',
          status: 'warn',
          detail: 'not installed',
          hint: 'Optional until browser tests are added. CI runs them with its own browsers.',
        },
  );

  return { checks, ok: checks.every((check) => check.status !== 'fail') };
}

function run(command: string, args: string[], cwd: string): string | null {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0', CHECKPOINT_DISABLE: '1' },
    }).trim();
  } catch {
    return null;
  }
}

export async function gatherEnvironment(root: string): Promise<EnvInfo> {
  let pinnedPnpm: string | null = null;
  try {
    const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as { packageManager?: string };
    pinnedPnpm = /^pnpm@(\d+\.\d+\.\d+)/.exec(pkg.packageManager ?? '')?.[1] ?? null;
  } catch {
    // No package.json yet: nothing is pinned.
  }

  let pnpm: EnvInfo['pnpm'] = null;
  const direct = run('pnpm', ['--version'], root);
  if (direct) {
    pnpm = { version: direct, via: 'path' };
  } else {
    const viaCorepack = run('corepack', ['pnpm', '--version'], root);
    if (viaCorepack) pnpm = { version: viaCorepack, via: 'corepack' };
  }

  let terraform: string | null = null;
  const tfJson = run('terraform', ['version', '-json'], root);
  if (tfJson) {
    try {
      terraform = (JSON.parse(tfJson) as { terraform_version?: string }).terraform_version ?? null;
    } catch {
      terraform = null;
    }
  }

  let registryReachable: boolean;
  try {
    const response = await fetch('https://registry.terraform.io/.well-known/terraform.json', {
      signal: AbortSignal.timeout(5_000),
    });
    registryReachable = response.ok;
  } catch {
    registryReachable = false;
  }

  const playwrightBin = `${root}/node_modules/.bin/playwright`;

  return {
    node: process.version,
    npm: run('npm', ['--version'], root),
    corepack: run('corepack', ['--version'], root),
    pnpm,
    pinnedPnpm,
    terraform,
    playwright: existsSync(playwrightBin) ? run(playwrightBin, ['--version'], root) : null,
    registryReachable,
  };
}

const LABEL: Record<Status, string> = { ok: ' ok ', warn: 'warn', fail: 'FAIL' };

async function main(): Promise<void> {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { checks, ok } = evaluateEnvironment(await gatherEnvironment(root));

  console.log('CloudVerse environment doctor\n');
  for (const check of checks) {
    console.log(`[${LABEL[check.status]}] ${check.name}: ${check.detail}`);
    if (check.hint && check.status !== 'ok') console.log(`       ${check.hint}`);
  }
  console.log(ok ? '\nAll required tools are available.' : '\nRequired tools are missing. See the FAIL lines above.');
  process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
