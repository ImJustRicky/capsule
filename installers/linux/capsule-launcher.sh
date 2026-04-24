#!/bin/bash
#
# Linux launcher for .capsule files. Installed to /usr/local/bin/capsule-launcher
# by ./install.sh and referenced from capsule.desktop.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PREFIX_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_ENTRY="${CAPSULE_RUNTIME_ENTRY:-$PREFIX_DIR/lib/capsule/packages/capsule-cli/bin/capsule.mjs}"

if ! command -v node >/dev/null 2>&1; then
    if command -v zenity >/dev/null 2>&1; then
        zenity --error --title="Capsule" \
            --text="Capsule needs Node.js (v20 or newer) to run.\n\nInstall it from https://nodejs.org and try again."
    elif command -v notify-send >/dev/null 2>&1; then
        notify-send "Capsule" "Node.js (v20+) is required. Install from https://nodejs.org"
    else
        echo "Capsule: Node.js (v20+) is required. Install from https://nodejs.org" >&2
    fi
    exit 1
fi
NODE_BIN="$(command -v node)"
if ! "$NODE_BIN" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' >/dev/null 2>&1; then
    if command -v zenity >/dev/null 2>&1; then
        zenity --error --title="Capsule" \
            --text="Capsule needs Node.js v20 or newer to run.\n\nCurrent version: $("$NODE_BIN" -v)"
    elif command -v notify-send >/dev/null 2>&1; then
        notify-send "Capsule" "Node.js v20+ is required. Current version: $("$NODE_BIN" -v)"
    else
        echo "Capsule: Node.js v20+ is required. Current version: $("$NODE_BIN" -v)" >&2
    fi
    exit 1
fi

if [ ! -f "$RUNTIME_ENTRY" ]; then
    echo "Capsule runtime not found at $RUNTIME_ENTRY" >&2
    exit 1
fi

if [ "$#" -eq 0 ]; then
    if command -v zenity >/dev/null 2>&1; then
        zenity --info --title="Capsule" \
            --text="Capsule is installed.\n\nTo open a .capsule file, double-click it or run:\n  capsule-launcher path/to/file.capsule"
    fi
    exit 0
fi

exec "$NODE_BIN" "$RUNTIME_ENTRY" run "$@"
