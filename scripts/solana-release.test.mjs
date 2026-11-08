import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
test('landing describes free workspace access and bounded model calls, not the retired timed gate',()=>{
  const page=read('landing/index.html');
  for(const path of ['landing/index.html','landing/about.html','landing/roadmap.html','landing/glossary.html']){
    assert.doesNotMatch(read(path),/\$0\.25|\$2\b|ONE-HOUR AGENT SESSION|SEVEN-DAY DEVELOPER PASS|time-bound agent access/);
  }
  assert.match(page,/0\.001/);assert.match(page,/per-call/i);assert.match(page,/model calls/i);
  assert.match(page,/published CLI/i);
});

test('Solana builds do not automatically consume the previous OTA stream', () => {
  const layout = read('app/app/_layout.tsx');
  assert.ok(layout.includes('process.env.EXPO_PUBLIC_UPDATE_SERVER_URL'));
  assert.match(layout, /Platform\.OS !== "web" && HotUpdater && updateServerUrl/);
  assert.ok(!layout.includes('https://updates.helixbox.xyz'));
  const publish = read('app/hot-updater.config.ts');
  assert.ok(publish.includes('process.env.HOT_UPDATER_SERVER_URL'));
  assert.ok(!publish.includes('https://updates.helixbox.xyz'));
});

test('manager administration has no hard-coded password fallback', () => {
  const manager = read('manager/src/index.ts');
  assert.ok(!/process\.env\.MANAGER_ADMIN_PASSWORD\s*\|\|\s*["'][^"']+["']/.test(manager));
});

test('public download links target this repository, not the previous APK', () => {
  for (const path of ['README.md', 'landing/index.html', 'landing/catalog.html']) {
    const content = read(path);
    assert.ok(content.includes('github.com/devndesigner6/helix-box-solana/releases'), path);
    assert.ok(!content.includes('github.com/devndesigner6/helix-box/releases'), path);
  }
});
