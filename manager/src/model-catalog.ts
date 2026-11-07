export type ModelKind = 'chat' | 'image' | 'voice';
export interface CatalogModel {
  id: string; name: string; kind: ModelKind; description: string; contextLength: number;
  pricing: Record<string, string>; voices: string[]; endpoints: string[];
  parameters: unknown; inputModalities: string[]; outputModalities: string[];
}
export interface CatalogSnapshot { models: CatalogModel[]; configured: boolean; fetchedAt: number; warnings: string[] }
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const BASE = 'https://openrouter.ai/api/v1/';
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

export function normalizeModel(raw: unknown, kind: ModelKind): CatalogModel | null {
  const data = record(raw);
  if (typeof data.id !== 'string' || !/^[a-zA-Z0-9_.:-]+\/[a-zA-Z0-9_.:/-]+$/.test(data.id) || data.id.includes('..')) return null;
  const pricing = Object.fromEntries(Object.entries(record(data.pricing)).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string' && /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(entry[1])));
  const architecture = record(data.architecture);
  return { id: data.id, name: typeof data.name === 'string' ? data.name.slice(0, 160) : data.id,
    kind, description: typeof data.description === 'string' ? data.description.slice(0, 2000) : '',
    contextLength: Number.isFinite(data.context_length) ? data.context_length : 0,
    pricing, voices: strings(data.supported_voices), endpoints: strings(data.endpoints),
    parameters: data.supported_parameters ?? [], inputModalities: strings(architecture.input_modalities),
    outputModalities: strings(architecture.output_modalities) };
}

export function createModelCatalog({apiKey, fetcher = fetch}: {apiKey: string; fetcher?: Fetcher}) {
  let cached: CatalogSnapshot | null = null;
  let pending: Promise<CatalogSnapshot> | null = null;
  const details = new Map<string, {at: number; data: any}>();
  async function request(path: string): Promise<any> {
    const response = await fetcher(BASE + path, {
      headers: apiKey ? {Authorization: `Bearer ${apiKey}`, Accept:'application/json'} : {Accept:'application/json'},
      signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`Model catalog unavailable (${response.status})`);
    const text = await response.text();
    if (text.length > 12 * 1024 * 1024) throw new Error('Model catalog exceeds size limit');
    return JSON.parse(text);
  }
  async function load(): Promise<CatalogSnapshot> {
    const warnings: string[] = [];
    const sources: [string, ModelKind][] = [
      ['models?output_modalities=all', 'chat'], ['images/models', 'image'], ['models?output_modalities=speech', 'voice'],
    ];
    const groups = await Promise.all(sources.map(async ([path, kind]) => {
      try {
        const payload = await request(path);
        if (!Array.isArray(payload.data)) throw new Error('Invalid model catalog');
        return payload.data.map((raw: unknown) => normalizeModel(raw, kind)).filter((model: CatalogModel | null): model is CatalogModel =>
          !!model && (kind !== 'chat' || model.endpoints.includes('/api/v1/chat/completions') || model.outputModalities.includes('text')));
      } catch { warnings.push(`${kind} catalog is temporarily unavailable`); return []; }
    }));
    const models = [...new Map(groups.flat().map(model => [`${model.kind}:${model.id}`, model])).values()];
    if (!models.length) throw new Error('Live model catalogs are unavailable');
    return {models, configured: Boolean(apiKey), fetchedAt: Date.now(), warnings};
  }
  return {
    async list(): Promise<CatalogSnapshot> {
      if (cached && Date.now() - cached.fetchedAt < 300000) return cached;
      if (!pending) pending = load().then(value => cached = value).finally(() => {pending = null;});
      return pending;
    },
    async model(id: string, kind: ModelKind): Promise<CatalogModel> {
      const item = (await this.list()).models.find(model => model.id === id && model.kind === kind);
      if (!item) throw new Error('Model is not in the current catalog');
      return item;
    },
    async endpoints(id: string, kind: ModelKind, fresh=false): Promise<any> {
      await this.model(id, kind);
      const key = `${kind}:${id}`;
      const existing = details.get(key);
      if (!fresh && existing && Date.now() - existing.at < 60000) return existing.data;
      const path = (kind === 'image' ? 'images/models/' : 'models/') + id.split('/').map(encodeURIComponent).join('/') + '/endpoints';
      const raw = await request(path);
      const data = raw.data ?? raw;
      if (!Array.isArray(data.endpoints)) throw new Error('Model endpoint pricing is unavailable');
      details.set(key, {at:Date.now(), data});
      if (details.size > 1000) details.delete(details.keys().next().value!);
      return data;
    },
  };
}
