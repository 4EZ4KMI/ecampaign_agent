/**
 * Лёгкий сборщик сайта: главная + несколько внутренних страниц (о нас, продукт, цены,
 * контакты, API). Достаёт текст для LLM и все адреса почты. Для JS-сайтов, где fetch
 * отдаёт пустую оболочку, можно поднять crawl4ai и подменить fetchPage.
 */
const UA = 'Mozilla/5.0 (compatible; ecampaign-research/0.1)';
const INTERESTING = /(about|o-nas|company|kompaniya|team|product|produkt|pricing|ceny|tarif|price|contact|kontakt|api|docs|solutions|resheniya|services|uslugi|ai|ii)/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const VALID = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const BAD_EMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$|example\.|sentry|wixpress|@2x|domain\.|email\.com$/i;

export type SitePages = { url: string; text: string }[];

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null;
    return (await res.text()).slice(0, 800_000);
  } catch {
    return null;
  }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/&laquo;|&raquo;/g, '"').replace(/&mdash;/g, '—')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function extractEmails(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) found.add(decodeURIComponent(m[1]).toLowerCase());
  for (const m of htmlToText(html).matchAll(EMAIL_RE)) found.add(m[0].toLowerCase());
  return [...found].map((e) => e.trim().replace(/[\\.,;:]+$/, '')).filter((e) => VALID.test(e) && !BAD_EMAIL.test(e));
}

function internalLinks(html: string, base: URL): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
      if (/\.(pdf|png|jpe?g|zip|svg|xml)$/i.test(u.pathname)) continue;
      if (INTERESTING.test(u.pathname) && u.pathname !== '/') out.add(`${u.origin}${u.pathname}`);
    } catch { /* битая ссылка */ }
  }
  return [...out];
}

export async function crawlSite(website: string, maxPages = 5): Promise<{ pages: SitePages; emails: string[]; finalUrl: string } | null> {
  const home = await fetchPage(website);
  if (!home) return null;
  const base = new URL(website);
  const pages: SitePages = [{ url: website, text: htmlToText(home).slice(0, 12_000) }];
  const emails = new Set(extractEmails(home));
  // сначала контакты (там почта), потом остальное
  const links = internalLinks(home, base).sort((a, b) => Number(/contact|kontakt/i.test(b)) - Number(/contact|kontakt/i.test(a)));
  for (const url of links.slice(0, maxPages - 1)) {
    const html = await fetchPage(url);
    if (!html) continue;
    pages.push({ url, text: htmlToText(html).slice(0, 6_000) });
    extractEmails(html).forEach((e) => emails.add(e));
  }
  return { pages, emails: [...emails], finalUrl: website };
}
