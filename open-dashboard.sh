#!/bin/bash
# BTC Terminal — Open Dashboard in Chrome Kiosk Mode
# Waits for server to be ready, then opens fullscreen Chrome

PORT=8420
URL="http://localhost:$PORT"

# Wait for server to be ready (max 30s)
for i in $(seq 1 30); do
    if curl -s -o /dev/null -w "" "$URL" 2>/dev/null; then
        break
    fi
    sleep 1
done

# Open in Chrome kiosk mode (fullscreen, no UI chrome)
if [ -d "/Applications/Google Chrome.app" ]; then
    open -a "Google Chrome" --args --kiosk --no-first-run --disable-session-crashed-bubble "$URL"
elif [ -d "/Applications/Chromium.app" ]; then
    open -a "Chromium" --args --kiosk "$URL"
else
    # Fallback: Safari
    open "$URL"
fi
