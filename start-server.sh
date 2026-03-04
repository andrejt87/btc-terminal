#!/bin/bash
# BTC Terminal — CGI Server Launcher
# Serves the dashboard on port 8420 with no-cache headers

cd "$(dirname "$0")"

PORT=8420

# Kill any existing instance
pkill -f "python3.*btc_server.py" 2>/dev/null
pkill -f "python3 -m http.server $PORT" 2>/dev/null

echo "[BTC Terminal] Starting on http://localhost:$PORT"
exec python3 btc_server.py "$PORT"
