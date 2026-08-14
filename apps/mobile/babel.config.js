module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    // Reanimated's plugin rewrites worklets so they run on the UI thread.
    // It must be last, and without it every gesture-driven animation silently
    // falls back to the JS thread and drops frames.
    plugins: ['react-native-reanimated/plugin'],
  };
};
