#!/bin/bash
#
# Reverse installers/linux/install.sh

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "Re-run with: sudo $0"
    exit 1
fi

PREFIX="${PREFIX:-/usr/local}"

rm -rf "$PREFIX/lib/capsule"
rm -f "$PREFIX/bin/capsule-launcher"
rm -f "$PREFIX/share/applications/capsule.desktop"
rm -f "$PREFIX/share/mime/packages/capsule.xml"
rm -f "$PREFIX/share/icons/hicolor/256x256/apps/capsule.png"
rm -f "$PREFIX/share/icons/hicolor/256x256/mimetypes/application-vnd.capsule+zip.png"

if command -v update-mime-database >/dev/null 2>&1; then
    update-mime-database "$PREFIX/share/mime" || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$PREFIX/share/applications" || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1 && [ -d "$PREFIX/share/icons/hicolor" ]; then
    gtk-update-icon-cache -q -t -f "$PREFIX/share/icons/hicolor" || true
fi

echo "Uninstalled."
