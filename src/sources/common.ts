import { db } from '../db.js';

/** Хосты, которые не являются сайтом компании. */
const NOT_COMPANY = /(^|\.)(github\.(io|com)|gitlab\.(io|com)|vercel\.app|netlify\.app|pages\.dev|herokuapp\.com|t\.me|telegram\.me|linkedin\.com|twitter\.com|x\.com|medium\.com|habr\.com|vk\.com|youtube\.com|notion\.site|bit\.ly|linktr\.ee|google\.com|gmail\.com|huggingface\.co|boosty\.to|patreon\.com|ko-fi\.com|buymeacoffee\.com|substack\.com|tilda\.ws|itch\.io|gumroad\.com|wordpress\.com|blogspot\.com|tumblr\.com|carrd\.co|about\.me|read\.cv|bento\.me)$/i;

export function normalizeSite(raw: string): { website: string; domain: string } | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    const domain = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!domain.includes('.') || NOT_COMPANY.test(domain)) return null;
    return { website: `${u.protocol}//${u.hostname}`, domain };
  } catch {
    return null;
  }
}

export type NewLead = {
  website: string; company?: string; source: string; signal?: string; emails?: string[];
  contactName?: string; contactTitle?: string; meta?: Record<string, unknown>;
};

/** Добавляет лида, если домена ещё нет. Возвращает true, если добавлен. */
export function addLead(l: NewLead): boolean {
  const n = normalizeSite(l.website);
  if (!n) return false;
  const r = db.prepare(`INSERT OR IGNORE INTO leads (domain, website, company, source, signal, emails, contact_name, contact_title, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(n.domain, n.website, l.company ?? null, l.source, l.signal ?? null,
    JSON.stringify(l.emails ?? []), l.contactName ?? null, l.contactTitle ?? null, l.meta ? JSON.stringify(l.meta) : null);
  return r.changes > 0;
}
