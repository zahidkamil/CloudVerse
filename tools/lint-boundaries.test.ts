import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// These tests lint snippets "as if" they lived at a given path and assert that the
// package-boundary rules in eslint.config.mjs fire (or stay quiet). If someone
// loosens a rule, a test here fails.
const root = new URL('..', import.meta.url).pathname;
const eslint = new ESLint({ cwd: root });

async function violations(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${root}${file}` });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
}

describe('browser safety', () => {
  it('forbids Node built-ins in browser-targeted packages and apps', async () => {
    expect(await violations('packages/core/src/x.ts', `import { readFileSync } from 'node:fs';\nvoid readFileSync;`)).toHaveLength(1);
    expect(await violations('packages/core/src/x.ts', `import { join } from 'path';\nvoid join;`)).toHaveLength(1);
    expect(await violations('apps/explorer/src/x.ts', `import { Buffer } from 'node:buffer';\nvoid Buffer;`)).toHaveLength(1);
  });

  it('allows Node built-ins in dev tooling', async () => {
    expect(await violations('tools/x.ts', `import { readFileSync } from 'node:fs';\nvoid readFileSync;`)).toEqual([]);
  });
});

describe('public entry points only', () => {
  it('forbids deep imports into another package', async () => {
    expect(await violations('apps/explorer/src/x.ts', `import { samples } from '@cloudverse/samples/src/index';\nvoid samples;`)).toHaveLength(1);
    expect(await violations('packages/analysis/src/x.ts', `import x from '@cloudverse/core/src/graph';\nvoid x;`)).toHaveLength(1);
  });

  it('allows the public entry point', async () => {
    expect(await violations('apps/explorer/src/x.ts', `import { samples } from '@cloudverse/samples';\nvoid samples;`)).toEqual([]);
  });
});

describe('apps are independent', () => {
  it('forbids Explorer importing Defense Lab and vice versa', async () => {
    expect(await violations('apps/explorer/src/x.ts', `import x from '../../defense-lab/src/main';\nvoid x;`)).toHaveLength(1);
    expect(await violations('apps/explorer/src/x.ts', `import x from '@cloudverse/app-defense-lab';\nvoid x;`)).toHaveLength(1);
    expect(await violations('apps/defense-lab/src/x.ts', `import x from '../../explorer/src/main';\nvoid x;`)).toHaveLength(1);
    expect(await violations('apps/defense-lab/src/x.ts', `import x from '@cloudverse/app-explorer';\nvoid x;`)).toHaveLength(1);
  });
});

describe('layering', () => {
  it('keeps core at the bottom', async () => {
    for (const pkg of ['render', 'ui-kit', 'theme', 'challenge', 'analysis', 'layout', 'samples', 'provider-aws']) {
      expect(await violations('packages/core/src/x.ts', `import x from '@cloudverse/${pkg}';\nvoid x;`)).toHaveLength(1);
    }
  });

  it('keeps themes and rendering unable to reach analysis or the graph logic that mutates infrastructure', async () => {
    expect(await violations('packages/theme/src/x.ts', `import x from '@cloudverse/analysis';\nvoid x;`)).toHaveLength(1);
    expect(await violations('packages/theme/src/x.ts', `import x from '@cloudverse/provider-aws';\nvoid x;`)).toHaveLength(1);
    expect(await violations('packages/render/src/x.ts', `import x from '@cloudverse/analysis';\nvoid x;`)).toHaveLength(1);
    expect(await violations('packages/render/src/x.ts', `import x from '@cloudverse/challenge';\nvoid x;`)).toHaveLength(1);
  });

  it('keeps analysis and layout free of presentation packages', async () => {
    expect(await violations('packages/analysis/src/x.ts', `import x from '@cloudverse/render';\nvoid x;`)).toHaveLength(1);
    expect(await violations('packages/layout/src/x.ts', `import x from '@cloudverse/theme';\nvoid x;`)).toHaveLength(1);
  });

  it('restricts providers to core and samples to nothing', async () => {
    expect(await violations('packages/providers/aws/src/x.ts', `import x from '@cloudverse/render';\nvoid x;`)).toHaveLength(1);
    expect(await violations('packages/samples/src/x.ts', `import x from '@cloudverse/core';\nvoid x;`)).toHaveLength(1);
  });

  it('allows legitimate dependencies', async () => {
    expect(await violations('packages/providers/aws/src/x.ts', `import x from '@cloudverse/core';\nvoid x;`)).toEqual([]);
    expect(await violations('packages/render/src/x.ts', `import x from '@cloudverse/theme';\nvoid x;`)).toEqual([]);
    expect(await violations('packages/ui-kit/src/x.ts', `import x from '@cloudverse/render';\nvoid x;`)).toEqual([]);
    expect(await violations('apps/defense-lab/src/x.ts', `import x from '@cloudverse/analysis';\nvoid x;`)).toEqual([]);
  });
});
