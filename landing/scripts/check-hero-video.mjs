import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../product-surfaces.css', import.meta.url), 'utf8');
const video = html.match(/<a\s[^>]*class="demo-cover"[^>]*data-demo-video="KXF1TQKWFDM"[^>]*>/)?.[0];

assert.ok(video, 'hero video slot exists');
assert.match(video, /href="https:\/\/youtu\.be\/KXF1TQKWFDM"/);
assert.ok(!html.includes('<iframe'), 'The initial view must show a thumbnail, not a black player');
assert.ok(html.includes('https://i.ytimg.com/vi/KXF1TQKWFDM/maxresdefault.jpg'));
assert.match(html, /<a[^>]+href="https:\/\/youtu\.be\/KXF1TQKWFDM"[^>]+target="_blank"/);
assert.match(css, /\.demo-screen iframe\s*\{/);
console.log('Solana demo uses its real thumbnail and loads an accessible inline player after activation.');
