// @ts-check
// ESLint flat config. Besides code quality, this file enforces the CloudVerse
// package boundaries (see .kiro/steering/structure.md):
//   - browser-targeted code never uses Node built-ins
//   - packages are consumed only through their public entry point (no deep imports)
//   - the two apps never import each other
//   - lower layers never import higher layers
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const NODE_BUILTINS = [
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'events', 'fs',
  'fs/promises', 'http', 'http2', 'https', 'net', 'os', 'path', 'perf_hooks', 'process',
  'readline', 'stream', 'timers', 'tls', 'url', 'util', 'vm', 'worker_threads', 'zlib',
];

const NO_NODE = 'Browser-targeted code must not use Node built-ins. Keep Node-only code in tools/.';
const NO_DEEP = 'Import packages only through their public entry point, never their internals.';

/**
 * Build a no-restricted-imports configuration. Flat config does not merge rule
 * options across blocks, so every block gets the full base list plus its extras.
 * @param {{ group: string[]; message: string }[]} extra
 */
function restrict(extra = []) {
  return [
    'error',
    {
      paths: NODE_BUILTINS.map((name) => ({ name, message: NO_NODE })),
      patterns: [
        { group: ['node:*'], message: NO_NODE },
        { group: ['@cloudverse/*/*'], message: NO_DEEP },
        ...extra,
      ],
    },
  ];
}

const layer = (groups, message) => [{ group: groups, message }];
const PROVIDERS = '@cloudverse/provider-*';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.terraform/**',
      '**/.cache/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Dev tooling runs in Node and is exempt from browser restrictions.
  {
    files: ['tools/**/*.ts', '*.config.{js,mjs,ts}', 'apps/*/vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Everything shipped to browsers.
  {
    files: ['packages/**/*.ts', 'apps/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
    rules: { 'no-restricted-imports': restrict() },
  },

  // Apps never import each other.
  {
    files: ['apps/explorer/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(
        layer(['@cloudverse/app-defense-lab', '**/defense-lab/**'], 'Apps must never import each other.'),
      ),
    },
  },
  {
    files: ['apps/defense-lab/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(
        layer(['@cloudverse/app-explorer', '**/explorer/**'], 'Apps must never import each other.'),
      ),
    },
  },

  // core is the bottom layer.
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(
        layer(
          [
            '@cloudverse/render', '@cloudverse/ui-kit', '@cloudverse/theme', '@cloudverse/challenge',
            '@cloudverse/analysis', '@cloudverse/layout', '@cloudverse/samples', '@cloudverse/app-*', PROVIDERS,
          ],
          'core must not depend on any other CloudVerse package.',
        ),
      ),
    },
  },

  // Provider adapters depend only on core.
  {
    files: ['packages/providers/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(
        layer(
          [
            '@cloudverse/render', '@cloudverse/ui-kit', '@cloudverse/theme', '@cloudverse/challenge',
            '@cloudverse/analysis', '@cloudverse/layout', '@cloudverse/app-*',
          ],
          'Provider adapters may depend only on @cloudverse/core.',
        ),
      ),
    },
  },

  // Pure analysis and layout stay free of presentation concerns.
  {
    files: ['packages/analysis/**/*.ts', 'packages/layout/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(
        layer(
          ['@cloudverse/render', '@cloudverse/ui-kit', '@cloudverse/theme', '@cloudverse/app-*'],
          'analysis and layout must not depend on presentation packages.',
        ),
      ),
    },
  },

  // Themes and rendering must never be able to alter or analyse infrastructure.
  {
    files: ['packages/theme/**/*.ts', 'packages/render/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(
        layer(
          ['@cloudverse/analysis', '@cloudverse/challenge', '@cloudverse/ui-kit', '@cloudverse/app-*', PROVIDERS],
          'theme and render must not depend on analysis, challenge, providers, or UI.',
        ),
      ),
    },
  },
  {
    files: ['packages/theme/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(
        layer(
          [
            '@cloudverse/render', '@cloudverse/analysis', '@cloudverse/challenge', '@cloudverse/ui-kit',
            '@cloudverse/app-*', PROVIDERS,
          ],
          'theme is data-only and must not depend on render, analysis, challenge, providers, or UI.',
        ),
      ),
    },
  },

  // The challenge engine is logic only.
  {
    files: ['packages/challenge/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(
        layer(
          ['@cloudverse/render', '@cloudverse/ui-kit', '@cloudverse/theme', '@cloudverse/app-*', PROVIDERS],
          'challenge must not depend on presentation packages or providers.',
        ),
      ),
    },
  },

  // The UI kit is app-agnostic.
  {
    files: ['packages/ui-kit/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(
        layer(['@cloudverse/app-*', '@cloudverse/analysis', PROVIDERS], 'ui-kit must stay app- and provider-agnostic.'),
      ),
    },
  },

  // Sample data is a leaf package.
  {
    files: ['packages/samples/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(layer(['@cloudverse/*'], 'samples must not depend on other CloudVerse packages.')),
    },
  },
);
