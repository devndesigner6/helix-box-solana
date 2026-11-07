import type { CatalogModel } from './model-catalog.ts';

export interface ModelCallInput { prompt: string; maxOutputTokens?: number; voice?: string }
export interface ModelQuoteTerms {
  modelId: string; kind: CatalogModel['kind']; provider: string; amount: string; expiresAt: number;
  markupBps: number; minimumAmount: string;
  maxPrice: Record<string,number>;
  limits: { promptBytes: number; maxOutputTokens?: number; tokenParameter?: string; voice?: string; count?: number; format?: string };
}
function rate(value: unknown): bigint {
  const text = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toFixed(18) : value;
  if (typeof text !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(text)) throw new Error('Unverified model pricing');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
}

export function quoteModelCall(model: CatalogModel, endpoints: any[], input: ModelCallInput, now = Date.now(), markupBps = 2000): ModelQuoteTerms {
  if (model.kind === 'chat' && (model.outputModalities?.length !== 1 || model.outputModalities[0] !== 'text')) throw new Error('Model requires a verified text-only output modality');
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) throw new Error('A prompt is required');
  const bytes = Buffer.byteLength(input.prompt, 'utf8');
  if (bytes > (model.kind === 'voice' ? 2000 : 8000)) throw new Error('Prompt exceeds the call limit');
  if (!Number.isInteger(markupBps) || markupBps < 0 || markupBps > 10000) throw new Error('Invalid model pricing policy');
  const output = input.maxOutputTokens ?? 512;
  if (!Number.isInteger(output) || output < 1 || output > 2048) throw new Error('Output token limit must be 1-2048');
  const candidates: ModelQuoteTerms[] = [];
  for (const endpoint of endpoints) {
    try {
      const provider = endpoint.tag ?? endpoint.provider_tag;
      if (typeof provider !== 'string' || !provider || (typeof endpoint.status === 'number' && endpoint.status !== 0)) continue;
      let cost = 0n;
      const maxPrice:Record<string,number>={};
      const limits: ModelQuoteTerms['limits'] = {promptBytes:bytes};
      if (model.kind !== 'image') {
        for (const [key,value] of Object.entries(endpoint.pricing ?? {})) {
          if (!['prompt','completion','request','input_cache_read','input_cache_write','discount'].includes(key) && rate(value) !== 0n) throw new Error('Unbounded billing dimension');
        }
      }
      if (model.kind === 'chat') {
        const parameters = endpoint.supported_parameters;
        const tokenParameter = Array.isArray(parameters) && parameters.includes('max_tokens') ? 'max_tokens'
          : Array.isArray(parameters) && parameters.includes('max_completion_tokens') ? 'max_completion_tokens' : null;
        if (!tokenParameter) continue;
        const context = endpoint.context_length ?? model.contextLength;
        if (context && bytes + 512 + output > context) continue;
        if (endpoint.max_completion_tokens && output > endpoint.max_completion_tokens) continue;
        // A byte bound safely exceeds text token counts; include framing overhead.
        const promptRate=[rate(endpoint.pricing.prompt),rate(endpoint.pricing.input_cache_read??'0'),rate(endpoint.pricing.input_cache_write??'0')].reduce((a,b)=>a>b?a:b);
        cost = promptRate * BigInt(bytes + 512) + rate(endpoint.pricing.completion) * BigInt(output);
        if (endpoint.pricing.request !== undefined) cost += rate(endpoint.pricing.request);
        maxPrice.prompt=Number(promptRate)/1e12;maxPrice.completion=Number(rate(endpoint.pricing.completion))/1e12;
        maxPrice.request=Number(rate(endpoint.pricing.request??'0'))/1e18;
        limits.maxOutputTokens = output; limits.tokenParameter = tokenParameter;
      } else if (model.kind === 'image') {
        if (!Array.isArray(endpoint.pricing)) continue;
        const parameters=endpoint.supported_parameters;
        if (!parameters?.output_format?.values?.includes('png') || parameters?.n?.type !== 'range' || parameters.n.min > 1 || parameters.n.max < 1) continue;
        let outputPriced = false;
        for (const line of endpoint.pricing) {
          const price = rate(line.cost_usd);
          if (line.variant || (line.billable === 'output_image' && line.unit !== 'image')) throw new Error('Unbounded image pricing');
          if (line.billable === 'output_image' && line.unit === 'image') { cost += price; outputPriced = true; maxPrice.image=Number(price)/1e18; }
          else if (line.billable === 'input_text' && line.unit === 'token') {cost += price * BigInt(bytes + 512);maxPrice.prompt=Number(price)/1e12;}
          else if (line.billable === 'input_image') continue; // this route accepts no reference images
          else if (price !== 0n) throw new Error('Unsupported image price unit');
        }
        if (!outputPriced) continue;
        limits.count = 1; limits.format = 'png';
      } else {
        if (!input.voice || !model.voices.includes(input.voice)) continue;
        // Per-second audio cannot be bounded from text length; do not guess its duration.
        if (rate(endpoint.pricing.completion) !== 0n) continue;
        const promptRate=[rate(endpoint.pricing.prompt),rate(endpoint.pricing.input_cache_read??'0'),rate(endpoint.pricing.input_cache_write??'0')].reduce((a,b)=>a>b?a:b);
        cost = promptRate * BigInt(input.prompt.length);
        cost += rate(endpoint.pricing.request??'0');
        maxPrice.prompt=Number(promptRate)/1e12;maxPrice.completion=0;maxPrice.request=Number(rate(endpoint.pricing.request??'0'))/1e18;
        limits.voice = input.voice; limits.format = 'mp3';
      }
      const micro = (cost + 10n ** 12n - 1n) / 10n ** 12n;
      const marked = (micro * BigInt(10000 + markupBps) + 9999n) / 10000n;
      const amount = marked < 1000n ? 1000n : marked;
      if (amount > 1000000n) continue;
      candidates.push({modelId:model.id, kind:model.kind, provider, amount:String(amount), expiresAt:now+120000,
        markupBps, minimumAmount:'1000', limits,maxPrice});
    } catch { /* A provider without completely understood billing is not eligible. */ }
  }
  candidates.sort((a,b) => BigInt(a.amount) < BigInt(b.amount) ? -1 : BigInt(a.amount) > BigInt(b.amount) ? 1 : a.provider.localeCompare(b.provider));
  if (!candidates.length) throw new Error('No available provider has a verified bounded price for this operation');
  return candidates[0];
}
