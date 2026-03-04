#!/bin/bash
# BTC Terminal — CGI Server Launcher
# Serves the dashboard on port 8420

cd "$(dirname "$0")"

PORT=8420

# Kill any existing instance
pkill -f "python3 -m http.server $PORT" 2>/dev/null

echo "[BTC Terminal] Starting on http://localhost:$PORT"
exec python3 -m http.server "$PORT" --cgi --bind 0.0.0.0
