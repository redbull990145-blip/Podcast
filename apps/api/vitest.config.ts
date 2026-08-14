import { defineConfig, mergeConfig } from 'vitest/config';
import base from '@cue/config/vitest/base';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      /**
       * The base 10s assumes tests do no I/O. This package boots a real
       * Postgres (PGlite/WASM) and inserts hundreds of rows, and Turbo runs
       * packages in parallel — so under load a legitimate test can exceed it.
       * Raised rather than removed: a DB test past 30s is a genuine problem.
       */
      testTimeout: 30_000,
      hookTimeout: 30_000,

      /**
       * Run this package's test files one at a time.
       *
       * Several of them boot their own PGlite — a full Postgres compiled to
       * WASM. In parallel, on a machine already running the rest of the
       * workspace's tests via Turbo, they contend badly enough to blow the
       * timeouts. The suite is small, and a few seconds slower is a better
       * trade than a test run that fails depending on what else is running.
       */
      fileParallelism: false,
    },
  }),
);
