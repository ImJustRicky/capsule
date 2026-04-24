#!/bin/bash
#
# Build a distributable Capsule.app bundle.
#
# Output:    installers/macos/build/Capsule.app
# Contains:  Info.plist, MacOS launcher, Resources/runtime/* (the built runtime + cli)
#
# This bundle is self-contained EXCEPT for Node.js itself, which the user
# must have installed on their machine. The launcher (Contents/MacOS/capsule)
# probes common Node install locations at runtime.
#
# Usage:  ./installers/macos/build.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUNDLE_SRC="$REPO_ROOT/installers/macos/Capsule.app"
ASSET_DIR="$REPO_ROOT/installers/assets"
BUILD_DIR="$REPO_ROOT/installers/macos/build"
OUT_APP="$BUILD_DIR/Capsule.app"

echo "==> Building runtime + cli"
cd "$REPO_ROOT"
pnpm install --frozen-lockfile >/dev/null
pnpm -r build

echo "==> Assembling Capsule.app"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
cp -R "$BUNDLE_SRC" "$OUT_APP"

if [ -f "$ASSET_DIR/capsule.icns" ]; then
    mkdir -p "$OUT_APP/Contents/Resources"
    cp "$ASSET_DIR/capsule.icns" "$OUT_APP/Contents/Resources/Capsule.icns"
    cp "$ASSET_DIR/capsule.icns" "$OUT_APP/Contents/Resources/CapsuleDocument.icns"
fi

# Copy each package's built dist + bin (skip node_modules; we'll re-install
# only the production deps inside the bundle).
RUNTIME_DIR="$OUT_APP/Contents/Resources/runtime"
mkdir -p "$RUNTIME_DIR/packages"
for pkg in capsule-core capsule-runtime capsule-cli; do
    mkdir -p "$RUNTIME_DIR/packages/$pkg"
    cp -R "packages/$pkg/dist" "$RUNTIME_DIR/packages/$pkg/dist"
    if [ -d "packages/$pkg/bin" ]; then
        cp -R "packages/$pkg/bin" "$RUNTIME_DIR/packages/$pkg/bin"
    fi
    cp "packages/$pkg/package.json" "$RUNTIME_DIR/packages/$pkg/package.json"
done

# Minimal root package.json + workspace config so the bundled CLI can resolve
# its workspace siblings via pnpm/npm-style symlinks.
cat > "$RUNTIME_DIR/package.json" <<'JSON'
{
  "name": "capsule-bundle",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "workspaces": ["packages/*"]
}
JSON

# Use plain npm (always present alongside Node) inside the bundle so we don't
# require the end user to have pnpm installed.
echo "==> Linking workspaces inside bundle"
node "$REPO_ROOT/installers/scripts/rewrite-workspace-deps.mjs" "$RUNTIME_DIR"
(cd "$RUNTIME_DIR" && npm install --omit=dev --no-audit --no-fund --silent)

echo "==> Stamping bundle"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $(date +%Y%m%d%H%M)" \
    "$OUT_APP/Contents/Info.plist" 2>/dev/null || true

echo "==> Done"
echo "Bundle: $OUT_APP"
echo
echo "Test it:"
echo "  open '$OUT_APP' --args path/to/file.capsule"
echo
echo "Install to /Applications:"
echo "  ./installers/macos/install.sh"
