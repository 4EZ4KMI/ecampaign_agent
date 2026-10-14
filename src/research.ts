import { z } from 'zod';
import { cfg } from './config.js';
import { db, skipLead, updateLead, type Lead } from './db.js';
import { chatJson } from './llm.js';
import { crawlSite } from './site.js';
import { product } from './product.js';

export const Research = z.object({
  company: z.string(),
  summary: z.string().describe('чем занимается компания, 1–2 предложения'),
  ai_usage: z.string().describe('что они делают с LLM/генерацией — только из фактов'),
  current_provider: z.string().nullable(),
  models_mentioned: z.array(z.string()),
  entity: z.enum(['company', 'startup', 'freelancer', 'individual', 'academic', 'nonprofit', 'platform_profile']),
  signal_strength: z.enum(['production', 'product_feature', 'demo_or_tutorial', 'personal_config', 'none']),
  segment: z.enum(['ai_product', 'dev_studio', 'saas_with_ai', 'ecommerce', 'media_content', 'enterprise', 'other']),
  fit_score: z.number().int().min(0).max(10),
  fit_reason: z.string(),
  lang: z.enum(['ru', 'en']),
  contact_name: z.string().nullable(),
  hooks: z.array(z.string()).min(1).max(4).describe('конкретные зацепки для первого абзаца письма'),
  use_cases: z.array(z.string()).min(1).max(3).describe('где именно продукт им пригодится'),
});
export type Research = z.infer<typeof Research>;

const SYSTEM = `Ты — аналитик отдела продаж ${product.name}. ${product.pitch.ru}

Задача: по тексту сайта компании и сигналу понять, нужен ли им ${product.name}, и подготовить зацепки для персонального письма.

Правила:
- Только факты из переданных материалов. Не выдумывай продукты, клиентов, цифры и имена.
- entity: кто это. company/startup — бизнес с продуктом или услугами; freelancer — частный разработчик, продающий услуги; individual — личный сайт/блог без коммерции; academic — вуз, лаборатория, исследовательский проект; nonprofit; platform_profile — страница на чужой платформе (boosty, patreon и т.п.).
- signal_strength: насколько сигнал говорит о РЕАЛЬНЫХ расходах на токены. production — LLM в продакшене их продукта; product_feature — ИИ-функция заявлена на сайте; demo_or_tutorial — пример, учебный репозиторий, бенчмарк, плейграунд; personal_config — dotfiles, личный конфиг, пет-проект; none.
- fit_score — вероятность, что они станут ПЛАТЯЩИМ клиентом с заметным объёмом:
  9–10: company/startup, production, LLM — ядро продукта;
  7–8: company/startup с product_feature, или dev-студия, делающая ИИ-проекты клиентам;
  5–6: freelancer с ИИ-услугами, или компания, где ИИ — побочная тема;
  3–4: individual/academic/nonprofit, demo_or_tutorial;
  0–2: personal_config, platform_profile, нет связи с ИИ, пустой сайт, госструктура, конкурент-агрегатор.
  Само по себе упоминание OpenRouter/посредника в репозитории НЕ даёт выше 4: смотри, кто они и зачем им это.
- Прямые конкуренты (${product.competitorDomains.join(', ')} и подобные) → fit_score 0.
- lang: язык сайта (ru для русскоязычных, иначе en).
- contact_name — только если на сайте явно указан основатель/CEO/CTO, иначе null.
- hooks — конкретика про ИХ продукт, по которой видно, что письмо написано лично им (название продукта, функция, кейс). Без общих фраз.
Ответ — строго JSON по схеме: ${JSON.stringify(Object.keys(Research.shape))}.`;

export async function researchLead(lead: Lead): Promise<void> {
  const site = await crawlSite(lead.website);
  if (!site) return skipLead(lead.id, 'сайт не открылся');
  const emails = [...new Set([...JSON.parse(lead.emails) as string[], ...site.emails])];
  const material = site.pages.map((p) => `### ${p.url}\n${p.text}`).join('\n\n').slice(0, 30_000);
  const r = await chatJson(cfg.llm.research, [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Компания: ${lead.company ?? lead.domain} (${lead.website})\nСигнал: ${lead.signal ?? 'нет'}${lead.contact_name ? `\nКонтакт из базы: ${lead.contact_name}${lead.contact_title ? `, ${lead.contact_title}` : ''}` : ''}${lead.meta ? `\nДанные источника: ${lead.meta.slice(0, 1500)}` : ''}\n\nСайт:\n${material}` },
  ], Research, 0.2);
  updateLead(lead.id, {
    status: 'researched', research: JSON.stringify(r), fit_score: r.fit_score, lang: r.lang,
    company: r.company || lead.company, emails: JSON.stringify(emails),
  });
}

export async function researchPending(limit: number, concurrency = 4): Promise<void> {
  const leads = db.prepare(`SELECT * FROM leads WHERE status = 'triaged' ORDER BY id LIMIT ?`).all(limit) as Lead[];
  let i = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (i < leads.length) {
      const l = leads[i++];
      try {
        await researchLead(l);
        const fresh = db.prepare('SELECT fit_score, status, skip_reason FROM leads WHERE id = ?').get(l.id) as Lead;
        console.log(`  #${l.id} ${l.domain}: ${fresh.status === 'skipped' ? `пропуск (${fresh.skip_reason})` : `fit ${fresh.fit_score}/10`}`);
      } catch (e) {
        console.log(`  #${l.id} ${l.domain}: ошибка ${(e as Error).message.slice(0, 200)}`);
      }
    }
  }));
}
