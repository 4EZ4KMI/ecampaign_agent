import { z } from 'zod';
import { cfg } from './config.js';

type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

export async function chat(model: string, messages: Msg[], temperature = 0.4): Promise<string> {
  const res = await fetch(`${cfg.llm.base}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.llm.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature, max_tokens: 4000 }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`LLM ${model}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const out = j.choices?.[0]?.message?.content;
  if (!out) throw new Error(`LLM ${model}: пустой ответ`);
  return out;
}

/** Просим JSON, валидируем схемой; при кривом ответе одна попытка починки. */
export async function chatJson<T>(model: string, messages: Msg[], schema: z.ZodType<T>, temperature = 0.4): Promise<T> {
  let raw = await chat(model, messages, temperature);
  for (let attempt = 0; ; attempt++) {
    try {
      return schema.parse(JSON.parse(extractJson(raw)));
    } catch (e) {
      if (attempt >= 1) throw new Error(`LLM ${model}: невалидный JSON: ${(e as Error).message.slice(0, 300)}`);
      raw = await chat(model, [
        ...messages,
        { role: 'assistant', content: raw },
        { role: 'user', content: `Ответ не прошёл валидацию: ${(e as Error).message.slice(0, 500)}\nВерни ТОЛЬКО исправленный JSON, без пояснений.` },
      ], 0);
    }
  }
}

function extractJson(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) s = fenced[1];
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  return a >= 0 && b > a ? s.slice(a, b + 1) : s;
}
