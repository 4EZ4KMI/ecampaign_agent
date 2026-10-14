import dns from 'node:dns/promises';
import { cfg } from './config.js';
import { db, isSuppressed, skipLead, updateLead, type Lead } from './db.js';

/** Адреса, на которые холодное письмо не шлём никогда. */
const NEVER = /(^|[.+-])(careers|lists|aur)@|^(no-?reply|do-?not-?reply|abuse|postmaster|privacy|dpo|gdpr|legal|security|jobs|careers|hr|cv|resume|billing|accounting|buh|unsubscribe|mailer-daemon)@/i;
/** Чем выше в списке, тем лучше для КП. */
const PREFERRED = [/^(ceo|cto|founder|cofounder|founders)@/i, /^(partners?|partnership|bd|biz|business|sales|hello|hi|team)@/i, /^(info|contact|contacts|office|mail)@/i, /^(support|help)@/i];
const FREEMAIL = /@(gmail|yahoo|hotmail|outlook|icloud|proton(mail)?|yandex|ya|mail|bk|inbox|list|rambler)\.(com|ru|me)$/i;

const mxCache = new Map<string, boolean>();
async function hasMx(domain: string): Promise<boolean> {
  if (!mxCache.has(domain)) {
    mxCache.set(domain, await dns.resolveMx(domain).then((r) => r.length > 0, () => false));
  }
  return mxCache.get(domain)!;
}

/** Опционально: self-hosted Reacher (github.com/reacherhq/check-if-email-exists). */
async function reacher(email: string): Promise<'safe' | 'risky' | 'invalid' | 'unknown'> {
  if (!cfg.reacherUrl) return 'unknown';
  try {
    const r = await fetch(`${cfg.reacherUrl}/v0/check_email`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to_email: email }), signal: AbortSignal.timeout(60_000),
    });
    return ((await r.json()) as { is_reachable?: 'safe' | 'risky' | 'invalid' | 'unknown' }).is_reachable ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const isOwn = (email: string, domain: string) => email.endsWith(`@${domain}`) || email.endsWith(`.${domain}`);

function rank(email: string, domain: string): number {
  const own = isOwn(email, domain);
  const pref = PREFERRED.findIndex((re) => re.test(email));
  // личный адрес на домене компании (ivan@company.ru) ставим сразу после ceo/founder
  const personal = own && pref === -1 ? 0.5 : pref === -1 ? 5 : pref;
  return (own ? 0 : FREEMAIL.test(email) ? 20 : 10) + personal;
}

export async function verifyLead(lead: Lead): Promise<void> {
  const candidates = (JSON.parse(lead.emails) as string[])
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e) && !NEVER.test(e) && !isSuppressed(e))
    // чужие корпоративные адреса (careers@bytedance.com на сайте партнёра) не берём; бесплатная почта — только личная владельца
    .filter((e) => isOwn(e, lead.domain) || (FREEMAIL.test(e) && !e.includes('+')))
    .sort((a, b) => rank(a, lead.domain) - rank(b, lead.domain));
  for (const email of candidates) {
    if (!(await hasMx(email.split('@')[1]))) continue;
    const r = await reacher(email);
    if (r === 'invalid') continue;
    updateLead(lead.id, { status: 'verified', email });
    return;
  }
  skipLead(lead.id, candidates.length ? 'ни один адрес не прошёл проверку' : 'не нашли почту');
}

export async function verifyPending(minFit: number): Promise<void> {
  const leads = db.prepare(`SELECT * FROM leads WHERE status = 'researched'`).all() as Lead[];
  for (const l of leads) {
    if ((l.fit_score ?? 0) < minFit) { skipLead(l.id, `fit ${l.fit_score} < ${minFit}`); continue; }
    await verifyLead(l);
    const fresh = db.prepare('SELECT status, email, skip_reason FROM leads WHERE id = ?').get(l.id) as Lead;
    console.log(`  #${l.id} ${l.domain}: ${fresh.status === 'verified' ? fresh.email : `пропуск (${fresh.skip_reason})`}`);
  }
}
