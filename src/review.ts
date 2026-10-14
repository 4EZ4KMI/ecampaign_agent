import fs from 'node:fs';
import path from 'node:path';
import { OUT_DIR } from './config.js';
import { db } from './db.js';

type Row = { id: number; to_email: string; subject: string; html: string; critic: string | null; status: string; domain: string; company: string | null; fit_score: number | null; signal: string | null; research: string };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Собирает out/review/index.html: все черновики с превью, оценкой редактора и ресёрчем. */
export function buildReview(): string {
  const dir = path.join(OUT_DIR, 'review');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const rows = db.prepare(`SELECT m.id, m.to_email, m.subject, m.html, m.critic, m.status, l.domain, l.company, l.fit_score, l.signal, l.research
    FROM messages m JOIN leads l ON l.id = m.lead_id WHERE m.status IN ('draft', 'approved') ORDER BY m.status, l.fit_score DESC, m.id`).all() as Row[];
  const cards = rows.map((r) => {
    fs.writeFileSync(path.join(dir, `${r.id}.html`), r.html);
    const c = r.critic ? JSON.parse(r.critic) as { score: number; issues: string[] } : null;
    const rs = JSON.parse(r.research) as { summary: string; ai_usage: string; fit_reason: string };
    return `<section>
      <header><b>#${r.id}</b> ${esc(r.company ?? r.domain)} · <a href="https://${esc(r.domain)}" target="_blank">${esc(r.domain)}</a> · ${esc(r.to_email)}
        <span class="tag ${r.status}">${r.status}</span> <span class="tag">fit ${r.fit_score}/10</span> <span class="tag">редактор ${c?.score ?? '—'}/10</span></header>
      <div class="cols">
        <iframe src="${r.id}.html" loading="lazy"></iframe>
        <aside>
          <h4>Тема</h4><p>${esc(r.subject)}</p>
          <h4>Компания</h4><p>${esc(rs.summary)}</p>
          <h4>ИИ у них</h4><p>${esc(rs.ai_usage)}</p>
          <h4>Почему подходит</h4><p>${esc(rs.fit_reason)}</p>
          <h4>Сигнал</h4><p>${esc(r.signal ?? '—')}</p>
          ${c?.issues.length ? `<h4>Замечания редактора</h4><ul>${c.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
          <h4>Команды</h4><code>pnpm cli approve ${r.id}</code><br><code>pnpm cli reject ${r.id}</code>
        </aside>
      </div>
    </section>`;
  }).join('\n');
  const page = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Черновики КП</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;margin:0;background:#f4f4f7;color:#16161d}
main{max-width:1280px;margin:0 auto;padding:24px}
section{background:#fff;border:1px solid #e7e7ee;border-radius:14px;margin:0 0 24px;overflow:hidden}
header{padding:14px 18px;border-bottom:1px solid #e7e7ee}
.cols{display:grid;grid-template-columns:minmax(0,1fr) 360px}
iframe{width:100%;height:1100px;border:0;background:#f4f4f7}
aside{padding:16px 18px;border-left:1px solid #e7e7ee;overflow:auto;max-height:1100px}
h4{margin:14px 0 4px;font-size:12px;text-transform:uppercase;color:#5f6170;letter-spacing:.5px}
p{margin:0}
.tag{display:inline-block;padding:2px 8px;border-radius:999px;background:#eeeffe;color:#4446c8;font-size:12px;margin-left:6px}
.tag.approved{background:#e6f6ef;color:#0f8a5f}
code{font-size:12px;background:#f4f4f7;padding:2px 6px;border-radius:6px}
@media(max-width:900px){.cols{grid-template-columns:1fr}aside{border-left:0;border-top:1px solid #e7e7ee}}
</style></head><body><main><h1>Черновики КП: ${rows.length}</h1>${cards || '<p>Пусто</p>'}</main></body></html>`;
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, page);
  return file;
}
