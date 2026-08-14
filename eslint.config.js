/**
 * Root flat config. Packages and apps run `eslint .` and ESLint walks up to
 * find this, so rules live in exactly one place. An app only adds its own
 * config file when it genuinely needs platform rules (React hooks, Next, RN).
 */
export { default } from '@cue/config/eslint/base';
