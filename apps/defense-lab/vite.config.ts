import { defineConfig } from 'vite';

// A relative base lets the same build work from any URL path, including a
// GitHub Pages project site served under /<repo>/defense-lab/.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
});
