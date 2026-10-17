#!/usr/bin/env bash
# npm-publish-from-token.sh — wire a user-provided granular npm token into
# ~/.npmrc and publish the prepared package, WITHOUT ever printing or
# copying the token into logs/chat. Token file must be chmod 600 and contain
# the bare token (one line, starts with npm_).
#
# Usage:  bash tools/npm-publish-from-token.sh /path/to/token-file
set -euo pipefail

TOKEN_FILE="${1:?usage: npm-publish-from-token.sh /path/to/token-file}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NPMRC="${NPMRC:-$HOME/.npmrc}"

[ -f "$TOKEN_FILE" ] || { echo "token file not found: $TOKEN_FILE" >&2; exit 2; }
chmod 600 "$TOKEN_FILE"

# Import without echoing: read token silently, append key=value line.
TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
case "$TOKEN" in
  npm_*) : ;;
  *) echo "token file does not look like an npm granular token (expected npm_ prefix); refusing" >&2; exit 2 ;;
esac
[ ${#TOKEN} -ge 20 ] || { echo "token implausibly short; refusing" >&2; exit 2; }

DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT
printf 'registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=%s\n' "$TOKEN" > "$DIR/npmrc"
chmod 600 "$DIR/npmrc"

cp -- "$NPMRC" "$DIR/npmrc.bak" 2>/dev/null || : 
cat -- "$DIR/npmrc" >> "$NPMRC"
chmod 600 "$NPMRC"
rm -f -- "$DIR/npmrc" "$DIR/npmrc.bak"

echo "token imported into $NPMRC (not stored in shell history, never printed)."
echo "identity check:"
npm whoami
echo "publishing from $REPO_DIR ..."
( cd "$REPO_DIR" && npm publish )
echo "---- verifying visibility on the live registry ----"
sleep 2
curl -s "https://registry.npmjs.org/research-scope-mcp" | python3 -c "import json,sys; d=json.load(sys.stdin); print('latest on registry:', d['dist-tags'].get('latest'))"
