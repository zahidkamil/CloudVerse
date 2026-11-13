// Scans fixture and sample files for secrets and real AWS account identifiers.
//
//   node tools/secret-scan.ts [path ...]     (or: pnpm scan:secrets)
//
// Fixtures are published in a public repository and bundled into public web apps,
// so nothing that looks like a credential or a real account ID may be committed.
// Findings never print the matched value, only a short redacted preview.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface Finding {
  rule: string;
  file: string;
  line: number;
  /** Redacted preview; never the full matched value. */
  preview: string;
}

/** AWS documentation placeholders that are safe to commit. */
export const PLACEHOLDER_ACCOUNT_IDS: ReadonlySet<string> = new Set(['123456789012', '000000000000']);
export const PLACEHOLDER_ACCESS_KEYS: ReadonlySet<string> = new Set(['AKIAIOSFODNN7EXAMPLE']);

interface Rule {
  name: string;
  pattern: RegExp;
  /** Capture group holding the sensitive value (0 = whole match). */
  group: number;
  allow?: (value: string) => boolean;
}

const RULES: Rule[] = [
  {
    name: 'aws-access-key-id',
    pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[A-Z0-9]{16}\b/g,
    group: 0,
    allow: (value) => PLACEHOLDER_ACCESS_KEYS.has(value),
  },
  {
    name: 'aws-secret-access-key',
    pattern: /aws_secret_access_key["'\s:=]+([A-Za-z0-9/+=]{40})\b/gi,
    group: 1,
  },
  { name: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, group: 0 },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, group: 0 },
  {
    name: 'aws-account-id-in-arn',
    pattern: /arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:(\d{12}):/g,
    group: 1,
    allow: (value) => PLACEHOLDER_ACCOUNT_IDS.has(value),
  },
  {
    name: 'aws-account-id-attribute',
    pattern: /"(?:account_id|owner_id|aws_account_id)"\s*:\s*"(\d{12})"/gi,
    group: 1,
    allow: (value) => PLACEHOLDER_ACCOUNT_IDS.has(value),
  },
  {
    name: 'secret-valued-attribute',
    pattern: /"(?:password|master_password|secret|secret_key|token|api_key|access_key)"\s*:\s*"([^"]+)"/gi,
    group: 1,
  },
];

function redact(value: string): string {
  return value.length <= 4 ? '****' : `${value.slice(0, 4)}…(${value.length} chars)`;
}

export function scanText(text: string, file: string): Finding[] {
  const findings: Finding[] = [];
  for (const rule of RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
      const value = match[rule.group] ?? match[0];
      if (rule.allow?.(value)) continue;
      const line = text.slice(0, match.index).split('\n').length;
      findings.push({ rule: rule.name, file, line, preview: redact(value) });
    }
  }
  return findings;
}

const TEXT_EXTENSIONS = new Set(['.tf', '.hcl', '.json', '.md', '.yml', '.yaml', '.txt', '.ts', '.mjs', '.js']);
const SKIP_DIRECTORIES = new Set(['.terraform', '.cache', 'node_modules', 'dist', '.git']);
const MAX_BYTES = 5 * 1024 * 1024;

export function scanPaths(root: string, targets: string[]): Finding[] {
  const findings: Finding[] = [];

  const visit = (path: string): void => {
    let info;
    try {
      info = statSync(path);
    } catch {
      return; // Missing target: nothing to scan.
    }
    if (info.isDirectory()) {
      for (const entry of readdirSync(path)) {
        if (!SKIP_DIRECTORIES.has(entry)) visit(join(path, entry));
      }
    } else if (info.size <= MAX_BYTES && TEXT_EXTENSIONS.has(extname(path))) {
      findings.push(...scanText(readFileSync(path, 'utf8'), relative(root, path)));
    }
  };

  targets.forEach((target) => visit(join(root, target)));
  return findings;
}

function main(): void {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const targets = process.argv.slice(2);
  const findings = scanPaths(root, targets.length > 0 ? targets : ['fixtures', 'packages/samples/data']);

  if (findings.length === 0) {
    console.log('Secret scan passed: no credentials or real account IDs found.');
    return;
  }
  console.error(`Secret scan failed with ${findings.length} finding(s):`);
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  [${finding.rule}]  ${finding.preview}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
