import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { cfg, OUT_DIR } from './config.js';
import { db, isSuppressed, type Message } from './db.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sentToday(): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE status = 'sent' AND date(sent_at) = date('now')`).get() as { n: number }).n;
}

export async function sendApproved(): Promise<void> {
  const live = cfg.sendLive;
  if (live && !cfg.smtp.host) throw new Error('SEND_LIVE=1, но SMTP_HOST пуст');
  const transport = live
    ? nodemailer.createTransport({ host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.secure, auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.pass } : undefined })
    : nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  if (live) await transport.verify();

  const left = cfg.dailyLimit - sentToday();
  if (left <= 0) { console.log(`Дневной лимит ${cfg.dailyLimit} исчерпан`); return; }
  const queue = db.prepare(`SELECT * FROM messages WHERE status = 'approved' ORDER BY id LIMIT ?`).all(left) as Message[];
  if (!queue.length) { console.log('Нет одобренных писем'); return; }
  console.log(live ? `Отправляю ${queue.length} писем через ${cfg.smtp.host}` : `SEND_LIVE=0: пишу ${queue.length} писем в out/outbox/, наружу ничего не уходит`);

  const outbox = path.join(OUT_DIR, 'outbox');
  fs.mkdirSync(outbox, { recursive: true });
  for (const [i, m] of queue.entries()) {
    if (isSuppressed(m.to_email)) {
      db.prepare(`UPDATE messages SET status = 'rejected', error = 'стоп-лист' WHERE id = ?`).run(m.id);
      continue;
    }
    // одно письмо на домен: если туда уже ушло, второе не шлём
    const domain = m.to_email.split('@')[1];
    if (db.prepare(`SELECT 1 FROM messages WHERE status = 'sent' AND to_email LIKE ?`).get(`%@${domain}`)) {
      db.prepare(`UPDATE messages SET status = 'rejected', error = 'на домен уже писали' WHERE id = ?`).run(m.id);
      continue;
    }
    try {
      const info = await transport.sendMail({
        from: { name: cfg.sender.name, address: cfg.sender.email },
        replyTo: cfg.sender.replyTo,
        to: m.to_email,
        subject: m.subject,
        html: m.html,
        text: m.text,
        headers: {
          'List-Unsubscribe': `<mailto:${cfg.sender.replyTo}?subject=stop>`,
        },
      });
      if (!live) fs.writeFileSync(path.join(outbox, `${m.id}-${m.to_email}.eml`), (info as unknown as { message: Buffer }).message);
      db.prepare(`UPDATE messages SET status = ?, message_id = ?, sent_at = datetime('now') WHERE id = ?`)
        .run(live ? 'sent' : 'approved', info.messageId, m.id);
      console.log(`  ✓ #${m.id} → ${m.to_email}`);
    } catch (e) {
      db.prepare(`UPDATE messages SET status = 'failed', error = ? WHERE id = ?`).run((e as Error).message.slice(0, 500), m.id);
      console.log(`  ✗ #${m.id} → ${m.to_email}: ${(e as Error).message.slice(0, 200)}`);
    }
    if (live && i < queue.length - 1) {
      const wait = (cfg.delayMin + Math.random() * (cfg.delayMax - cfg.delayMin)) * 1000;
      await sleep(wait);
    }
  }
}
