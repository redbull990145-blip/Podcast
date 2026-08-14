import { defineConfig } from 'vitest/config';

/**
 * Shared Vitest defaults. Packages import this and spread in what they need.
 */
export const baseTestConfig = defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    clearMocks: true,
    /**
     * Every package has tests now, so "no test files found" is no longer a
     * young package — it is a broken glob or a suite that got deleted with the
     * code it covered. Both report green under `passWithNoTests`, which is how
     * @cue/web sat at zero tests for a while showing a passing check.
     */
    passWithNoTests: false,
    // A test that takes longer than this is doing real I/O it shouldn't.
    testTimeout: 10_000,
  },
});

export default baseTestConfig;
