import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Database authorization & financial-consistency tests. They run against the
// real Supabase project configured in .env.local and create throwaway users.
export default defineConfig({
  resolve: {
    alias: {
      '@owenil/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
