import assert from 'node:assert/strict';
import test from 'node:test';
import { createModelCatalog, normalizeModel } from '../src/model-catalog.ts';

test('keeps real IDs, separates modalities, and never invents prices', () => {
  const model = normalizeModel({ id: 'lab/code', name: 'Code', architecture: {output_modalities:['text']},
    endpoints:['/api/v1/chat/completions'], pricing:{prompt:'0.000001', completion:'0.000002'}, context_length:10000 }, 'chat');
  assert.equal(model?.id, 'lab/code'); assert.equal(model?.kind, 'chat');
  assert.equal(model?.pricing.prompt, '0.000001');
  assert.equal(normalizeModel({id:'bad',name:'Bad'}, 'chat'), null);
  assert.equal(normalizeModel({id:'lab/missing',name:'Missing'}, 'image')?.pricing.prompt, undefined);
});

test('loads all three live catalogs once, caches them, and reports unavailable generation without a key', async () => {
  const urls: string[] = [];
  const catalog = createModelCatalog({ apiKey: '', fetcher: async (url) => {
    urls.push(String(url));
    const kind = String(url).includes('images/models') ? 'image' : String(url).includes('speech') ? 'voice' : 'chat';
    return Response.json({data:[{id:`lab/${kind}`,name:kind,pricing:{prompt:'0'},architecture:{output_modalities:[kind === 'chat' ? 'text' : kind]}}]});
  }});
  const first = await catalog.list();
  assert.equal(first.models.length, 3); assert.equal(first.configured, false);
  assert.deepEqual(first.models.map(m => m.kind).sort(), ['chat','image','voice']);
  await catalog.list(); assert.equal(urls.length, 3);
  assert.ok(urls.every(url => url.startsWith('https://openrouter.ai/api/v1/')));
});

test('does not replace failed live catalogs with made-up models', async () => {
  const catalog = createModelCatalog({apiKey:'',fetcher:async () => new Response('',{status:503})});
  await assert.rejects(catalog.list(), /catalog/i);
});
