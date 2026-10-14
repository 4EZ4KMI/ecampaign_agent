import { githubToken } from '../config.js';
import { addLead } from './common.js';
import { product } from '../product.js';

/**
 * Лиды из публичного кода: кто в открытых репозиториях вызывает API, похожий на ваш
 * (запросы — github.queries в product.json). Сигнал «уже платят за аналог» сильный,
 * но среди владельцев репозиториев много частных разработчиков — дальше работает сито.
 */
export const DEFAULT_QUERIES = product.github.queries;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gh<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { authorization: `Bearer ${githubToken()}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    });
    if ((res.status === 403 || res.status === 429) && attempt < 3) {
      const reset = Number(res.headers.get('x-ratelimit-reset') ?? 0) * 1000;
      const wait = Math.min(Math.max(reset - Date.now(), 10_000), 90_000);
      console.log(`  GitHub rate limit, ждём ${Math.round(wait / 1000)} с`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`GitHub ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

type CodeHit = { path: string; repository: { full_name: string; html_url: string; owner: { login: string } } };
type Owner = { login: string; type: string; name: string | null; company: string | null; blog: string | null; email: string | null; public_repos: number };

export async function discoverGithub(queries = DEFAULT_QUERIES, maxPerQuery = 50): Promise<number> {
  const seenOwners = new Set<string>();
  let added = 0;
  for (const q of queries) {
    const hits: CodeHit[] = [];
    for (let page = 1; hits.length < maxPerQuery && page <= 5; page++) {
      const r = await gh<{ items: CodeHit[] }>(`/search/code?q=${encodeURIComponent(q)}&per_page=50&page=${page}`);
      hits.push(...r.items);
      if (r.items.length < 50) break;
      await sleep(7000); // code search: 10 запросов в минуту
    }
    let qAdded = 0;
    for (const h of hits.slice(0, maxPerQuery)) {
      const login = h.repository.owner.login;
      if (seenOwners.has(login)) continue;
      seenOwners.add(login);
      const o = await gh<Owner>(`/users/${login}`);
      if (!o.blog) continue;
      const provider = q.replace(/"/g, '').split('/')[0];
      const ok = addLead({
        website: o.blog,
        company: o.name ?? o.company?.replace(/^@/, '') ?? login,
        source: `github:${q}`,
        signal: `В открытом репозитории ${h.repository.full_name} (${h.repository.html_url}) код ходит в ${provider} (файл ${h.path}). GitHub-аккаунт: ${o.type === 'Organization' ? 'организация' : 'пользователь'} ${login}.`,
        emails: o.email ? [o.email] : [],
      });
      if (ok) { added++; qAdded++; }
    }
    console.log(`  ${q}: найдено ${hits.length} файлов, новых лидов с сайтом ${qAdded}`);
    await sleep(7000);
  }
  return added;
}
