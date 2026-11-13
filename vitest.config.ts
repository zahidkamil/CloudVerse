import { defineConfig } from 'vitest/config';

const exclude = ['**/node_modules/**', '**/dist/**', '**/.terraform/**', '**/.cache/**'];

export default defineConfig({
  test: {
    projects: [
      {
        // Node-side tests: dev tooling and framework logic.
        test: {
          name: 'node',
          environment: 'node',
          include: ['tools/**/*.test.ts', 'packages/**/*.test.ts', 'apps/**/*.test.ts'],
          exclude: [...exclude, '**/*.dom.test.ts'],
        },
      },
      {
        // Browser-like tests. Anything shipped to visitors must pass here too.
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['packages/**/*.dom.test.ts', 'apps/**/*.dom.test.ts'],
          exclude,
        },
      },
    ],
  },
});
