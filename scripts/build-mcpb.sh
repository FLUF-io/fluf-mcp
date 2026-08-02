#!/usr/bin/env bash
#
# Build the .mcpb bundle — the double-click install path for Claude Desktop.
#
# Why this exists: the npx config route in the README needs Node on the user's
# machine and a hand-edited claude_desktop_config.json. Claude Desktop ships its
# own Node runtime, but only uses it for installed bundles — not for
# claude_desktop_config.json entries, which spawn `command` from the system PATH.
# A seller who has never installed Node can install this file and be running in
# under a minute; the token goes in a form field, not a JSON file.
#
# The bundle carries node_modules, so it must be staged from a PRODUCTION install
# — a dev tree drags typescript and @types/node in for no reason.
#
# Usage:  npm run bundle
# Output: fluf-mcp-<version>.mcpb in this directory (gitignored — attach it to a
#         GitHub release, don't commit it).

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
STAGE="$ROOT/.mcpb-build"
VERSION="$(node -p "require('./package.json').version")"
OUT="$ROOT/fluf-mcp-${VERSION}.mcpb"

# The manifest and package.json versions are read from different files by
# different tools; if they disagree the installed extension reports a version
# that was never published.
MANIFEST_VERSION="$(node -p "require('./manifest.json').version")"
if [ "$VERSION" != "$MANIFEST_VERSION" ]; then
  echo "✗ version mismatch: package.json is $VERSION, manifest.json is $MANIFEST_VERSION" >&2
  exit 1
fi

echo "→ building fluf-mcp $VERSION"

npm run build

rm -rf "$STAGE"
mkdir -p "$STAGE"

cp -R "$ROOT/dist" "$STAGE/dist"
cp "$ROOT/manifest.json" "$ROOT/package.json" "$ROOT/README.md" "$ROOT/LICENSE" "$ROOT/icon.png" "$STAGE/"

# Source maps are ~40% of dist and useless inside an installed bundle.
find "$STAGE/dist" -name '*.map' -delete

# Production-only dependency tree, resolved from the committed lockfile so the
# bundle matches what `npm ci` would give a user.
cp "$ROOT/package-lock.json" "$STAGE/"
( cd "$STAGE" && npm ci --omit=dev --ignore-scripts --silent )
rm -f "$STAGE/package-lock.json"

npx --yes @anthropic-ai/mcpb validate "$STAGE/manifest.json"
rm -f "$OUT"
npx --yes @anthropic-ai/mcpb pack "$STAGE" "$OUT"

rm -rf "$STAGE"

echo
echo "✓ $OUT"
echo "  $(du -h "$OUT" | cut -f1) — attach to the GitHub release, and test it by"
echo "  double-clicking before you publish."
