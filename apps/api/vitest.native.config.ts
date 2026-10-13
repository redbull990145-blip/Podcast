import { defineConfig, mergeConfig } from 'vitest/config';
import base from '@cue/config/vitest/base';

// Dedicated runner creates the owner marker; ordinary suites never start a DB.
if (!process.env['PODCAST_NATIVE_TEST_MARKER']) {
  throw new Error(
    'Use scripts/test-native-postgres.mjs to create an owned disposable native PG17 cluster',
  );
}
const config = mergeConfig(
  base,
  defineConfig({
    test: {
      testTimeout: 120_000,
      hookTimeout: 120_000,
      fileParallelism: false,
    },
  }),
);
// mergeConfig concatenates include arrays; replace the ordinary suite list.
config.test!.include = ['src/test/native/**/*.native.ts'];
export default config;
