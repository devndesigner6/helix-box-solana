const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

function transport() {
  let socket, timer;
  class Socket {
    static OPEN = 1; static CONNECTING = 0;
    readyState = 0;
    constructor() { socket = this; }
    close() { this.readyState = 3; }
  }
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(resolve(__dirname, '../lib/transport/v2.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(source, { exports: module.exports, TextEncoder, TextDecoder, WebSocket: Socket,
    setTimeout: fn => { timer = fn; return 1; }, clearTimeout: () => {},
    require: name => name === 'react-native-libsodium' ? { default: { ready: Promise.resolve() } } : { buildSessionV2WsUrl: () => 'ws://example' },
  });
  const instance = new module.exports.V2SessionTransport({ gatewayUrl: '', password: '', sessionSecret: '', role: 'app', handlers: { onClose() {} } });
  return { instance, socket: () => socket, timeout: () => timer() };
}
test('closing during setup rejects the connection', async () => {
  const t = transport(), connection = t.instance.connect();
  await Promise.resolve(); t.instance.close();
  await assert.rejects(connection, /closed/i);
});
test('a stalled secure handshake times out and closes the socket', async () => {
  const t = transport(), connection = t.instance.connect();
  await new Promise(resolve => setImmediate(resolve)); t.socket().onopen(); t.timeout();
  await assert.rejects(connection, /timed out/i);
  assert.equal(t.socket().readyState, 3);
});
