import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as controls from '../src/preview-controls.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const id = 'KXF1TQKWFDM';

test('new Solana demo replaces old public links and the local hero clip', () => {
  const page = read('../index.html'), readme = read('../../README.md');
  assert.ok(!page.includes('2cmHX_T2Qis'));
  assert.ok(!page.includes('<video'));
  assert.ok(page.includes(`data-demo-video="${id}"`));
  assert.equal([...page.matchAll(new RegExp(`href="https://youtu.be/${id}"`, 'g'))].length, 5);
  assert.ok(!page.includes('<iframe'), 'Do not load YouTube until a visitor activates the cover');
  assert.ok(page.includes(`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`));
  assert.ok(readme.includes(`https://youtu.be/${id}`));
  assert.ok(!readme.includes('https://helixboxide.xyz/'));
});

test('YouTube preview is muted and loops the selected demo without autoplay under reduced motion', () => {
  assert.equal(typeof controls.youtubePreviewUrl, 'function');
  for (const reducedMotion of [false, true]) {
    const url = new URL(controls.youtubePreviewUrl(id, reducedMotion));
    assert.equal(url.origin, 'https://www.youtube-nocookie.com');
    assert.equal(url.pathname, `/embed/${id}`);
    assert.equal(url.searchParams.get('autoplay'), reducedMotion ? '0' : '1');
    for (const key of ['mute', 'playsinline', 'controls', 'loop']) assert.equal(url.searchParams.get(key), '1');
    assert.equal(url.searchParams.get('playlist'), id);
  }
});
