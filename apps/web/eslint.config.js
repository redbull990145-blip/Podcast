import globals from 'globals';
import base from '@cue/config/eslint/base';

export default [
  ...base,
  // `.open-next/**` is the compiled worker and `.wrangler/**` is local
  // Cloudflare state; both are generated, and linting either reports thousands
  // of findings in code nobody can edit.
  {
    ignores: [
      '.next/**',
      '.open-next/**',
      '.wrangler/**',
      'next-env.d.ts',
      'app/tokens.css',
    ],
  },
  {
    // The service worker is plain JS served straight from `public/`, so it is
    // never compiled and never sees the app's globals. It runs in a worker
    // scope instead — `self`, `caches`, `clients` — which without this reads
    // as nineteen undefined variables.
    files: ['public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    /**
     * Build scripts talk to a terminal — that is the whole job.
     *
     * `no-console` exists to keep stray debugging out of shipped app code, and
     * these never ship. Without this the rule pushes a build script's normal
     * output through `console.warn`, which then reads as a warning in CI logs
     * and buries the real ones.
     */
    files: ['scripts/**/*.js'],
    rules: { 'no-console': 'off' },
  },
];
