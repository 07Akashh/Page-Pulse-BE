import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    environment: 'node',
    include: ['test/e2e/**/*.e2e-spec.ts'],
    exclude: ['test/unit/**/*', 'node_modules', 'dist'],
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['verbose'],
  },
  resolve: {
    alias: {
      '@modules': resolve(__dirname, 'src/modules'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@common': resolve(__dirname, 'src/common'),
    },
  },
});
