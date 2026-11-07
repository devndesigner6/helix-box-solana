// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const path = require('path');
const emptyModule = path.resolve(__dirname, 'lib/empty-module.js');
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  stream: require.resolve('readable-stream'),
  crypto: emptyModule,
  http: emptyModule,
  https: emptyModule,
  net: emptyModule,
  tls: emptyModule,
  zlib: emptyModule,
  os: emptyModule,
  dns: emptyModule,
  assert: emptyModule,
  url: emptyModule,
  path: emptyModule,
  fs: emptyModule,
};


module.exports = config;
