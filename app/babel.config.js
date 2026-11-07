module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: ["hot-updater/babel-plugin"],
    overrides: [{
      test: /node_modules[\\/]@x402[\\/]core[\\/]/,
      plugins: [require.resolve('./scripts/native-x402-paywall.cjs')],
    }],
  };
};
