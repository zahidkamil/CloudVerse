import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PLACEHOLDER_ACCESS_KEYS, PLACEHOLDER_ACCOUNT_IDS, scanPaths, scanText } from './secret-scan.ts';

// Fake credentials are assembled at runtime so this file never contains a
// literal secret-shaped string.
const fakeAccessKey = ['AKIA', 'ZZZZYYYYXXXXWWWW'].join('');
const fakeAccountId = ['9876', '5432', '1098'].join('');
const fakeSecretKey = ['wJalrXUtnFEMI', '/K7MDENG/bPxRfiCY', 'ABCDEFGHIJ'].join('');

const rules = (text: string) => scanText(text, 'fixture.json').map((finding) => finding.rule);

describe('scanText', () => {
  it('flags an AWS access key id', () => {
    expect(rules(`key = "${fakeAccessKey}"`)).toEqual(['aws-access-key-id']);
  });

  it('flags an AWS secret access key assignment', () => {
    expect(rules(`aws_secret_access_key = "${fakeSecretKey}"`)).toEqual(['aws-secret-access-key']);
  });

  it('flags a private key header', () => {
    expect(rules('-----BEGIN RSA PRIVATE KEY-----')).toEqual(['private-key']);
  });

  it('flags a real-looking account id in an ARN and in an attribute', () => {
    expect(rules(`"arn": "arn:aws:iam::${fakeAccountId}:role/x"`)).toEqual(['aws-account-id-in-arn']);
    expect(rules(`"account_id": "${fakeAccountId}"`)).toEqual(['aws-account-id-attribute']);
  });

  it('flags secret-valued attributes but not null or empty ones', () => {
    expect(rules('"password": "hunter2hunter2"')).toEqual(['secret-valued-attribute']);
    expect(rules('"password": null')).toEqual([]);
    expect(rules('"password": ""')).toEqual([]);
  });

  it('allows documented placeholder values', () => {
    for (const id of PLACEHOLDER_ACCOUNT_IDS) expect(rules(`"account_id": "${id}"`)).toEqual([]);
    for (const key of PLACEHOLDER_ACCESS_KEYS) expect(rules(key)).toEqual([]);
  });

  it('reports the line number and never echoes the full secret', () => {
    const [finding] = scanText(`line one\nline two\nkey = "${fakeAccessKey}"\n`, 'a.tf');
    expect(finding?.line).toBe(3);
    expect(finding?.file).toBe('a.tf');
    expect(finding?.preview).not.toContain(fakeAccessKey);
  });

  it('passes clean text', () => {
    expect(scanText('resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }', 'ok.tf')).toEqual([]);
  });
});

describe('scanPaths', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const makeRoot = () => {
    const root = mkdtempSync(join(tmpdir(), 'cloudverse-scan-'));
    dirs.push(root);
    return root;
  };

  it('finds a planted secret and skips .terraform and node_modules', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'fixtures/.terraform'), { recursive: true });
    mkdirSync(join(root, 'fixtures/node_modules'), { recursive: true });
    writeFileSync(join(root, 'fixtures/leaky.json'), `{"key": "${fakeAccessKey}"}`);
    writeFileSync(join(root, 'fixtures/.terraform/ignored.json'), `{"key": "${fakeAccessKey}"}`);
    writeFileSync(join(root, 'fixtures/node_modules/ignored.json'), `{"key": "${fakeAccessKey}"}`);

    const findings = scanPaths(root, ['fixtures']);
    expect(findings.map((finding) => finding.file)).toEqual(['fixtures/leaky.json']);
  });

  it('ignores missing targets and passes a clean tree', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'clean.json'), '{"ok": true}');
    expect(scanPaths(root, ['does-not-exist', 'clean.json'])).toEqual([]);
  });

  it('finds nothing in the committed fixtures and samples', () => {
    const repoRoot = new URL('..', import.meta.url).pathname;
    expect(scanPaths(repoRoot, ['fixtures', 'packages/samples/data'])).toEqual([]);
  });
});
