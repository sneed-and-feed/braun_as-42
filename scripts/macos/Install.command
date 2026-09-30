#!/bin/bash
# ==============================================================================
# BRAUN AS-42 — Easy Installer for macOS (Universal: Apple Silicon & Intel)
# Double-click this script in Finder to install AU, VST3, and Standalone.
# ==============================================================================

set -e

# Set working directory to script location
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

# ANSI color codes
BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
ORANGE='\033[0;33m'
RESET='\033[0m'

echo ""
echo -e "${BOLD}${ORANGE}================================================================${RESET}"
echo -e "${BOLD}${ORANGE}        BRAUN AS-42 AMBIENT SYNTH — macOS EASY INSTALLER        ${RESET}"
echo -e "${BOLD}${ORANGE}================================================================${RESET}"
echo ""

ARCH=$(uname -m)
echo -e "${CYAN}Target System Architecture:${RESET} ${BOLD}${ARCH}${RESET}"
echo ""

# Destination directories in user Library (no root / sudo required)
AU_DIR="$HOME/Library/Audio/Plug-Ins/Components"
VST3_DIR="$HOME/Library/Audio/Plug-Ins/VST3"
APP_DIR="$HOME/Applications"

echo "Creating plugin destination directories..."
mkdir -p "$AU_DIR" "$VST3_DIR" "$APP_DIR"

# 1. Install Audio Unit (.component)
if [ -d "$DIR/AU/BRAUN_AS42.component" ]; then
    echo -e "Installing ${BOLD}Audio Unit (AU)${RESET} -> $AU_DIR/BRAUN_AS42.component..."
    rm -rf "$AU_DIR/BRAUN_AS42.component"
    cp -R "$DIR/AU/BRAUN_AS42.component" "$AU_DIR/"
    xattr -cr "$AU_DIR/BRAUN_AS42.component" 2>/dev/null || true
    codesign --force --deep --sign - "$AU_DIR/BRAUN_AS42.component" 2>/dev/null || true
    echo -e "${GREEN}  ✓ AU installed, unquarantined & ad-hoc signed${RESET}"
fi

# 2. Install VST3 (.vst3)
if [ -d "$DIR/VST3/BRAUN_AS42.vst3" ]; then
    echo -e "Installing ${BOLD}VST3${RESET} -> $VST3_DIR/BRAUN_AS42.vst3..."
    rm -rf "$VST3_DIR/BRAUN_AS42.vst3"
    cp -R "$DIR/VST3/BRAUN_AS42.vst3" "$VST3_DIR/"
    xattr -cr "$VST3_DIR/BRAUN_AS42.vst3" 2>/dev/null || true
    codesign --force --deep --sign - "$VST3_DIR/BRAUN_AS42.vst3" 2>/dev/null || true
    echo -e "${GREEN}  ✓ VST3 installed, unquarantined & ad-hoc signed${RESET}"
fi

# 3. Install Standalone (.app)
if [ -d "$DIR/Standalone/BRAUN_AS42.app" ]; then
    echo -e "Installing ${BOLD}Standalone App${RESET} -> $APP_DIR/BRAUN_AS42.app..."
    rm -rf "$APP_DIR/BRAUN_AS42.app"
    cp -R "$DIR/Standalone/BRAUN_AS42.app" "$APP_DIR/"
    xattr -cr "$APP_DIR/BRAUN_AS42.app" 2>/dev/null || true
    codesign --force --deep --sign - "$APP_DIR/BRAUN_AS42.app" 2>/dev/null || true
    echo -e "${GREEN}  ✓ Standalone app installed, unquarantined & ad-hoc signed${RESET}"
fi

# 4. Flush macOS AudioComponentRegistrar cache so Logic / DAWs see it immediately
echo ""
echo "Flushing macOS CoreAudio plugin cache..."
killall -9 AudioComponentRegistrar 2>/dev/null || true

echo ""
echo -e "${BOLD}${GREEN}================================================================${RESET}"
echo -e "${BOLD}${GREEN}         INSTALLATION COMPLETE — BRAUN AS-42 IS READY!          ${RESET}"
echo -e "${BOLD}${GREEN}================================================================${RESET}"
echo ""
echo "DAW Availability:"
echo "  • Logic Pro / GarageBand:  Audio Units -> Braun -> BRAUN_AS42"
echo "  • Ableton Live / FL Studio: VST3 -> Braun -> BRAUN_AS42"
echo "  • Reaper / Studio One / Cubase: VST3 -> BRAUN_AS42"
echo "  • Standalone: Launch from $APP_DIR/BRAUN_AS42.app"
echo ""
read -n 1 -s -r -p "Press any key to close this window..."
echo ""
