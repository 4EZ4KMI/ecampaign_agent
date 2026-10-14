import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new Database(path.join(DATA_DIR, 'outreach.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS leads (
  id          INTEGER PRIMARY KEY,
  domain      TEXT NOT NULL UNIQUE,
  website     TEXT NOT NULL,
  company     TEXT,
  source      TEXT NOT NULL,           -- github:<query> | csv
  signal      TEXT,                    -- почему он лид (репо, где используют конкурента и т.п.)
  emails      TEXT NOT NULL DEFAULT '[]',
  contact_name  TEXT,                  -- человек из источника (Apify leads-finder и т.п.)
  contact_title TEXT,
  meta        TEXT,                    -- сырые поля источника: индустрия, размер, ключевые слова
  triage      TEXT,                    -- вердикт дешёвого фильтра до ресёрча
  email       TEXT,                    -- выбранный адрес
  status      TEXT NOT NULL DEFAULT 'new', -- new → researched → verified → drafted | skipped
  skip_reason TEXT,
  research    TEXT,                    -- JSON от research.ts
  fit_score   INTEGER,
  lang        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY,
  lead_id     INTEGER NOT NULL REFERENCES leads(id),
  to_email    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  html        TEXT NOT NULL,
  text        TEXT NOT NULL,
  critic      TEXT,                    -- JSON {score, issues}
  copy        TEXT,                    -- JSON {copy, models}: из него перерисовывается html (команда rerender)
  status      TEXT NOT NULL DEFAULT 'draft', -- draft → approved → sent | rejected | failed
  message_id  TEXT,
  error       TEXT,
  sent_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS suppression (
  value       TEXT PRIMARY KEY,        -- email или домен
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// миграции для баз, созданных до новых колонок
const hasCol = (t: string, c: string) => !!db.prepare(`SELECT 1 FROM pragma_table_info('${t}') WHERE name = ?`).get(c);
if (!hasCol('messages', 'copy')) db.exec(`ALTER TABLE messages ADD COLUMN copy TEXT`);
for (const c of ['contact_name', 'contact_title', 'meta', 'triage']) if (!hasCol('leads', c)) db.exec(`ALTER TABLE leads ADD COLUMN ${c} TEXT`);

export type Lead = {
  id: number; domain: string; website: string; company: string | null; source: string;
  signal: string | null; emails: string; contact_name: string | null; contact_title: string | null; meta: string | null; triage: string | null; email: string | null; status: string;
  skip_reason: string | null; research: string | null; fit_score: number | null; lang: string | null;
};

export type Message = {
  id: number; lead_id: number; to_email: string; subject: string; html: string; text: string;
  critic: string | null; copy: string | null; status: string; message_id: string | null; error: string | null; sent_at: string | null;
};

export function updateLead(id: number, patch: Partial<Omit<Lead, 'id'>>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE leads SET ${set}, updated_at = datetime('now') WHERE id = @id`).run({ ...patch, id });
}

export function skipLead(id: number, reason: string) {
  updateLead(id, { status: 'skipped', skip_reason: reason });
}

export function isSuppressed(email: string): boolean {
  const domain = email.split('@')[1] ?? '';
  return !!db.prepare('SELECT 1 FROM suppression WHERE value IN (?, ?)').get(email.toLowerCase(), domain.toLowerCase());
}

export function suppress(value: string, reason: string) {
  db.prepare('INSERT OR REPLACE INTO suppression (value, reason) VALUES (?, ?)').run(value.toLowerCase(), reason);
}
