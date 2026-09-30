#!/bin/bash
# ==============================================================================
# BRAUN AS-42 — One-Click Standalone Launcher for macOS
# Double-click this script in Finder to run BRAUN AS-42 immediately with zero setup.
# ==============================================================================

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

echo "=========================================================="
echo "          Launching BRAUN AS-42 Standalone...             "
echo "=========================================================="

APP_PATH="$DIR/Standalone/BRAUN_AS42.app"

if [ ! -d "$APP_PATH" ]; then
    APP_PATH="$HOME/Applications/BRAUN_AS42.app"
fi

if [ ! -d "$APP_PATH" ]; then
    echo "Error: BRAUN_AS42.app not found. Please run Install.command first."
    read -n 1 -s -r -p "Press any key to exit..."
    exit 1
fi

echo "Removing macOS Gatekeeper quarantine attribute and ensuring ad-hoc signature..."
xattr -cr "$APP_PATH" 2>/dev/null || true
codesign --force --deep --sign - "$APP_PATH" 2>/dev/null || true

echo "Opening BRAUN AS-42..."
open "$APP_PATH"
