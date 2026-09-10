#!/usr/bin/env bash
#
# Deploy the judge worker and push its secrets.
#
# Secrets are read from apps/judge/.dev.vars (gitignored) and piped straight
# into `wrangler secret put`, so no key is ever typed at a prompt, echoed to the
# terminal, or written into wrangler.toml where it would end up in the repo.
#
# JUDGE_API_KEY is the exception: production gets its own strong key rather than
# the local dev one, because the deployed endpoint is reachable by anyone who
# learns it and the LLM calls behind it cost real money.
#
# Usage:
#   ./deploy.sh                 # generates a production key on first run
#   PROD_KEY=... ./deploy.sh    # or supply your own
set -euo pipefail

cd "$(dirname "$0")"
VARS=".dev.vars"
KEY_FILE="../../.judge-prod-key"   # gitignored; keeps the key stable across deploys

[ -f "$VARS" ] || { echo "missing $VARS"; exit 1; }

read_var() {
  grep "^$1=" "$VARS" | head -1 | cut -d= -f2- || true
}

put_secret() {
  local name="$1" value="$2"
  if [ -z "$value" ]; then
    echo "  - $name: not set locally, skipping"
    return
  fi
  printf '%s' "$value" | npx --yes wrangler secret put "$name" >/dev/null 2>&1
  echo "  - $name: set (${#value} chars)"
}

if [ -n "${PROD_KEY:-}" ]; then
  printf '%s' "$PROD_KEY" > "$KEY_FILE"
elif [ ! -f "$KEY_FILE" ]; then
  python3 -c "import secrets;print('evzi_'+secrets.token_urlsafe(32),end='')" > "$KEY_FILE"
  echo "generated a new production api key → $KEY_FILE"
fi
PROD_KEY="$(cat "$KEY_FILE")"

echo "deploying…"
npx --yes wrangler deploy 2>&1 | grep -E 'Uploaded|Deployed|https://' || true

echo "setting secrets…"
put_secret JUDGE_API_KEY       "$PROD_KEY"
put_secret OPENAI_API_KEY      "$(read_var OPENAI_API_KEY)"
put_secret GRAPH_API_KEY       "$(read_var GRAPH_API_KEY)"
put_secret GRAPH_TOKEN_API_JWT "$(read_var GRAPH_TOKEN_API_JWT)"

echo
echo "done. The production api key lives in $KEY_FILE (gitignored)."
echo "Smoke-test it with:"
echo "  curl -s https://<worker-url>/openapi.json | head -c 80"
