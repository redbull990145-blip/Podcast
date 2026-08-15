import globals from 'globals';
import base from '@cue/config/eslint/base';

export default [
  ...base,
  { ignores: ['.next/**', 'next-env.d.ts', 'app/tokens.css'] },
  {
    // The service worker is plain JS served straight from `public/`, so it is
    // never compiled and never sees the app's globals. It runs in a worker
    // scope instead — `self`, `caches`, `clients` — which without this reads
    // as nineteen undefined variables.
    files: ['public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
];
