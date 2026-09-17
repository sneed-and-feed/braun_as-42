#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "===================================================================="
echo "  BRAUN AS 42 - AMBIENT GENERATIVE SYNTHESIZER"
echo "  \"Weniger, aber besser\" - Dieter Rams Design Principles"
echo "===================================================================="
echo ""

open_browser() {
    local url="http://localhost:3000"
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1 &
    elif command -v open >/dev/null 2>&1; then
        open "$url" >/dev/null 2>&1 &
    fi
}

if command -v node >/dev/null 2>&1; then
    echo "[OK] Node.js runtime detected."
    echo "Starting static audio server on http://localhost:3000 ..."
    echo "Press Ctrl+C to shut down."
    echo "--------------------------------------------------------------------"
    (sleep 1 && open_browser) &
    node server.js
elif command -v python3 >/dev/null 2>&1; then
    echo "[INFO] Node.js not detected, using Python 3 HTTP server on port 3000 ..."
    (sleep 1 && open_browser) &
    python3 -m http.server 3000
elif command -v python >/dev/null 2>&1; then
    echo "[INFO] Node.js not detected, using Python HTTP server on port 3000 ..."
    (sleep 1 && open_browser) &
    python -m http.server 3000
else
    echo "[ERROR] Neither Node.js nor Python was found on your PATH."
    echo "Please install Node.js (https://nodejs.org/) or Python 3 (https://python.org)."
    exit 1
fi
