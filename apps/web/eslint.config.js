import base from '@cue/config/eslint/base';

export default [
  ...base,
  { ignores: ['.next/**', 'next-env.d.ts', 'app/tokens.css'] },
];
