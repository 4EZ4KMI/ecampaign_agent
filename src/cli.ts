import { db, suppress } from './db.js';
import { buildReview } from './review.js';
import { researchPending } from './research.js';
import { sendApproved } from './send.js';
import { importCsv } from './sources/csv.js';
import { DEFAULT_QUERIES, discoverGithub } from './sources/github.js';
import { discoverApifyLeads } from './sources/apify.js';
import { importJsonFile } from './sources/records.js';
import { triagePending } from './triage.js';
import { verifyPending } from './verify.js';
import { draftPending, rerenderDrafts } from './write.js';

const [cmd, ...args] = process.argv.slice(2);
const flag = (name: string, d: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const ids = () => args.filter((a) => /^\d+$/.test(a)).map(Number);

const HELP = `ecampaign — агент холодных КП

Конвейер (каждый шаг можно гонять отдельно):
  discover github [--per 30] ["запрос" ...]   лиды из публичного кода (github.queries в product.json)
  discover apify [--count 100] [--locations "united states,germany"] [--keywords "llm,chatbot"] [--titles "CTO,Founder"]
                                               B2B-база через Apify code_crafter/leads-finder (нужен APIFY_TOKEN)
  discover json <file.json> [source] [signal]  любая выгрузка: Apify, Firecrawl/ScrapeGraph extract, Clay, Apollo
  discover csv <file.csv>                      импорт: website,company,email,signal
  triage                                       сито от мусора: правила + быстрая модель пачками по 25
  research [--limit 20]                        сайт → LLM: чем заняты, fit 0–10, зацепки
  verify [--min-fit 6]                         выбор и проверка адреса (MX, опционально Reacher)
  draft [--limit 10]                           КП: текст → редактор → HTML
  review                                       out/review/index.html со всеми черновиками
  rerender                                     перерисовать черновики после правки шаблона (без LLM)
  approve <id...> | approve --min-score 8      одобрить к отправке
  reject <id...>
  send                                         отправить одобренные (SEND_LIVE=0 → только .eml)
  run [--limit 10] [--min-fit 6]               triage → research → verify → draft → review за один проход

Служебное:
  stats                                        сколько лидов и писем на каждом этапе
  stop <email|domain> [причина]                в стоп-лист (ответили «стоп», отписка)`;

async function main() {
  switch (cmd) {
    case 'discover': {
      const [src, ...rest] = args;
      if (src === 'github') {
        const qs = rest.filter((a) => !a.startsWith('--') && !/^\d+$/.test(a));
        const n = await discoverGithub(qs.length ? qs : DEFAULT_QUERIES, flag('per', 30));
        console.log(`Новых лидов: ${n}`);
      } else if (src === 'apify') {
        const opt = (n: string) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : undefined; };
        const r = await discoverApifyLeads({
          count: Number(opt('count') ?? 100),
          locations: (opt('locations') ?? 'united states,united kingdom,germany').split(',').map((x) => x.trim()),
          keywords: opt('keywords')?.split(',').map((x) => x.trim()),
          titles: opt('titles')?.split(',').map((x) => x.trim()),
        });
        console.log(`Новых: ${r.added}, без сайта: ${r.noSite}, дубли: ${r.dup}`);
      } else if (src === 'json') {
        const r = importJsonFile(rest[0], rest[1] ?? `json:${rest[0].split('/').pop()}`, rest[2]);
        console.log(`Новых: ${r.added}, без сайта: ${r.noSite}, дубли: ${r.dup}`);
      } else if (src === 'csv') {
        console.log(`Новых лидов: ${importCsv(rest[0])}`);
      } else console.log(HELP);
      break;
    }
    case 'triage': { const t = await triagePending(); console.log(`Всего ${t.total}: отсеяно правилами ${t.rules}, моделью ${t.llm}, оставлено ${t.kept}`); break; }
    case 'research': await researchPending(flag('limit', 20)); break;
    case 'verify': await verifyPending(flag('min-fit', 6)); break;
    case 'draft': await draftPending(flag('limit', 10)); break;
    case 'review': console.log(buildReview()); break;
    case 'rerender': console.log(`Перерисовано: ${rerenderDrafts()}`); console.log(buildReview()); break;
    case 'approve': {
      const min = flag('min-score', NaN);
      if (!Number.isNaN(min)) {
        const rows = db.prepare(`SELECT id, critic FROM messages WHERE status = 'draft'`).all() as { id: number; critic: string | null }[];
        const ok = rows.filter((r) => r.critic && JSON.parse(r.critic).score >= min).map((r) => r.id);
        ok.forEach((id) => db.prepare(`UPDATE messages SET status = 'approved' WHERE id = ?`).run(id));
        console.log(`Одобрено: ${ok.length}`);
      } else {
        for (const id of ids()) db.prepare(`UPDATE messages SET status = 'approved' WHERE id = ? AND status = 'draft'`).run(id);
        console.log(`Одобрено: ${ids().join(', ')}`);
      }
      break;
    }
    case 'reject':
      for (const id of ids()) db.prepare(`UPDATE messages SET status = 'rejected' WHERE id = ?`).run(id);
      console.log(`Отклонено: ${ids().join(', ')}`);
      break;
    case 'send': await sendApproved(); break;
    case 'run': {
      const limit = flag('limit', 10);
      console.log('▸ triage'); { const t = await triagePending(); console.log(`  всего ${t.total}: правила −${t.rules}, модель −${t.llm}, осталось ${t.kept}`); }
      console.log('▸ research'); await researchPending(limit * 3);
      console.log('▸ verify'); await verifyPending(flag('min-fit', 6));
      console.log('▸ draft'); await draftPending(limit);
      console.log('▸ review'); console.log(buildReview());
      break;
    }
    case 'stats': {
      console.log('Лиды:'); console.table(db.prepare(`SELECT status, COUNT(*) n FROM leads GROUP BY status`).all());
      console.log('Письма:'); console.table(db.prepare(`SELECT status, COUNT(*) n FROM messages GROUP BY status`).all());
      console.log('Причины пропуска:'); console.table(db.prepare(`SELECT skip_reason, COUNT(*) n FROM leads WHERE status='skipped' GROUP BY skip_reason ORDER BY n DESC LIMIT 10`).all());
      break;
    }
    case 'stop':
      suppress(args[0], args.slice(1).join(' ') || 'отписка');
      db.prepare(`UPDATE messages SET status = 'rejected', error = 'стоп-лист' WHERE status IN ('draft','approved') AND (to_email = ? OR to_email LIKE ?)`).run(args[0].toLowerCase(), `%@${args[0].toLowerCase()}`);
      console.log(`В стоп-листе: ${args[0]}`);
      break;
    default: console.log(HELP);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
