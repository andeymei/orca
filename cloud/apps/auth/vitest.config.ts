import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'auth',
    include: ['src/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Password hashing allocates 16 MiB per call; parallel workers on a small host run out of memory.
    maxWorkers: 2
  }
})
