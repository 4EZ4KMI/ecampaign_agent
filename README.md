# ecampaign

A cold-outreach agent for B2B products. It finds companies that are likely to need what you sell, throws away the junk, reads each company's website, writes a personal proposal as a responsive HTML email, has a second model edit it, and sends it only after a human approves it.

It ships with a set of Claude Code skills, so you can drive the whole pipeline by asking Claude Code to "find leads and draft proposals".

```
discover ──► triage ──► research ──► verify ──► draft ──► review ──► approve ──► send
Apify        rules +     website →    pick +     copy +    HTML       human      SMTP or
GitHub       cheap LLM   LLM fit      check      critic    preview    only       .eml files
JSON / CSV               score 0–10   address
```

The default prompts and example config target products sold to teams that pay for LLM APIs (gateways, AI infrastructure, dev tools). Everything product-specific lives in `product.json`, so you can point the agent at a different product without touching the code.

## Quick start

Requirements: Node.js 20+, pnpm, and an API key for any OpenAI-compatible LLM endpoint.

```bash
pnpm install
cp .env.example .env                    # set LLM_API_KEY, sender and SMTP
cp product.example.json product.json    # describe your product (see below)
pnpm install-skills                     # optional: install the Claude Code skills

pnpm cli discover apify --count 100 --locations "united states,germany"
pnpm cli run --limit 10 --min-fit 6     # triage → research → verify → draft → review
open out/review/index.html              # previews, research notes, editor feedback
pnpm cli approve 3 5 7                  # or: approve --min-score 8
pnpm cli send                           # SEND_LIVE=0 writes .eml files, sends nothing
```

## Commands

| Command | What it does |
|---|---|
| `discover apify [--count] [--locations] [--keywords] [--titles]` | B2B leads with emails from Apify `code_crafter/leads-finder` (needs `APIFY_TOKEN`) |
| `discover json <file> [source] [signal]` | Import any scraper export: Apify, Firecrawl / ScrapeGraph extract, Clay, Apollo. Fields are matched by common names |
| `discover github [--per 30] ["query" …]` | Owners of public repos whose code matches `github.queries` (for example, calls to a competitor's API) |
| `discover csv <file>` | Your own list: `website,company,email,signal` |
| `triage` | Junk filter: rules, then a cheap model in batches of 25 |
| `research [--limit 20]` | Crawls up to 5 pages per site, then the model scores fit 0–10 and writes hooks for the email |
| `verify [--min-fit 6]` | Picks the best address (company domain first, no `noreply`/HR/legal), checks MX and optionally Reacher |
| `draft [--limit 10]` | Writes the copy, runs the critic, rewrites once if the score is below 8, renders HTML and plain text |
| `review` / `rerender` | Builds `out/review/index.html`; `rerender` redraws drafts after a template change without calling the LLM |
| `approve <id…>` / `reject <id…>` | Human gate before sending |
| `send` | SMTP with a daily cap, random delays, one email per domain, suppression list, `List-Unsubscribe` |
| `stop <email\|domain>` | Add to the suppression list (someone replied "stop") |
| `stats` | Where leads are in the pipeline and why they were skipped |

## Junk filter

Scraped lead lists are mostly noise, and research costs a crawl plus a model call per lead. `triage` runs two cheap passes first:

1. **Rules, no LLM:** competitors (`competitorDomains`), big tech, government and universities, companies over 2,000 employees, domains already contacted, the suppression list. If the contact is an intern or a recruiter, the person is dropped but the company is kept, and research looks for another address on the website.
2. **Cheap model in batches of 25:** keeps or drops each lead according to `triage.keep` / `triage.drop` and records a short reason.

On a deliberately dirty sample (`test/dirty-apify.json`, 18 records: a plumber, a bakery, a law firm, a university, big tech, a competitor, a recruiter, a record with no website, and a handful of real AI companies) the filter kept the 7 relevant companies and dropped the rest for the right reasons.

## Product config

`product.json` (git-ignored, copied from `product.example.json`) holds everything the agent says or assumes about your product:

| Field | Used for |
|---|---|
| `name`, `wordmark`, `siteUrl`, `ctaPath` | Email header, links (UTM-tagged), call-to-action |
| `pitch` | What the product is, for research and triage prompts |
| `facts` | The only claims the writer may make. The critic penalizes anything outside this list |
| `forbidden` | Claims the writer must never make |
| `angles`, `psHook` | Offer angles the writer picks three from, and the P.S. hook |
| `snippet` | The "how to switch" code block (`null` hides it) |
| `pricing` | Live price catalog URL and default models per segment (`null` means no price table) |
| `triage`, `competitorDomains` | The junk filter |
| `github.queries`, `apify` | Lead sources |
| `whyContacted` | The footer line explaining why the recipient got the email |

Every field has a Russian and an English variant where it matters: the agent detects the site language and writes the email in it.

## Skills

| Skill | Source | Purpose |
|---|---|---|
| `ecampaign` | this repo | Guides Claude Code through the pipeline; never approves or sends on its own |
| `public-apis` | this repo + the [public-apis](https://github.com/public-apis/public-apis) catalog | Find free APIs for enrichment before paying for one |
| `scrape-leads`, `gmaps-leads`, `classify-leads` | [aiagentwithdhruv/skills](https://github.com/aiagentwithdhruv/skills), MIT | Apify and Google Maps lead scraping, classification |
| `reddit-leads` | [lignertys/reddit-research-skills](https://github.com/lignertys/reddit-research-skills), MIT | Buying-intent signals on Reddit (usernames, no emails) |
| `just-scrape` | [scrapegraphai/just-scrape](https://github.com/scrapegraphai/just-scrape), MIT | Scraping via ScrapeGraph AI |
| `apify-ultimate-scraper` | [apify/agent-skills](https://github.com/apify/agent-skills) | Installed from upstream by the script (no license to redistribute) |
| `firecrawl-scrape` | [firecrawl/cli](https://github.com/firecrawl/cli) | Installed from upstream by the script |

`pnpm install-skills` copies them into `~/.claude/skills` (override with `CLAUDE_SKILLS_DIR`) and clones the public-apis catalog into `~/tools/public-apis`.

## Code layout

| File | Role |
|---|---|
| `src/sources/*.ts` | Lead sources: Apify REST, generic JSON importer, GitHub code search, CSV |
| `src/triage.ts` | Junk filter |
| `src/site.ts` | Lightweight crawler: text and email addresses from the home page plus about/product/pricing/contact pages |
| `src/research.ts` | Company analysis and fit score |
| `src/verify.ts` | Address selection and checks |
| `src/pricing.ts` | Live prices and model selection |
| `src/write.ts` | Copywriter and critic prompts |
| `src/template.ts` | Table-based HTML email (Gmail, Outlook, mobile), preheader, plain-text part |
| `src/send.ts` | SMTP sending with safety limits |
| `src/product.ts` | Product config loader |

State lives in SQLite at `data/outreach.db`; previews and `.eml` files go to `out/`. Both are git-ignored.

## Before you send for real

- **Use a separate domain for cold email**, not your product domain and not your transactional email provider: most transactional providers forbid unsolicited email, and a ban would take down your login and receipt emails. Set up SPF, DKIM and DMARC and warm the mailboxes up for 2–3 weeks (for example with [warmbly](https://github.com/warmbly/warmbly)).
- **Keep volumes low:** 20–30 emails a day per mailbox, all approved by a human.
- **Check the law where your recipients are.** CAN-SPAM (US) allows cold B2B email with an opt-out; the EU and some other countries require consent or a documented legitimate interest. Every email states why the recipient was contacted and how to opt out.

## Roadmap

- Reply handling: IMAP polling, automatic suppression on "stop", notifications for the rest.
- Follow-up after 4–5 days without a reply.
- Approving drafts from a chat bot instead of the CLI.

## Licenses

Vendored skills keep their own licenses (see `skills/*/LICENSE`).
