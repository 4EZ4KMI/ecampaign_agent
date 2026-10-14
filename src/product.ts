import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ROOT } from './config.js';

const L = z.object({ en: z.string(), ru: z.string() });
const LL = z.object({ en: z.array(z.string()), ru: z.array(z.string()) });

/**
 * Everything product-specific lives in product.json (git-ignored). The repo ships
 * product.example.json for a fictional LLM gateway; copy it and fill in your own facts.
 */
export const Product = z.object({
  name: z.string(),
  wordmark: z.object({ accent: z.string(), rest: z.string() }),
  siteUrl: z.string().url(),
  ctaPath: z.string().default('/'),
  pitch: L.describe('one paragraph: what the product is, for research/triage prompts'),
  facts: LL.describe('the ONLY claims the writer may make'),
  forbidden: LL.describe('claims the writer must never make'),
  angles: LL.describe('offer angles the writer picks 3 from'),
  psHook: L,
  snippet: z.object({ code: z.string(), title: L, note: L }).nullable(),
  pricing: z.object({
    catalogUrl: z.string().url(),
    defaults: z.record(z.array(z.string())),
  }).nullable(),
  triage: z.object({ keep: z.array(z.string()), drop: z.array(z.string()) }),
  competitorDomains: z.array(z.string()),
  github: z.object({ queries: z.array(z.string()) }),
  apify: z.object({ titles: z.array(z.string()), keywords: z.array(z.string()) }),
  whyContacted: z.object({ github: L, default: L }),
});
export type Product = z.infer<typeof Product>;

function load(): Product {
  const own = path.join(ROOT, 'product.json');
  const file = fs.existsSync(own) ? own : path.join(ROOT, 'product.example.json');
  return Product.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export const product = load();
export const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n');
