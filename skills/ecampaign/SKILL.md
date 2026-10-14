---
name: ecampaign
description: Cold-outreach agent for B2B products — finds leads (Apify, GitHub, scraper exports), filters out junk, researches each company's website, writes a personal HTML proposal with live pricing, runs it past an editor model and sends it only after human approval. Use when asked to find customers, build a lead list, write or send proposals, or handle replies to an outreach campaign.
---

# ecampaign

The agent's code is the root of this repository (`pnpm cli <command>`). Work from the repo root; details are in `README.md`.
Product facts, pricing source, ideal-customer profile and lead-source queries live in `product.json`
(copy `product.example.json` if it is missing and ask the user to fill it in).

## Workflow

1. **Leads.** Pick a source for the task:
   - `pnpm cli discover apify --count 100 --locations "united states,germany"` — B2B database with emails (needs `APIFY_TOKEN`);
   - an export from any skill (`apify-ultimate-scraper`, `gmaps-leads`, `firecrawl-scrape`, `just-scrape`) → save as JSON →
     `pnpm cli discover json <file> <source> "<why we are writing to them>"`;
   - `pnpm cli discover github` — owners of public repos matching `github.queries` (weak source, mostly individuals);
   - `pnpm cli discover csv <file>` — the user's own lists.
2. **Filter:** `pnpm cli triage`. Tell the user how many leads the rules and the model removed, with 3–5 example reasons.
3. **Research and drafts:** `pnpm cli run --limit 10 --min-fit 6` (triage → research → verify → draft → review).
4. **Review:** open `out/review/index.html` and summarize each email (recipient, subject, editor score, risks).
   ONLY the user approves: `pnpm cli approve <id...>`.
5. **Sending:** `pnpm cli send`. With `SEND_LIVE=0` emails are written to `out/outbox/*.eml`. Turn on live sending
   and run it only on the user's explicit instruction.
6. **"Stop" replies:** `pnpm cli stop <email|domain>`.

## Rules

- Never approve or send emails yourself.
- Do not edit `facts` / `forbidden` in `product.json` unless the user asks: the email must not promise anything the product does not do.
- Cold email goes out only from a separate domain, never from the product's transactional mailbox.
- `pnpm cli stats` shows where leads are stuck and why.
