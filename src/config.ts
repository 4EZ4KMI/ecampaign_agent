import 'dotenv/config';
import { execSync } from 'node:child_process';
import path from 'node:path';

const env = (k: string, d?: string) => {
  const v = process.env[k]?.trim();
  if (v) return v;
  if (d !== undefined) return d;
  throw new Error(`Не задана переменная ${k} (см. .env.example)`);
};

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const OUT_DIR = path.join(ROOT, 'out');

export const cfg = {
  llm: {
    // любой OpenAI-совместимый эндпоинт (OpenAI, OpenRouter, свой шлюз)
    get key() { return env('LLM_API_KEY'); },
    base: env('LLM_BASE_URL', 'https://api.openai.com/v1'),
    triage: env('MODEL_TRIAGE', 'gemini-3.1-flash-lite'),
    research: env('MODEL_RESEARCH', 'gemini-3-flash'),
    writer: env('MODEL_WRITER', 'claude-sonnet-5.5'),
    critic: env('MODEL_CRITIC', 'gpt-5.4-mini'),
  },
  reacherUrl: process.env.REACHER_URL?.trim() || '',
  sender: {
    name: env('SENDER_NAME', 'Sales'),
    nameEn: env('SENDER_NAME_EN', 'Sales'),
    title: env('SENDER_TITLE', ''),
    email: env('SENDER_EMAIL', 'hello@example.com'),
    replyTo: env('REPLY_TO', 'sales@example.com'),
  },
  smtp: {
    host: env('SMTP_HOST', ''),
    port: Number(env('SMTP_PORT', '587')),
    secure: env('SMTP_SECURE', 'false') === 'true',
    user: env('SMTP_USER', ''),
    pass: env('SMTP_PASS', ''),
  },
  sendLive: env('SEND_LIVE', '0') === '1',
  dailyLimit: Number(env('DAILY_LIMIT', '20')),
  delayMin: Number(env('SEND_DELAY_SEC_MIN', '60')),
  delayMax: Number(env('SEND_DELAY_SEC_MAX', '180')),
};

let ghToken: string | undefined;
export function githubToken(): string {
  if (ghToken) return ghToken;
  ghToken = process.env.GITHUB_TOKEN?.trim() || execSync('gh auth token', { encoding: 'utf8' }).trim();
  return ghToken;
}
