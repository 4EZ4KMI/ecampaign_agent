import { importRecords } from './records.js';
import { product } from '../product.js';

/**
 * Apify-акторы напрямую через REST (без CLI и Python-скриптов скилла).
 * leads-finder — база компаний и людей с почтами (её же использует скилл scrape-leads).
 * Цена у актора своя: проверить в console.apify.com перед большими выгрузками.
 */
export const ICP = product.apify;

export async function runActor(actor: string, input: Record<string, unknown>, timeoutSec = 600): Promise<Record<string, unknown>[]> {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) throw new Error('Нет APIFY_TOKEN в .env (console.apify.com → Settings → API & Integrations)');
  const url = `https://api.apify.com/v2/acts/${actor.replace('/', '~')}/run-sync-get-dataset-items?timeout=${timeoutSec}&format=json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout((timeoutSec + 30) * 1000),
  });
  if (!res.ok) throw new Error(`Apify ${actor}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as Record<string, unknown>[];
}

export async function discoverApifyLeads(opts: { count: number; locations: string[]; titles?: string[]; keywords?: string[] }) {
  const rows = await runActor('code_crafter/leads-finder', {
    fetch_count: opts.count,
    contact_job_title: opts.titles ?? ICP.titles,
    company_keywords: opts.keywords ?? ICP.keywords,
    contact_location: opts.locations,
    email_status: ['validated'],
    language: 'en',
  });
  return importRecords(rows, 'apify:leads-finder', `Компания из B2B-базы по ключевым словам (${(opts.keywords ?? ICP.keywords).slice(0, 4).join(', ')}).`);
}
