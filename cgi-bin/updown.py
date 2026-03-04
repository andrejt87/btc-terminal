#!/usr/bin/env python3
"""
BTC Bloomberg Terminal — Bitcoin Up or Down 5-Min Proxy
Finds the currently active 5-minute BTC prediction market on Polymarket,
fetches real-time CLOB prices, and returns structured JSON.
Ultra-low cache (3s) for near-real-time updates.
"""

import json
import os
import sys
import time
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from datetime import datetime, timezone

GAMMA_BASE = "https://gamma-api.polymarket.com"
CLOB_BASE = "https://clob.polymarket.com"
TIMEOUT = 5
USER_AGENT = "BTC-Terminal/1.0 (UpDown Proxy)"

# Ultra-short cache: 3 seconds (frontend polls every 1s, but we cache briefly)
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "updown_cache.json")
REF_PRICE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "updown_ref.json")
CACHE_TTL = 3


def load_cache():
    try:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, "r") as f:
                data = json.load(f)
            if time.time() - data.get("ts", 0) < CACHE_TTL:
                return data.get("payload")
    except Exception:
        pass
    return None


def save_cache(payload):
    try:
        with open(CACHE_FILE, "w") as f:
            json.dump({"ts": time.time(), "payload": payload}, f)
    except Exception:
        pass


def fetch_json(url):
    try:
        req = Request(url, headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read())
    except Exception:
        return None


def find_current_market():
    """Find the currently active 5-minute BTC up/down market."""
    now_ts = int(time.time())
    # Round down to last 5-min boundary
    current_5min = (now_ts // 300) * 300

    # Try current window first, then previous (in case we're in transition)
    for offset in [0, -300, 300]:
        ts = current_5min + offset
        slug = f"btc-updown-5m-{ts}"
        data = fetch_json(f"{GAMMA_BASE}/events?slug={slug}")
        if data and len(data) > 0:
            event = data[0]
            if event.get("active") and not event.get("closed"):
                markets = event.get("markets", [])
                if markets and not markets[0].get("closed"):
                    return event, ts
    return None, None


def get_clob_prices(market):
    """Get real-time prices from CLOB API."""
    clob_ids_raw = market.get("clobTokenIds", "[]")
    try:
        clob_ids = json.loads(clob_ids_raw) if isinstance(clob_ids_raw, str) else clob_ids_raw
    except (json.JSONDecodeError, TypeError):
        clob_ids = []

    if len(clob_ids) < 2:
        # Fallback to Gamma prices
        prices_raw = market.get("outcomePrices", "[]")
        try:
            prices = json.loads(prices_raw) if isinstance(prices_raw, str) else prices_raw
        except (json.JSONDecodeError, TypeError):
            prices = ["0.5", "0.5"]
        up_price = float(prices[0])
        down_price = float(prices[1])
        return {
            "up": round(up_price * 100, 1),
            "down": round(down_price * 100, 1),
            "up_raw": up_price,
            "down_raw": down_price,
            "source": "gamma",
        }

    # Fetch from CLOB for real-time data
    up_token = clob_ids[0]
    down_token = clob_ids[1]

    up_data = fetch_json(f"{CLOB_BASE}/price?token_id={up_token}&side=buy")
    down_data = fetch_json(f"{CLOB_BASE}/price?token_id={down_token}&side=buy")

    # Also get midpoint for more accuracy
    mid_data = fetch_json(f"{CLOB_BASE}/midpoint?token_id={up_token}")

    up_price = float(up_data.get("price", "0.5")) if up_data else 0.5
    down_price = float(down_data.get("price", "0.5")) if down_data else 0.5
    mid_price = float(mid_data.get("mid", "0.5")) if mid_data else None

    return {
        "up": round(up_price * 100, 1),
        "down": round(down_price * 100, 1),
        "up_raw": up_price,
        "down_raw": down_price,
        "mid_up": round(mid_price * 100, 1) if mid_price else None,
        "source": "clob",
    }


def get_btc_reference_price(window_ts):
    """Get the BTC reference price for this window.
    The ref price is locked once per 5-min window and stored on disk.
    It only changes when a new window starts."""
    # Try to load existing ref price for this exact window
    try:
        if os.path.exists(REF_PRICE_FILE):
            with open(REF_PRICE_FILE, "r") as f:
                ref_data = json.load(f)
            if ref_data.get("window_ts") == window_ts:
                return ref_data.get("ref_price")
    except Exception:
        pass

    # New window — fetch current price and lock it
    data = fetch_json("https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT")
    ref_price = round(float(data["price"]), 2) if data and "price" in data else None

    # Persist for this window
    try:
        with open(REF_PRICE_FILE, "w") as f:
            json.dump({"window_ts": window_ts, "ref_price": ref_price}, f)
    except Exception:
        pass

    return ref_price


def main():
    # Try cache first
    cached = load_cache()
    if cached:
        print("Content-Type: application/json")
        print("Access-Control-Allow-Origin: *")
        print()
        print(json.dumps(cached))
        return

    event, window_ts = find_current_market()

    if not event:
        payload = {
            "active": False,
            "message": "No active 5-min market right now",
            "fetched_at": time.time(),
        }
        save_cache(payload)
        print("Content-Type: application/json")
        print("Access-Control-Allow-Origin: *")
        print()
        print(json.dumps(payload))
        return

    market = event["markets"][0]
    prices = get_clob_prices(market)

    # Get reference price (locked per window)
    ref_price = get_btc_reference_price(window_ts)

    # Calculate payout per $1 bet
    # On Polymarket: you buy shares at the current price.
    # If you win, each share pays out $1.00.
    # Payout per $1 invested = $1.00 / buy_price
    up_raw = prices.get("up_raw", 0.5)
    down_raw = prices.get("down_raw", 0.5)
    payout_up = round(1.0 / up_raw, 2) if up_raw > 0 else 0
    payout_down = round(1.0 / down_raw, 2) if down_raw > 0 else 0
    # Net profit per $1 = payout - $1
    profit_up = round(payout_up - 1.0, 2)
    profit_down = round(payout_down - 1.0, 2)

    # Calculate time remaining in this window
    now_ts = int(time.time())
    window_end = window_ts + 300
    remaining_seconds = max(0, window_end - now_ts)

    # Build the time label
    start_dt = datetime.fromtimestamp(window_ts, tz=timezone.utc)
    end_dt = datetime.fromtimestamp(window_end, tz=timezone.utc)

    payload = {
        "active": True,
        "title": event.get("title", ""),
        "slug": event.get("slug", ""),
        "window_start": window_ts,
        "window_end": window_end,
        "remaining_seconds": remaining_seconds,
        "time_label": f"{start_dt.strftime('%H:%M')}-{end_dt.strftime('%H:%M')} UTC",
        "up_pct": prices["up"],
        "down_pct": prices["down"],
        "mid_up_pct": prices.get("mid_up"),
        "price_source": prices["source"],
        "ref_price": ref_price,
        "payout_up": payout_up,
        "payout_down": payout_down,
        "profit_up": profit_up,
        "profit_down": profit_down,
        "volume": event.get("volume", 0),
        "volume24h": event.get("volume24hr", 0),
        "liquidity": event.get("liquidity", 0),
        "url": f"https://polymarket.com/event/{event.get('slug', '')}",
        "fetched_at": time.time(),
    }

    save_cache(payload)

    print("Content-Type: application/json")
    print("Access-Control-Allow-Origin: *")
    print()
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
