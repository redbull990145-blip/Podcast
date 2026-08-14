const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Metro only watches the app directory by default, so edits to a shared
// package would not trigger a reload — and its source would not resolve at all.
config.watchFolders = [workspaceRoot];

// Resolve from the app first, then the hoisted workspace root. npm hoists most
// dependencies upward, so both locations are real.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Workspace packages export TypeScript source rather than a build output.
// Metro compiles it through babel-preset-expo, so no build step is needed —
// but it must be told those extensions are resolvable in package exports.
config.resolver.unstable_enablePackageExports = true;
config.resolver.sourceExts = [...config.resolver.sourceExts, 'ts', 'tsx'];

module.exports = config;
