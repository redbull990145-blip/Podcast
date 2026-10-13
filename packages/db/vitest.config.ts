import { defineConfig, mergeConfig } from 'vitest/config';
import base from '@cue/config/vitest/base';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      // Integration cases boot isolated PostgreSQL/WASM databases. Keep them
      // sequential and bounded, with time for migration startup on this machine.
      fileParallelism: false,
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  }),
);
