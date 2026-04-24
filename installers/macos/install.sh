#!/bin/bash
#
# Install Capsule.app to /Applications and register it as the handler for
# .capsule files in Finder.
#
# Usage:  ./installers/macos/install.sh
#
# Reverses cleanly with:  ./installers/macos/uninstall.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD_APP="$REPO_ROOT/installers/macos/build/Capsule.app"
DEST_APP="/Applications/Capsule.app"

if [ ! -d "$BUILD_APP" ]; then
    echo "Capsule.app has not been built yet."
    echo "Run: ./installers/macos/build.sh"
    exit 1
fi

echo "==> Installing $DEST_APP"
if [ -d "$DEST_APP" ]; then
    rm -rf "$DEST_APP"
fi
cp -R "$BUILD_APP" "$DEST_APP"

# Force Launch Services to re-read the Info.plist so the file association
# becomes active immediately (otherwise it can take a logout/login).
echo "==> Registering with Launch Services"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -x "$LSREGISTER" ]; then
    "$LSREGISTER" -f "$DEST_APP"
fi

# Set Capsule.app as the default opener for .capsule files. Falls back
# silently if `duti` isn't installed; the file association in Info.plist
# still works on first double-click via Launch Services anyway.
if command -v duti >/dev/null 2>&1; then
    duti -s dev.capsule.runtime org.capsule.capsule all
    echo "==> Set as default for .capsule files (via duti)"
else
    echo "==> Tip: install \`duti\` (brew install duti) to force-set Capsule"
    echo "    as the default opener for .capsule files. Otherwise macOS will"
    echo "    pick it up automatically the first time you double-click one."
fi

echo
echo "Installed."
echo "Try it: double-click any .capsule file in Finder."
