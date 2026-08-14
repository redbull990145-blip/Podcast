import { defineConfig, mergeConfig } from 'vitest/config';
import base from '@cue/config/vitest/base';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      // A Next app has no `src/` — code lives in `app/`, `lib/` and
      // `components/`. The shared glob would silently match nothing, which
      // looks identical to "all tests passed".
      include: ['{app,lib,components}/**/*.test.{ts,tsx}'],
    },
  }),
);
