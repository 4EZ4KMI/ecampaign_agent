import { z } from 'zod';
import { cfg } from './config.js';
import { db, isSuppressed, skipLead, updateLead, type Lead } from './db.js';
import { chatJson } from './llm.js';
import { bullets, product } from './product.js';

/**
 * Сито до ресёрча. Выгрузки из Apify/Maps/скрейперов на 70–90% мусор, а ресёрч стоит
 * обхода сайта и вызова модели на каждого лида. Поэтому два дешёвых прохода:
 *   1) правила без LLM — то, что видно по домену, должности и размеру;
 *   2) одна быстрая модель размечает лидов пачками по 25 по имени, отрасли и описанию.
 * Выжившие получают статус triaged и идут в research.
 */

const isCompetitor = (domain: string) => product.competitorDomains.some((c) => domain === c || domain.endsWith(`.${c}`));
const BIGTECH = /(^|\.)(google\.com|microsoft\.com|amazon\.com|aws\.amazon\.com|meta\.com|facebook\.com|apple\.com|openai\.com|anthropic\.com|nvidia\.com|ibm\.com|oracle\.com|salesforce\.com|bytedance\.com|tiktok\.com|alibaba\.com|tencent\.com|baidu\.com|yandex\.(ru|com)|sber\.ru|sberbank\.ru|vk\.com|mts\.ru|ozon\.ru|wildberries\.ru|tinkoff\.ru|tbank\.ru)$/;
const PUBLIC_SECTOR = /\.(gov|mil|edu)(\.[a-z]{2})?$|\.(ac|gov|edu)\.[a-z]{2}$|\.gov\.ru$|(^|\.)(university|univ|college)\b/;
const BAD_TITLE = /\b(intern|student|trainee|recruit|talent|hr\b|human resources|assistant|receptionist|sales (rep|representative|associate)|account executive|teacher|professor)\b/i;
const MAX_EMPLOYEES = 2000;

function employees(meta: Record<string, unknown>): number | null {
  for (const k of ['employee_count', 'estimated_num_employees', 'company_size', 'organization.estimated_num_employees']) {
    const v = meta[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const nums = v.replace(/,/g, '').match(/\d+/g);
      if (nums) return Number(nums[nums.length - 1]);
    }
  }
  return null;
}

/** Проход 1: правила. Возвращает причину отказа или null. */
export function ruleReject(l: Lead): string | null {
  const meta = l.meta ? JSON.parse(l.meta) as Record<string, unknown> : {};
  if (isCompetitor(l.domain)) return 'конкурент';
  if (BIGTECH.test(l.domain)) return 'бигтех, не переключится на шлюз';
  if (PUBLIC_SECTOR.test(l.domain)) return 'госсектор/вуз';
  if (isSuppressed(`x@${l.domain}`)) return 'домен в стоп-листе';
  if (db.prepare(`SELECT 1 FROM messages WHERE status = 'sent' AND to_email LIKE ?`).get(`%@${l.domain}`)) return 'уже писали';
  const n = employees(meta);
  if (n !== null && n > MAX_EMPLOYEES) return `${n} сотрудников — энтерпрайз`;
  return null;
}

const Verdicts = z.object({
  leads: z.array(z.object({ id: z.number(), keep: z.boolean(), reason: z.string() })),
});

const SYSTEM = `Ты фильтруешь сырую выгрузку лидов для ${product.name}. ${product.pitch.ru}

Оставь (keep=true) тех, кто ВЕРОЯТНО станет платящим клиентом:
${bullets(product.triage.keep)}

Отсей (keep=false):
${bullets(product.triage.drop)}

Сомневаешься, но признаки нужного профиля есть — оставляй: дальше будет полный разбор сайта. reason — 3–8 слов.
Ответ — JSON {"leads":[{"id":число,"keep":true|false,"reason":"..."}]} для КАЖДОГО id из входа.`;

function card(l: Lead): string {
  const meta = l.meta ? JSON.parse(l.meta) as Record<string, unknown> : {};
  const m = Object.entries(meta).map(([k, v]) => `${k}=${String(Array.isArray(v) ? v.slice(0, 8).join(', ') : v).slice(0, 200)}`).join('; ');
  return `id=${l.id} | ${l.domain} | ${l.company ?? ''}${l.contact_title ? ` | контакт: ${l.contact_title}` : ''}${m ? ` | ${m}` : ''}${l.signal ? ` | сигнал: ${l.signal.slice(0, 200)}` : ''}`;
}

export async function triagePending(batchSize = 25): Promise<{ total: number; rules: number; llm: number; kept: number }> {
  const leads = db.prepare(`SELECT * FROM leads WHERE status = 'new' ORDER BY id`).all() as Lead[];
  const stat = { total: leads.length, rules: 0, llm: 0, kept: 0 };
  const rest: Lead[] = [];
  for (const l of leads) {
    // плохой контакт (стажёр, рекрутер) — не повод выкидывать компанию: убираем человека и его адрес,
    // почту потом найдём на сайте
    if (l.contact_title && BAD_TITLE.test(l.contact_title)) {
      const own = (JSON.parse(l.emails) as string[]).filter((e) => !e.toLowerCase().startsWith(`${(l.contact_name ?? '#').split(' ')[0].toLowerCase()}@`));
      updateLead(l.id, { contact_name: null, contact_title: null, emails: JSON.stringify(own) });
      l.contact_title = null; l.contact_name = null;
    }
    const why = ruleReject(l);
    if (why) { skipLead(l.id, `сито: ${why}`); updateLead(l.id, { triage: `rule: ${why}` }); stat.rules++; }
    else rest.push(l);
  }
  for (let i = 0; i < rest.length; i += batchSize) {
    const batch = rest.slice(i, i + batchSize);
    let verdicts: z.infer<typeof Verdicts>['leads'];
    try {
      verdicts = (await chatJson(cfg.llm.triage, [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: batch.map(card).join('\n') },
      ], Verdicts, 0)).leads;
    } catch (e) {
      // сито не должно терять лидов: при сбое модели пропускаем пачку дальше без вердикта
      console.log(`  пачка ${i / batchSize + 1}: модель не ответила (${(e as Error).message.slice(0, 120)}), пропускаю без фильтра`);
      verdicts = batch.map((l) => ({ id: l.id, keep: true, reason: 'сито недоступно' }));
    }
    const byId = new Map(verdicts.map((v) => [v.id, v]));
    for (const l of batch) {
      const v = byId.get(l.id) ?? { keep: true, reason: 'модель пропустила id' };
      updateLead(l.id, { triage: `llm: ${v.keep ? 'keep' : 'drop'} — ${v.reason}` });
      if (v.keep) { updateLead(l.id, { status: 'triaged' }); stat.kept++; }
      else { skipLead(l.id, `сито: ${v.reason}`); stat.llm++; }
    }
  }
  return stat;
}
