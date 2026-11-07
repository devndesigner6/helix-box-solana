import type { ModelCallInput, ModelQuoteTerms } from './model-quotes.ts';
import {validatePNG,validateMP3} from './model-media.ts';

export interface ModelResult { kind: ModelQuoteTerms['kind']; text?: string; mediaType?: string; base64?: string; generationId: string | null; providerCost: number | null }
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export function assertShareablePrompt(prompt: string): void {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-(?:proj-|or-v1-)?[a-zA-Z0-9_-]{20,}|\bAKIA[A-Z0-9]{16}\b/.test(prompt)) {
    throw new Error('The prompt appears to contain a secret. Remove it before sharing.');
  }
}
async function bytesBounded(response: Response, max: number): Promise<Buffer> {
  if (Number(response.headers.get('content-length') || 0) > max) throw new Error('Model output exceeds the size limit');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Model returned no output');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > max) { await reader.cancel(); throw new Error('Model output exceeds the size limit'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export async function runModelCall(terms: ModelQuoteTerms, input: ModelCallInput, apiKey: string, fetcher: Fetcher = fetch): Promise<ModelResult> {
  if (!apiKey) throw new Error('Model generation is not configured');
  assertShareablePrompt(input.prompt);
  if (!terms.maxPrice) throw new Error('Model quote has no dispatch price ceiling');
  const provider = {order:[terms.provider], allow_fallbacks:false, require_parameters:true, data_collection:'deny',max_price:terms.maxPrice};
  const base = {model:terms.modelId, provider};
  const path = terms.kind === 'chat' ? 'chat/completions' : terms.kind === 'image' ? 'images' : 'audio/speech';
  const body = terms.kind === 'chat' ? {...base, messages:[{role:'user',content:input.prompt}], stream:false,
    [terms.limits.tokenParameter!]:terms.limits.maxOutputTokens}
    : terms.kind === 'image' ? {...base,prompt:input.prompt,n:1,output_format:'png'}
    : {...base,input:input.prompt,voice:terms.limits.voice,response_format:'mp3'};
  const response = await fetcher(`https://openrouter.ai/api/v1/${path}`, {
    method:'POST', headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','HTTP-Referer':'https://helixboxide.xyz','X-Title':'HelixBox'},
    body:JSON.stringify(body), signal:AbortSignal.timeout(90000), redirect:'error',
  });
  if (!response.ok) throw new Error(`Model provider rejected the request (${response.status})`);
  const bytes = await bytesBounded(response, 12 * 1024 * 1024);
  if (terms.kind === 'voice') {
    const type = response.headers.get('content-type')?.split(';')[0];
    if (type !== 'audio/mpeg' || bytes.length < 3 || !(bytes.subarray(0,3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) {
      throw new Error('Model returned invalid audio output');
    }
    await validateMP3(bytes);
    return {kind:'voice', mediaType:'audio/mpeg', base64:bytes.toString('base64'), generationId:response.headers.get('x-generation-id'), providerCost:null};
  }
  const data = JSON.parse(bytes.toString('utf8'));
  const generationId = typeof data.id === 'string' ? data.id.slice(0,180) : null;
  const providerCost = typeof data.usage?.cost === 'number' && Number.isFinite(data.usage.cost) && data.usage.cost >= 0 ? data.usage.cost : null;
  if (terms.kind === 'chat') {
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim() || data.error) throw new Error('Model returned no complete text output');
    if (data.choices[0].finish_reason !== 'stop' || text.length > 100000) throw new Error('Model returned incomplete output');
    return {kind:'chat',text,generationId,providerCost};
  }
  const images = data.data;
  if (!Array.isArray(images) || images.length !== 1 || typeof images[0].b64_json !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(images[0].b64_json)) throw new Error('Model returned invalid image output');
  const image = Buffer.from(images[0].b64_json,'base64');
  validatePNG(image);
  return {kind:'image',mediaType:'image/png',base64:image.toString('base64'),generationId,providerCost};
}
