import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/core/**/*.{test,spec}.ts', 'src/db/**/*.{test,spec}.ts'],
    passWithNoTests: true,
  },
});
