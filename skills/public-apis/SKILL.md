---
name: public-apis
description: Catalog of ~1,400 free public APIs (github.com/public-apis/public-apis) in 52 categories, from Business, Open Data and Email to Geocoding and Machine Learning. Use when you need a free or cheap API for a task (lead enrichment, email verification, company data, geocoding, currencies) before writing a scraper or paying for a service.
---

# public-apis

Local copy: `~/tools/public-apis/README.md` (installed by `scripts/install-skills.sh`). Update: `git -C ~/tools/public-apis pull`.

## How to search

Each API is a table row: `| [Name](url) | Description | Auth | HTTPS | CORS |`. Categories are `### ` headings.

```bash
# list categories
grep -n '^### ' ~/tools/public-apis/README.md
# every API in a category (up to the next heading)
awk '/^### Business/{f=1;next} /^### /{f=0} f' ~/tools/public-apis/README.md
# search descriptions
grep -i 'company\|domain\|email' ~/tools/public-apis/README.md | grep '^|'
```

The Auth column: `No` means no key, `apiKey` means sign-up required, `OAuth`.

## Rules

- The catalog is community-maintained and ages: open the API's site and check that it is alive, plus its current limits and price, before using it.
- For lead generation the most useful categories are Business, Open Data, Email and Development.
