import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = new URL('./inspect.ts', import.meta.url).pathname;
const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

describe('inspect CLI (runs the real script on Node, workspace packages included)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('prints nodes, edges, and evidence for a sample id', () => {
    const result = run('haunted');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Graph: 22 nodes,');
    expect(result.stdout).toContain('aws_instance.mansion  [aws/unknown]  haunted-mansion  region:us-east-1  create');
    expect(result.stdout).toContain('aws_instance.mansion -> aws_subnet.graveyard  reference  declared');
    expect(result.stdout).toContain('aws_instance.mansion subnet_id references aws_subnet.graveyard.id');
    expect(result.stdout).not.toContain('DIAGNOSTICS');
  });

  it('accepts a file path', () => {
    const result = run(new URL('../packages/samples/data/web/plan.json', import.meta.url).pathname);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Graph: 24 nodes,');
  });

  it('explains a bad file without a stack trace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloudverse-inspect-'));
    dirs.push(dir);
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{ nope');
    const result = run(file);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not valid JSON/);
    expect(result.stderr).not.toMatch(/at .*\.ts:\d+/);
  });

  it('lists the samples when called wrongly', () => {
    expect(run().stderr).toContain('Samples: haunted, web');
    const unknown = run('nope');
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('Not a file or sample id: nope');
  });
});
