import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site from /hexlords/, so assets need that base path.
export default defineConfig({
  base: '/hexlords/',
  build: {
    target: 'es2022',
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
