import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../product-surfaces.css', import.meta.url), 'utf8');
const video = html.match(/<iframe\s[^>]*data-demo-video="KXF1TQKWFDM"[^>]*>/)?.[0];

assert.ok(video, 'hero video slot exists');
assert.match(video, /youtube-nocookie\.com\/embed\/KXF1TQKWFDM\?[^"']*autoplay=0[^"']*mute=1/);
assert.match(html, /<a[^>]+href="https:\/\/youtu\.be\/KXF1TQKWFDM"[^>]+target="_blank"/);
assert.match(css, /\.demo-screen iframe\s*\{/);
console.log('Solana demo is embedded with native controls; autoplay is enabled by JS only when motion is allowed.');
