import { z } from 'zod';
import { cfg } from './config.js';
import { db, isSuppressed, type Lead } from './db.js';
import { chatJson } from './llm.js';
import { pickModels, savingsPer1000, type ModelPrice } from './pricing.js';
import { bullets, product } from './product.js';
import { Research } from './research.js';
import { renderHtml, renderText } from './template.js';

export const Copy = z.object({
  subject: z.string().max(70),
  preheader: z.string().max(110),
  greeting: z.string(),
  opening: z.string().describe('2–3 предложения про НИХ: конкретика из hooks/сигнала'),
  bridge: z.string().describe('1 предложение: почему мы им пишем и чем полезны'),
  offers: z.array(z.object({ title: z.string().max(60), body: z.string().max(260) })).length(3),
  cta_text: z.string().max(40),
  ps: z.string().max(240),
});
export type Copy = z.infer<typeof Copy>;

const Critic = z.object({
  score: z.number().min(0).max(10),
  issues: z.array(z.string()),
});

const FACTS = (lang: 'ru' | 'en') => lang === 'ru'
  ? `Факты о ${product.name} (использовать можно ТОЛЬКО их):\n${bullets(product.facts.ru)}\nНельзя:\n${bullets(product.forbidden.ru)}`
  : `Facts about ${product.name} (use ONLY these):\n${bullets(product.facts.en)}\nNever:\n${bullets(product.forbidden.en)}`;

const senderName = (lang: 'ru' | 'en') => (lang === 'en' ? cfg.sender.nameEn : cfg.sender.name);

const SYSTEM = (lang: 'ru' | 'en') => `Ты пишешь первое холодное B2B-письмо от лица ${senderName(lang)} (${cfg.sender.title}). Цель — ответ или пробное использование продукта, а не «прочитали рекламу».

${FACTS(lang)}

Структура и правила:
- Язык письма: ${lang === 'ru' ? 'русский, на «вы» со строчной' : 'natural, plain English, как пишет носитель'}.
- greeting: по имени, если есть contact_name, иначе ${lang === 'ru' ? '«Здравствуйте!»' : '"Hi there,"'}.
- opening (2 предложения): про ИХ продукт и задачу, их словами. Наблюдение из сигнала — как повод, а не как улика: «вижу, что X генерирует ответы через Y» лучше, чем «в файле Z ваш код ходит в Y». Никаких «мы проанализировали».
- bridge (1 предложение): чем мы полезны именно им. Без перечисления всех фич.
- offers (3 пункта): три РАЗНЫХ угла, выбранных под их случай из: ${product.angles[lang].join('; ')}. title — выгода в 3–6 словах. body — 1–2 коротких предложения про их сценарий. Цены и проценты в offers НЕ повторяй, они в таблице под письмом; допустима одна фраза «около $X с каждой $1000» в пункте про экономию.
- Всё письмо (opening+bridge+offers+ps) — 90–140 слов.
- subject: до 55 символов, с названием их продукта, без спам-слов и восклицаний.
- preheader: продолжает тему, не повторяет subject.
- cta_text: 2–4 слова, глагол.
- ps: один крючок — ${product.psHook[lang]}. Не оценивай, на что хватит бонуса или сколько запросов это даст.
- Тон: основатель пишет основателю. Без канцелярита, «уникального предложения», «рады предложить», восклицательных знаков, эмодзи, капса.
Ответ — строго JSON: {"subject","preheader","greeting","opening","bridge","offers":[{"title","body"},{"title","body"},{"title","body"}],"cta_text","ps"}.`;

function priceTable(models: ModelPrice[]): string {
  if (!models.length) return 'нет (в письме цен не будет — не называй цифры)';
  return models.map((m) => `${m.name}: у вендора $${m.offIn}/$${m.offOut} за 1M токенов (вход/выход), у нас $${m.inUsd.toFixed(2)}/$${m.outUsd.toFixed(2)}, дешевле на ${m.discountPct}%`).join('\n')
    + `\nС каждой $1000 расходов на эти модели остаётся примерно $${savingsPer1000(models)}.`;
}

export async function draftFor(lead: Lead): Promise<{ copy: Copy; models: ModelPrice[]; critic: z.infer<typeof Critic> }> {
  const r = Research.parse(JSON.parse(lead.research!));
  const models = await pickModels(r.models_mentioned, r.segment);
  const brief = `Компания: ${r.company} (${lead.website})
Чем занимаются: ${r.summary}
ИИ у них: ${r.ai_usage}
Текущий поставщик: ${r.current_provider ?? 'неизвестно'}
Сигнал: ${lead.signal ?? 'нет'}
Контакт: ${lead.contact_name ? `${lead.contact_name}${lead.contact_title ? `, ${lead.contact_title}` : ''}` : r.contact_name ?? 'неизвестен'} (письмо уходит на ${lead.email})
Зацепки: ${r.hooks.join(' | ')}
Где мы полезны: ${r.use_cases.join(' | ')}

Таблица цен (живая, с витрины):
${priceTable(models)}`;

  const sys = SYSTEM(r.lang);
  let copy = await chatJson(cfg.llm.writer, [{ role: 'system', content: sys }, { role: 'user', content: brief }], Copy, 0.7);
  let critic = await review(copy, brief, r.lang);
  if (critic.score < 8) {  // одна попытка переписать; дальше решает человек в review
    copy = await chatJson(cfg.llm.writer, [
      { role: 'system', content: sys },
      { role: 'user', content: brief },
      { role: 'assistant', content: JSON.stringify(copy) },
      { role: 'user', content: `Редактор поставил ${critic.score}/10. Исправь: \n- ${critic.issues.join('\n- ')}\nВерни полный JSON.` },
    ], Copy, 0.5);
    critic = await review(copy, brief, r.lang);
  }
  return { copy, models, critic };
}

async function review(copy: Copy, brief: string, lang: 'ru' | 'en') {
  return chatJson(cfg.llm.critic, [
    { role: 'system', content: `Ты редактор холодных B2B-писем. Оцени черновик по рубрике и верни итоговый балл 0–10.

Блокеры (каждый — балл не выше 5):
- факт, которого нет ни в брифе, ни в списке фактов ниже;
- любое утверждение из списка «нельзя»;
- письмо подойдёт любой компании: в opening нет конкретики про их продукт.

Минусы по 1 баллу: первое предложение про отправителя; повтор цен из таблицы в offers; два offers про одно и то же; канцелярит или спам-слова; длиннее 160 слов; ${lang === 'ru' ? 'ошибки русского, «Вы» с прописной' : 'неестественный английский'}.

Хорошее письмо без блокеров и минусов — 9–10. Не придирайся к вкусовщине: в issues только то, что реально снижает балл, каждое — конкретная правка.

${FACTS(lang)}

Ответ — JSON {"score": число, "issues": ["...", ...]}.` },
    { role: 'user', content: `БРИФ:\n${brief}\n\nЧЕРНОВИК:\n${JSON.stringify(copy, null, 1)}` },
  ], Critic, 0);
}

export async function draftPending(limit: number, concurrency = 3): Promise<void> {
  const leads = db.prepare(`SELECT * FROM leads WHERE status = 'verified' ORDER BY fit_score DESC, id LIMIT ?`).all(limit) as Lead[];
  let i = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (i < leads.length) {
      const l = leads[i++];
      if (isSuppressed(l.email!)) { console.log(`  #${l.id} ${l.email}: в стоп-листе`); continue; }
      try {
        const { copy, models, critic } = await draftFor(l);
        const r = Research.parse(JSON.parse(l.research!));
        const ctx = { lead: l, research: r, copy, models };
        db.prepare(`INSERT INTO messages (lead_id, to_email, subject, html, text, critic, copy) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(l.id, l.email, copy.subject, renderHtml(ctx), renderText(ctx), JSON.stringify(critic), JSON.stringify({ copy, models }));
        db.prepare(`UPDATE leads SET status = 'drafted', updated_at = datetime('now') WHERE id = ?`).run(l.id);
        console.log(`  #${l.id} ${l.domain}: «${copy.subject}» — редактор ${critic.score}/10`);
      } catch (e) {
        console.log(`  #${l.id} ${l.domain}: ошибка ${(e as Error).message.slice(0, 200)}`);
      }
    }
  }));
}

/** Перерисовать HTML/текст неотправленных писем после правки шаблона, без LLM. */
export function rerenderDrafts(): number {
  const rows = db.prepare(`SELECT id, lead_id, copy FROM messages WHERE status IN ('draft', 'approved') AND copy IS NOT NULL`)
    .all() as { id: number; lead_id: number; copy: string }[];
  for (const m of rows) {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(m.lead_id) as Lead;
    const { copy, models } = JSON.parse(m.copy) as { copy: Copy; models: ModelPrice[] };
    const ctx = { lead, research: Research.parse(JSON.parse(lead.research!)), copy, models };
    db.prepare(`UPDATE messages SET html = ?, text = ? WHERE id = ?`).run(renderHtml(ctx), renderText(ctx), m.id);
  }
  return rows.length;
}
