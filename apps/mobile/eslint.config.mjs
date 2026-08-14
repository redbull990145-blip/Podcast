import base from '@cue/config/eslint/base';

export default [
  ...base,
  { ignores: ['.expo/**', 'expo-env.d.ts'] },
  {
    // Metro and Babel load their config through Node's CommonJS require, so
    // these two files cannot be ESM however much the rest of the repo is.
    files: ['metro.config.js', 'babel.config.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
