#!/bin/bash
#
# Remove Capsule.app and its Launch Services registration.

set -euo pipefail

DEST_APP="/Applications/Capsule.app"

if [ ! -d "$DEST_APP" ]; then
    echo "Capsule.app is not installed at $DEST_APP."
    exit 0
fi

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -x "$LSREGISTER" ]; then
    "$LSREGISTER" -u "$DEST_APP" || true
fi

rm -rf "$DEST_APP"
echo "Uninstalled."
