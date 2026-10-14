import { cfg } from './config.js';
import type { Lead } from './db.js';
import type { ModelPrice } from './pricing.js';
import { savingsPer1000 } from './pricing.js';
import { product } from './product.js';
import type { Research } from './research.js';
import type { Copy } from './write.js';

export type Ctx = { lead: Lead; research: Research; copy: Copy; models: ModelPrice[] };

const sender = (lang: 'ru' | 'en') => (lang === 'en' ? cfg.sender.nameEn : cfg.sender.name);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const usd = (n: number) => `$${n < 1 ? n.toFixed(3).replace(/0$/, '') : n.toFixed(2).replace(/\.00$/, '')}`;

const C = {
  bg: '#f4f4f7', card: '#ffffff', ink: '#16161d', muted: '#5f6170', line: '#e7e7ee',
  brand: '#6467f2', brandSoft: '#eeeffe', good: '#0f8a5f', code: '#0f1020', codeInk: '#d6d8ff',
};
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,Helvetica,Arial,sans-serif`;
const MONO = `'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace`;

function link(ctx: Ctx, path = '/'): string {
  const u = new URL(path, product.siteUrl);
  u.searchParams.set('utm_source', 'outreach');
  u.searchParams.set('utm_medium', 'email');
  u.searchParams.set('utm_campaign', 'kp');
  u.searchParams.set('utm_content', `lead${ctx.lead.id}`);
  return u.toString();
}

const T = {
  ru: {
    priceTitle: 'Цены на модели, которые вам подходят', model: 'Модель', vendor: 'У вендора', ours: product.name,
    perM: 'за 1M токенов, вход / выход', save: (n: number) => `С каждых $1000 на эти модели у вас остаётся около $${n}.`,
    why: (s: string) => `Почему вам пришло это письмо: ${s} Если тема неактуальна, ответьте «стоп» — больше не напишем.`,
  },
  en: {
    priceTitle: 'Pricing for the models that fit you', model: 'Model', vendor: 'Vendor list', ours: product.name,
    perM: 'per 1M tokens, input / output', save: (n: number) => `That leaves you about $${n} of every $1,000 spent on these models.`,
    why: (s: string) => `Why you got this: ${s} Not relevant? Reply "stop" and we won't write again.`,
  },
};

export function renderHtml(ctx: Ctx): string {
  const { copy, models, research, lead } = ctx;
  const t = T[research.lang];
  const why = t.why(product.whyContacted[lead.source.startsWith('github') ? 'github' : 'default'][research.lang]);
  const p = (s: string, extra = '') => `<p style="margin:0 0 16px;font:16px/1.6 ${FONT};color:${C.ink};${extra}">${esc(s)}</p>`;

  const offers = copy.offers.map((o, i) => `
    <tr><td style="padding:0 0 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:12px">
        <tr>
          <td width="44" valign="top" style="padding:16px 0 16px 16px">
            <div style="width:28px;height:28px;border-radius:8px;background:${C.brandSoft};color:${C.brand};font:700 14px/28px ${FONT};text-align:center">${i + 1}</div>
          </td>
          <td style="padding:16px 16px 16px 8px">
            <div style="font:600 15px/1.4 ${FONT};color:${C.ink};margin:0 0 4px">${esc(o.title)}</div>
            <div style="font:14px/1.55 ${FONT};color:${C.muted}">${esc(o.body)}</div>
          </td>
        </tr>
      </table>
    </td></tr>`).join('');

  const rows = models.map((m) => `
    <tr>
      <td style="padding:10px 12px;border-top:1px solid ${C.line};font:600 14px/1.3 ${FONT};color:${C.ink}">${esc(m.name)}<div style="font:12px/1.3 ${FONT};color:${C.muted};font-weight:400">${esc(m.provider)}</div></td>
      <td style="padding:10px 12px;border-top:1px solid ${C.line};font:14px/1.3 ${FONT};color:${C.muted};text-decoration:line-through;white-space:nowrap">${usd(m.offIn)} / ${usd(m.offOut)}</td>
      <td style="padding:10px 12px;border-top:1px solid ${C.line};font:600 14px/1.3 ${FONT};color:${C.ink};white-space:nowrap">${usd(m.inUsd)} / ${usd(m.outUsd)}</td>
      <td class="hide-sm" align="right" style="padding:10px 12px;border-top:1px solid ${C.line};white-space:nowrap"><span style="display:inline-block;padding:3px 8px;border-radius:999px;background:#e6f6ef;color:${C.good};font:700 12px/1.2 ${FONT}">−${m.discountPct}%</span></td>
    </tr>`).join('');


  return `<!doctype html>
<html lang="${research.lang}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${esc(copy.subject)}</title>
<style>
  @media (max-width:620px){ .wrap{width:100%!important} .pad{padding-left:20px!important;padding-right:20px!important} .hide-sm{display:none!important} .code{font-size:12px!important;padding:14px!important} .pt td{padding:9px 8px!important;font-size:13px!important} .pad{padding-left:16px!important;padding-right:16px!important} }
  a{color:${C.brand}}
</style>
</head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(copy.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}">
<tr><td align="center" style="padding:24px 8px">
  <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px">

    <tr><td class="pad" style="padding:0 8px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font:800 20px/1 ${FONT};color:${C.ink};letter-spacing:-0.3px"><span style="color:${C.brand}">${esc(product.wordmark.accent)}</span>${esc(product.wordmark.rest)}</td>
        <td align="right" style="font:13px/1 ${FONT};color:${C.muted}">${research.lang === 'ru' ? 'для' : 'for'} ${esc(research.company)}</td>
      </tr></table>
    </td></tr>

    <tr><td style="background:${C.card};border-radius:16px;border:1px solid ${C.line}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td class="pad" style="padding:36px 40px 8px">
          ${p(copy.greeting)}
          ${p(copy.opening)}
          ${p(copy.bridge, 'margin-bottom:24px')}
        </td></tr>

        <tr><td class="pad" style="padding:0 40px 12px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${offers}</table>
        </td></tr>

        ${models.length ? `<tr><td class="pad" style="padding:12px 40px 8px">
          <div style="font:700 13px/1 ${FONT};color:${C.muted};text-transform:uppercase;letter-spacing:.6px;margin:0 0 10px">${t.priceTitle}</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="pt" style="border:1px solid ${C.line};border-radius:12px;border-collapse:separate;overflow:hidden">
            <tr style="background:#fafafc">
              <td style="padding:10px 12px;font:600 12px/1 ${FONT};color:${C.muted}">${t.model}</td>
              <td style="padding:10px 12px;font:600 12px/1 ${FONT};color:${C.muted}">${t.vendor}</td>
              <td style="padding:10px 12px;font:600 12px/1 ${FONT};color:${C.muted}">${t.ours}</td>
              <td class="hide-sm"></td>
            </tr>
            ${rows}
          </table>
          <div style="font:12px/1.5 ${FONT};color:${C.muted};margin:8px 2px 0">${t.perM}. ${t.save(savingsPer1000(models))}</div>
        </td></tr>` : ''}

        ${product.snippet ? `<tr><td class="pad" style="padding:24px 40px 8px">
          <div style="font:700 13px/1 ${FONT};color:${C.muted};text-transform:uppercase;letter-spacing:.6px;margin:0 0 10px">${esc(product.snippet.title[research.lang])}</div>
          <div class="code" style="background:${C.code};border-radius:12px;padding:16px 18px;font:13px/1.6 ${MONO};color:${C.codeInk};white-space:pre-wrap;word-break:break-all">${esc(product.snippet.code)}</div>
          <div style="font:12px/1.5 ${FONT};color:${C.muted};margin:8px 2px 0">${esc(product.snippet.note[research.lang])}</div>
        </td></tr>` : ''}

        <tr><td class="pad" align="left" style="padding:28px 40px 8px">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="border-radius:10px;background:${C.brand}">
              <a href="${esc(link(ctx, product.ctaPath))}" style="display:inline-block;padding:14px 26px;font:600 15px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:10px">${esc(copy.cta_text)} →</a>
            </td>
          </tr></table>
        </td></tr>

        <tr><td class="pad" style="padding:24px 40px 36px">
          ${p(copy.ps, `color:${C.muted};font-size:14px`)}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px"><tr>
            <td style="padding-right:12px"><div style="width:40px;height:40px;border-radius:50%;background:${C.brand};color:#fff;font:700 16px/40px ${FONT};text-align:center">${esc(sender(research.lang).slice(0, 1))}</div></td>
            <td style="font:14px/1.4 ${FONT};color:${C.ink}"><b>${esc(sender(research.lang))}</b><br><span style="color:${C.muted}">${esc(cfg.sender.title)} · <a href="${esc(link(ctx))}" style="color:${C.brand};text-decoration:none">${esc(new URL(product.siteUrl).hostname)}</a></span></td>
          </tr></table>
        </td></tr>
      </table>
    </td></tr>

    <tr><td class="pad" style="padding:20px 24px 0;font:12px/1.5 ${FONT};color:#8a8c99;text-align:center">
      ${esc(why)}
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

export function renderText(ctx: Ctx): string {
  const { copy, models, research } = ctx;
  const t = T[research.lang];
  return [
    copy.greeting, '', copy.opening, '', copy.bridge, '',
    ...copy.offers.map((o, i) => `${i + 1}. ${o.title} — ${o.body}`), '',
    ...(models.length ? [`${t.priceTitle} (${t.perM}):`,
      ...models.map((m) => `- ${m.name}: ${usd(m.offIn)}/${usd(m.offOut)} → ${usd(m.inUsd)}/${usd(m.outUsd)} (−${m.discountPct}%)`), ''] : []),
    `${copy.cta_text}: ${link(ctx, product.ctaPath)}`, '',
    copy.ps, '', `— ${sender(research.lang)}, ${cfg.sender.title}`, '',
    t.why(product.whyContacted[ctx.lead.source.startsWith('github') ? 'github' : 'default'][research.lang]),
  ].join('\n');
}
