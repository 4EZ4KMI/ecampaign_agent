#!/usr/bin/env bash
# Ставит скиллы в ~/.claude/skills: свои и MIT-скиллы из этого репозитория, плюс
# apify-ultimate-scraper и firecrawl-scrape из upstream (у них нет лицензии на распространение,
# поэтому в репозиторий не вшиты) и каталог public-apis.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$DEST"

install_dir() { # $1 — исходная папка скилла
  local name; name="$(basename "$1")"
  rm -rf "${DEST:?}/${name:?}"
  cp -r "$1" "$DEST/$name"
  echo "✓ $name"
}

for s in "$ROOT"/skills/*/; do install_dir "${s%/}"; done

git clone -q --depth 1 https://github.com/apify/agent-skills "$TMP/apify"
install_dir "$TMP/apify/skills/apify-ultimate-scraper"

git clone -q --depth 1 https://github.com/firecrawl/cli "$TMP/firecrawl"
install_dir "$TMP/firecrawl/skills/firecrawl-scrape"

CATALOG="${PUBLIC_APIS_DIR:-$HOME/tools/public-apis}"
if [ -d "$CATALOG/.git" ]; then
  git -C "$CATALOG" pull -q
else
  mkdir -p "$(dirname "$CATALOG")"
  git clone -q --depth 1 https://github.com/public-apis/public-apis "$CATALOG"
fi
echo "✓ каталог public-apis → $CATALOG"
