const test = require('node:test');
const assert = require('node:assert/strict');
const { transformSync } = require('@babel/core');
const { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

test('the native client can compile the SDK optional browser-paywall loader', () => {
  const app = resolve(__dirname, '..');
  const source = 'const PAYWALL_PACKAGE = "@x402/paywall"; function load() { return import(/* @metro-ignore */ PAYWALL_PACKAGE); }';
  const transformed = transformSync(source, {
    filename: join(app, 'node_modules/@x402/core/dist/esm/native-compiler-fixture.mjs'),
    configFile: join(app, 'babel.config.js'), babelrc: false,
    caller: { name: 'metro', platform: 'android', engine: 'hermes', bundler: 'metro', isDev: false, isServer: false, supportsStaticESM: true },
  }).code;
  const folder = mkdtempSync(join(tmpdir(), 'helixbox-hermes-'));
  const input = join(folder, 'fixture.js');
  const output = join(folder, 'fixture.hbc');
  writeFileSync(input, transformed);
  try {
    const platform = process.platform === 'win32' ? 'win64-bin/hermesc.exe' : process.platform === 'darwin' ? 'osx-bin/hermesc' : 'linux64-bin/hermesc';
    const result = spawnSync(join(app, 'node_modules/react-native/sdks/hermesc', platform), ['-emit-binary', '-out', output, input], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    for (const file of [input, output]) { try { unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    rmdirSync(folder);
  }
});
