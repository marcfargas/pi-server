#!/bin/bash
# Publish all packages with trusted publishing (OIDC).
# Called by the release workflow after changeset version.
set -euo pipefail

echo "Publishing packages..."
echo "npm version: $(npm --version)"
echo "node version: $(node --version)"

for pkg in packages/protocol packages/server packages/tui-client; do
  name=$(node -p "require('./$pkg/package.json').name")
  version=$(node -p "require('./$pkg/package.json').version")

  # Check if this version already exists on npm
  if npm view "$name@$version" version 2>/dev/null; then
    echo "⏭  $name@$version already published, skipping"
  else
    echo "📦 Publishing $name@$version..."
    npm publish "./$pkg" --access public
    echo "✅ $name@$version published"
  fi
done
