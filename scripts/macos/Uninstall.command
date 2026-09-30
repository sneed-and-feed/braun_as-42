#!/bin/bash
# ==============================================================================
# BRAUN AS-42 — Uninstaller for macOS
# Double-click this script in Finder to remove installed AU, VST3, and Standalone.
# ==============================================================================

echo "=========================================================="
echo "          BRAUN AS-42 — macOS Uninstaller                 "
echo "=========================================================="
echo ""

read -p "Are you sure you want to remove BRAUN AS-42 from your system? (y/N): " confirm
if [[ "$confirm" != [yY] && "$confirm" != [yY][eE][sS] ]]; then
    echo "Uninstallation canceled."
    exit 0
fi

echo "Removing components..."
rm -rf "$HOME/Library/Audio/Plug-Ins/Components/BRAUN_AS42.component"
rm -rf "$HOME/Library/Audio/Plug-Ins/VST3/BRAUN_AS42.vst3"
rm -rf "$HOME/Applications/BRAUN_AS42.app"

echo "Flushing AudioComponentRegistrar cache..."
killall -9 AudioComponentRegistrar 2>/dev/null || true

echo "Uninstallation complete. All BRAUN AS-42 files have been removed."
read -n 1 -s -r -p "Press any key to close..."
echo ""
