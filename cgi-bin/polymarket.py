#!/usr/bin/env python3
"""
BTC Bloomberg Terminal — Polymarket Odds Proxy
Fetches BTC prediction market data from Polymarket's Gamma API.
Returns structured JSON with short/mid/long-term BTC price predictions.
Cache: 30s (to stay well within rate limits; frontend polls every 10s).
"""

import json
import os
import sys
import time
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

# ─── Market Configuration ─────────────────────────────────────────
# Key BTC prediction markets organized by time horizon
MARKETS = {
    "short": [
        {
            "slug": "what-price-will-bitcoin-hit-in-march-2026",
            "label": "BTC Price Target — March 2026",
            "horizon": "short",
        },
        {
            "slug": "bitcoin-above-on-march-5",
            "label": "BTC Above $X on March 5",
            "horizon": "short",
        },
    ],
    "mid": [
        {
            "slug": "will-bitcoin-hit-60k-or-80k-first-965",
            "label": "BTC $60K or $80K First?",
            "horizon": "mid",
        },
        {
            "slug": "what-price-will-bitcoin-hit-before-2027",
            "label": "BTC Price Target — 2026",
            "horizon": "mid",
        },
    ],
    "long": [
        {
            "slug": "bitcoin-all-time-high-by",
            "label": "BTC All-Time High By...",
            "horizon": "long",
        },
        {
            "slug": "when-will-bitcoin-hit-150k",
            "label": "When Will BTC Hit $150K?",
            "horizon": "long",
        },
    ],
}

GAMMA_BASE = "https://gamma-api.polymarket.com"
TIMEOUT = 8
USER_AGENT = "BTC-Terminal/1.0 (Polymarket Proxy)"

# ─── Cache ────────────────────────────────────────────────────────
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "polymarket_cache.json")
CACHE_TTL = 30  # 30 seconds


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


# ─── Fetch event from Gamma API ──────────────────────────────────
def fetch_event(slug):
    """Fetch a single event by slug. Returns parsed JSON or None."""
    url = f"{GAMMA_BASE}/events?slug={slug}"
    try:
        req = Request(url, headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read())
        if data and isinstance(data, list) and len(data) > 0:
            return data[0]
    except Exception:
        pass
    return None


def parse_market(market):
    """Parse a single market into a clean structure."""
    outcomes_raw = market.get("outcomes", "[]")
    prices_raw = market.get("outcomePrices", "[]")

    try:
        outcomes = json.loads(outcomes_raw) if isinstance(outcomes_raw, str) else outcomes_raw
        prices = json.loads(prices_raw) if isinstance(prices_raw, str) else prices_raw
    except (json.JSONDecodeError, TypeError):
        outcomes = []
        prices = []

    # Build outcome pairs
    pairs = []
    for i in range(len(outcomes)):
        price = float(prices[i]) if i < len(prices) else 0
        pairs.append({
            "outcome": outcomes[i],
            "probability": round(price * 100, 1),
        })

    return {
        "question": market.get("question", ""),
        "slug": market.get("slug", ""),
        "groupTitle": market.get("groupItemTitle", ""),
        "outcomes": pairs,
        "volume": market.get("volumeNum", 0) or float(market.get("volume", "0") or "0"),
        "volume24h": market.get("volume24hr", 0),
        "liquidity": market.get("liquidityNum", 0) or float(market.get("liquidity", "0") or "0"),
        "lastTradePrice": market.get("lastTradePrice", 0),
        "bestBid": market.get("bestBid", 0),
        "bestAsk": market.get("bestAsk", 0),
        "active": market.get("active", False),
        "closed": market.get("closed", False),
    }


def parse_event(event, config):
    """Parse a full event into structured output."""
    markets = event.get("markets", [])

    # Parse all sub-markets
    parsed_markets = []
    for m in markets:
        pm = parse_market(m)
        if pm["active"] and not pm["closed"]:
            parsed_markets.append(pm)

    # Sort by groupTitle (price levels) or volume
    parsed_markets.sort(key=lambda x: x.get("volume", 0), reverse=True)

    return {
        "id": event.get("id"),
        "title": event.get("title", ""),
        "label": config["label"],
        "horizon": config["horizon"],
        "slug": event.get("slug", ""),
        "totalVolume": event.get("volume", 0),
        "volume24h": event.get("volume24hr", 0),
        "liquidity": event.get("liquidity", 0),
        "active": event.get("active", False),
        "markets": parsed_markets,
        "marketCount": len(parsed_markets),
        "url": f"https://polymarket.com/event/{event.get('slug', '')}",
    }


# ─── Main ─────────────────────────────────────────────────────────
def main():
    # Try cache first
    cached = load_cache()
    if cached:
        print("Content-Type: application/json")
        print("Access-Control-Allow-Origin: *")
        print()
        print(json.dumps(cached))
        return

    # Fetch all markets
    results = {"short": [], "mid": [], "long": []}
    errors = []

    for horizon, configs in MARKETS.items():
        for config in configs:
            event = fetch_event(config["slug"])
            if event:
                parsed = parse_event(event, config)
                results[horizon].append(parsed)
            else:
                errors.append(config["slug"])

    payload = {
        "horizons": results,
        "errors": errors,
        "fetched_at": time.time(),
        "fetched_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "market_count": sum(len(v) for v in results.values()),
    }

    save_cache(payload)

    print("Content-Type: application/json")
    print("Access-Control-Allow-Origin: *")
    print()
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
