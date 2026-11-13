#!/bin/sh
# Upload the scores page to Vercel. Only two files ever leave this Mac:
# web/index.html and data/export.json (names and scores, no phone numbers).
# config.json and the database are never copied.
#
# Skips the upload when neither file changed since the last one.
# FORCE=1 sh scripts/deploy.sh uploads anyway.
# Run by com.perceptle-tracker.deploy whenever data/ changes, plus hourly
# (scripts/install-deploy-launchd.sh).
set -eu
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT"

# The Vercel project name lives in config.json (not in the repo), so the
# public code doesn't point at the live site.
PROJECT_NAME="$(bun -e 'process.stdout.write(require("./config.json").vercelProject ?? "")')"
[ -n "$PROJECT_NAME" ] || { echo "set \"vercelProject\" in config.json first" >&2; exit 1; }
SITE="$PROJECT/data/site"      # upload folder; keeps Vercel's .vercel link between runs
STAMP="$PROJECT/data/.last-deploy"
stamp() { date "+[%m/%d/%Y, %I:%M:%S %p]"; }

[ -f data/export.json ] || { echo "$(stamp) no data/export.json yet; run a scan first" >&2; exit 1; }

hash="$(cat web/index.html data/export.json | shasum -a 256 | cut -d' ' -f1)"
if [ "${FORCE:-0}" != 1 ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$hash" ]; then
  # The job wakes hourly and on every change in data/; only say so when run by hand.
  [ -t 1 ] && echo "$(stamp) no changes since the last upload; skipped"
  exit 0
fi

mkdir -p "$SITE"
cp web/index.html "$SITE/index.html"
cp data/export.json "$SITE/export.json"
# Keep the page and its data out of search engines: reachable by link only.
cat > "$SITE/vercel.json" <<'EOF'
{
  "headers": [
    { "source": "/(.*)", "headers": [{ "key": "X-Robots-Tag", "value": "noindex, nofollow" }] }
  ]
}
EOF

# Upload only the page, its data and the headers file. `vercel link` drops a
# .env.local (a project token) in this folder; it must never be uploaded.
cat > "$SITE/.vercelignore" <<'EOF'
*
!index.html
!export.json
!vercel.json
EOF

if [ ! -f "$SITE/.vercel/project.json" ]; then
  vercel link --yes --project "$PROJECT_NAME" --cwd "$SITE"
fi

# A failed upload exits here (set -e), so the stamp is only written on success.
out="$(vercel deploy --prod --yes --cwd "$SITE")"
echo "$hash" > "$STAMP"
# Outside a terminal the CLI answers in JSON; log just the deployment URL.
url="$(printf '%s\n' "$out" | sed -n 's/.*"url": *"\(https:[^"]*\)".*/\1/p' | head -n 1)"
echo "$(stamp) uploaded to https://$PROJECT_NAME.vercel.app (${url:-$out})"
