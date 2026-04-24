#!/bin/bash
#
# Install Capsule on Linux:
#   - Installs a packaged runtime, or builds one when run from a source checkout
#   - Installs files to /usr/local/lib/capsule (runtime) and /usr/local/bin (launcher)
#   - Registers the Capsule MIME type, desktop file, and icons
#
# Requires: node 20+, sudo for system prefixes; pnpm only for source installs
# Tested on: Ubuntu 22.04+, Fedora 38+, Arch
#
# Usage:    sudo ./installers/linux/install.sh
# Reverse:  sudo ./installers/linux/uninstall.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PACKAGED_RUNTIME="$SCRIPT_DIR/runtime"
PREFIX="${PREFIX:-/usr/local}"
LIB_DIR="$PREFIX/lib/capsule"
BIN_DIR="$PREFIX/bin"
ASSET_DIR="$SCRIPT_DIR/assets"
if [ ! -d "$ASSET_DIR" ] && [ -d "$SOURCE_ROOT/installers/assets" ]; then
    ASSET_DIR="$SOURCE_ROOT/installers/assets"
fi

PREFIX_PARENT="$(dirname "$PREFIX")"
if [ "$(id -u)" -ne 0 ] && { { [ -e "$PREFIX" ] && [ ! -w "$PREFIX" ]; } || { [ ! -e "$PREFIX" ] && [ ! -w "$PREFIX_PARENT" ]; }; }; then
    echo "This installer needs permission to write to $PREFIX."
    echo "Re-run with: sudo $0"
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "Capsule needs Node.js v20 or newer. Install it from https://nodejs.org and re-run this installer."
    exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' >/dev/null 2>&1; then
    echo "Capsule needs Node.js v20 or newer. Current version: $(node -v)"
    exit 1
fi

install_source_runtime() {
    if ! command -v pnpm >/dev/null 2>&1; then
        echo "Source install needs pnpm. Use a release tarball to install without pnpm."
        exit 1
    fi
    if ! command -v npm >/dev/null 2>&1; then
        echo "Source install needs npm. Install Node.js from https://nodejs.org and try again."
        exit 1
    fi

    echo "==> Building runtime"
    if [ "$(id -u)" -eq 0 ]; then
        SUDO_USER_NAME="${SUDO_USER:-root}"
        sudo -u "$SUDO_USER_NAME" env REPO_ROOT="$SOURCE_ROOT" \
            bash -c 'cd "$REPO_ROOT" && pnpm install --frozen-lockfile && pnpm -r build'
    else
        (cd "$SOURCE_ROOT" && pnpm install --frozen-lockfile && pnpm -r build)
    fi

    echo "==> Installing runtime to $LIB_DIR"
    rm -rf "$LIB_DIR"
    mkdir -p "$LIB_DIR/packages"
    for pkg in capsule-core capsule-runtime capsule-cli; do
        mkdir -p "$LIB_DIR/packages/$pkg"
        cp -R "$SOURCE_ROOT/packages/$pkg/dist" "$LIB_DIR/packages/$pkg/dist"
        if [ -d "$SOURCE_ROOT/packages/$pkg/bin" ]; then
            cp -R "$SOURCE_ROOT/packages/$pkg/bin" "$LIB_DIR/packages/$pkg/bin"
        fi
        cp "$SOURCE_ROOT/packages/$pkg/package.json" "$LIB_DIR/packages/$pkg/package.json"
    done
    cat > "$LIB_DIR/package.json" <<'JSON'
{
  "name": "capsule-bundle",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "workspaces": ["packages/*"]
}
JSON
    node "$SOURCE_ROOT/installers/scripts/rewrite-workspace-deps.mjs" "$LIB_DIR"
    (cd "$LIB_DIR" && npm install --omit=dev --no-audit --no-fund --silent)
}

install_packaged_runtime() {
    echo "==> Installing packaged runtime to $LIB_DIR"
    rm -rf "$LIB_DIR"
    mkdir -p "$LIB_DIR"
    cp -R "$PACKAGED_RUNTIME/." "$LIB_DIR/"
}

if [ -d "$PACKAGED_RUNTIME/packages/capsule-cli" ]; then
    install_packaged_runtime
elif [ -d "$SOURCE_ROOT/packages/capsule-cli" ]; then
    install_source_runtime
else
    echo "No packaged runtime or source checkout found."
    echo "Run this from a Capsule release tarball, or from the repository checkout."
    exit 1
fi

echo "==> Installing launcher to $BIN_DIR/capsule-launcher"
install -d "$BIN_DIR"
install -m 0755 "$SCRIPT_DIR/capsule-launcher.sh" "$BIN_DIR/capsule-launcher"

echo "==> Installing .desktop entry"
install -d "$PREFIX/share/applications"
install -m 0644 "$SCRIPT_DIR/capsule.desktop" "$PREFIX/share/applications/capsule.desktop"

if [ -f "$ASSET_DIR/capsule.png" ]; then
    echo "==> Installing icons"
    install -d "$PREFIX/share/icons/hicolor/256x256/apps"
    install -d "$PREFIX/share/icons/hicolor/256x256/mimetypes"
    install -m 0644 "$ASSET_DIR/capsule.png" "$PREFIX/share/icons/hicolor/256x256/apps/capsule.png"
    install -m 0644 "$ASSET_DIR/capsule.png" "$PREFIX/share/icons/hicolor/256x256/mimetypes/application-vnd.capsule+zip.png"
fi

echo "==> Registering MIME type"
install -d "$PREFIX/share/mime/packages"
cat > "$PREFIX/share/mime/packages/capsule.xml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/vnd.capsule+zip">
    <comment>Capsule Document</comment>
    <sub-class-of type="application/zip"/>
    <glob pattern="*.capsule"/>
    <icon name="capsule"/>
  </mime-type>
</mime-info>
XML

if [ "${CAPSULE_SKIP_REGISTRATION:-0}" = "1" ]; then
    echo "==> Skipping desktop database registration"
else
    if command -v update-mime-database >/dev/null 2>&1; then
        update-mime-database "$PREFIX/share/mime"
    fi
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$PREFIX/share/applications"
    fi
    if command -v gtk-update-icon-cache >/dev/null 2>&1 && [ -d "$PREFIX/share/icons/hicolor" ]; then
        gtk-update-icon-cache -q -t -f "$PREFIX/share/icons/hicolor" || true
    fi
    if command -v xdg-mime >/dev/null 2>&1; then
        xdg-mime default capsule.desktop application/vnd.capsule+zip
    fi
fi

echo
echo "Installed."
echo "Open a capsule by double-clicking it, or run:"
echo "  capsule-launcher path/to/file.capsule"
