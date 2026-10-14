import fs from 'node:fs';
import { addLead } from './common.js';

/**
 * CSV с заголовком. Колонки: website (обязательно), company, email, signal.
 * signal — почему пишем этой компании (видели на конференции, они в каталоге AI-стартапов и т.п.).
 */
export function importCsv(file: string): number {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const head = splitRow(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (row: string[], name: string) => row[head.indexOf(name)]?.trim() || undefined;
  if (!head.includes('website')) throw new Error('В CSV нужна колонка website');
  let added = 0;
  for (const line of lines.slice(1)) {
    const row = splitRow(line);
    const email = col(row, 'email');
    if (addLead({ website: col(row, 'website')!, company: col(row, 'company'), source: 'csv', signal: col(row, 'signal'), emails: email ? [email] : [] })) added++;
  }
  return added;
}

function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
