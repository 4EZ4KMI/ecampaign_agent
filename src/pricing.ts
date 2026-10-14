import { product } from './product.js';

export type ModelPrice = {
  id: string; name: string; provider: string;
  inUsd: number; outUsd: number; offIn: number; offOut: number; discountPct: number;
};

let cache: ModelPrice[] | null = null;

/**
 * Живые цены с витрины продукта (pricing.catalogUrl в product.json). Ожидается формат
 * { data: [{ id, surface: 'chat', display: {name, provider}, pricing: { prompt_per_1m_usd, completion_per_1m_usd,
 *   official_prompt_per_1m_usd, official_completion_per_1m_usd, discount_pct } }] }.
 * pricing: null — письма без таблицы цен.
 */
export async function chatCatalog(): Promise<ModelPrice[]> {
  if (cache) return cache;
  if (!product.pricing) return (cache = []);
  const res = await fetch(product.pricing.catalogUrl);
  if (!res.ok) throw new Error(`каталог: HTTP ${res.status}`);
  type Raw = { id: string; surface: string; display?: { name?: string; provider?: string }; pricing: Record<string, number | undefined> };
  const { data } = (await res.json()) as { data: Raw[] };
  cache = data
    .filter((m) => m.surface === 'chat' && m.pricing.official_prompt_per_1m_usd && m.pricing.discount_pct)
    .map((m) => ({
      id: m.id, name: m.display?.name ?? m.id, provider: m.display?.provider ?? '',
      inUsd: m.pricing.prompt_per_1m_usd!, outUsd: m.pricing.completion_per_1m_usd!,
      offIn: m.pricing.official_prompt_per_1m_usd!, offOut: m.pricing.official_completion_per_1m_usd!,
      discountPct: m.pricing.discount_pct!,
    }));
  return cache;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]/g, '');

/** Подбирает 3 модели: сначала те, что упомянуты у них, потом дефолт сегмента. */
export async function pickModels(mentioned: string[], segment: string, n = 3): Promise<ModelPrice[]> {
  const cat = await chatCatalog();
  const out: ModelPrice[] = [];
  const push = (m?: ModelPrice) => { if (m && !out.some((x) => x.id === m.id)) out.push(m); };
  for (const raw of mentioned) {
    const k = norm(raw);
    if (k.length < 3) continue;
    push(cat.find((m) => norm(m.id) === k) ?? cat.find((m) => norm(m.id).startsWith(k) || k.startsWith(norm(m.id))));
  }
  const defaults = product.pricing?.defaults ?? {};
  for (const id of defaults[segment] ?? defaults.other ?? []) push(cat.find((m) => m.id === id));
  return out.slice(0, n);
}

/** Сколько остаётся с каждой $1000 при текущем миксе моделей (по средней скидке). */
export function savingsPer1000(models: ModelPrice[]): number {
  const avg = models.reduce((s, m) => s + m.discountPct, 0) / Math.max(models.length, 1);
  return Math.round(avg * 10);
}
