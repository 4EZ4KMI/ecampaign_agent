import fs from 'node:fs';
import { addLead } from './common.js';

/**
 * Универсальный импорт выгрузок из скиллов и сервисов: Apify (leads-finder, Google Maps,
 * LinkedIn), Firecrawl/ScrapeGraph extract, Clay, Apollo CSV→JSON. Поля у всех называются
 * по-разному, поэтому ищем по списку синонимов, в том числе во вложенных объектах.
 */
const F = {
  website: ['company_website', 'website', 'companyWebsite', 'organization_website_url', 'website_url', 'company_url', 'url', 'domain', 'company_domain', 'organization.website_url', 'company.website', 'company.domain'],
  company: ['company_name', 'companyName', 'organization_name', 'organization.name', 'company.name', 'company', 'title', 'name'],
  email: ['email', 'work_email', 'personal_email', 'contact_email', 'emails', 'email_address'],
  first: ['first_name', 'firstName'],
  last: ['last_name', 'lastName'],
  full: ['full_name', 'fullName', 'contact_name', 'person_name'],
  title: ['job_title', 'jobTitle', 'headline', 'contact_title', 'position'],
  extra: ['industry', 'company_industry', 'organization.industry', 'company_size', 'employee_count', 'estimated_num_employees', 'organization.estimated_num_employees', 'keywords', 'company_keywords', 'company_description', 'description', 'categoryName', 'country', 'city', 'company_country', 'linkedin', 'linkedin_url', 'company_linkedin', 'technologies', 'funding'],
};

function get(o: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), o);
}
function pick(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = get(o, k);
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
    if (Array.isArray(v) && v[0] && typeof v[0] === 'object' && 'value' in v[0]) return String((v[0] as { value: unknown }).value);
  }
  return undefined;
}

export function importRecords(rows: Record<string, unknown>[], source: string, signal?: string): { added: number; noSite: number; dup: number } {
  let added = 0, noSite = 0, dup = 0;
  for (const r of rows) {
    // в «website» Google Maps иногда кладёт имя, а «name» у компании — это company; url без точки отбрасывает normalizeSite
    const website = pick(r, F.website);
    if (!website) { noSite++; continue; }
    const name = pick(r, F.full) ?? [pick(r, F.first), pick(r, F.last)].filter(Boolean).join(' ') ?? undefined;
    const meta: Record<string, unknown> = {};
    for (const k of F.extra) { const v = get(r, k); if (v !== undefined && v !== null && v !== '') meta[k] = v; }
    const email = pick(r, F.email);
    const ok = addLead({
      website, source, signal,
      company: pick(r, F.company),
      emails: email && email.includes('@') ? [email.toLowerCase()] : [],
      contactName: name || undefined,
      contactTitle: pick(r, F.title),
      meta,
    });
    if (ok) added++; else dup++;
  }
  return { added, noSite, dup };
}

export function importJsonFile(file: string, source: string, signal?: string) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  // форматы: массив; {items:[]}; {data:[]}; {data:{results:[]}}; JSONL
  const rows = Array.isArray(raw) ? raw
    : (raw as { items?: unknown[] }).items ?? (raw as { data?: unknown[] }).data as unknown[] ?? [];
  const list = Array.isArray(rows) ? rows : ((rows as { results?: unknown[] }).results ?? []);
  return importRecords(list as Record<string, unknown>[], source, signal);
}
