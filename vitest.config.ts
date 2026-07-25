import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    environment: 'node',
    include: ['test/unit/**/*.spec.ts'],
    exclude: ['test/e2e/**/*', 'node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.module.ts',
        'src/**/*.dto.ts',
        'src/**/*.interface.ts',
        'src/main.ts',
        'src/app.module.ts',
        'src/common/types/**',
        'src/common/constants/**',
        'src/shared/config/**',
        'src/shared/logger/**',
        'src/shared/queue/**',
        'src/modules/audit/audit.processor.ts',
        'src/modules/metrics/**',
        'src/modules/health/health.service.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
    reporters: ['verbose'],
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      '@modules': resolve(__dirname, 'src/modules'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@common': resolve(__dirname, 'src/common'),
    },
  },
});
