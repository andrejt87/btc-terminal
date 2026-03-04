#!/usr/bin/env python3
"""
BTC Bloomberg Terminal — Macro Data Proxy
Cross-asset macro data: DXY proxy, Gold, S&P500, Stablecoin dominance,
Fear & Greed Index, USDC/USDT market caps, BTC dominance.
Cache: 5 minutes
"""

import json
import os
import time
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

TIMEOUT = 8
USER_AGENT = "BTC-Terminal/1.0 (Macro Proxy)"
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "macro_cache.json")
CACHE_TTL = 300  # 5 minutes


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


# ─── Fear & Greed ─────────────────────────────────────────────────
def get_fear_greed():
    data = fetch_json("https://api.alternative.me/fng/?limit=7&format=json")
    if not data:
        return None
    try:
        entries = data.get("data", [])
        if not entries:
            return None
        current = entries[0]
        history = []
        for e in entries[1:8]:
            history.append({
                "value": int(e.get("value", 0)),
                "label": e.get("value_classification", ""),
                "ts": int(e.get("timestamp", 0)),
            })
        return {
            "value": int(current.get("value", 0)),
            "label": current.get("value_classification", ""),
            "ts": int(current.get("timestamp", 0)),
            "history": history,
        }
    except Exception:
        return None


# ─── CoinGecko Global ─────────────────────────────────────────────
def get_coingecko_global():
    data = fetch_json("https://api.coingecko.com/api/v3/global")
    if not data:
        return None
    try:
        d = data.get("data", {})
        market_cap = d.get("total_market_cap", {})
        volume_24h = d.get("total_volume", {})
        dominance = d.get("market_cap_percentage", {})
        return {
            "total_market_cap_usd": market_cap.get("usd"),
            "total_volume_24h_usd": volume_24h.get("usd"),
            "btc_dominance": round(dominance.get("btc", 0), 2),
            "eth_dominance": round(dominance.get("eth", 0), 2),
            "active_cryptos": d.get("active_cryptocurrencies"),
            "market_cap_change_24h": round(d.get("market_cap_change_percentage_24h_usd", 0), 2),
        }
    except Exception:
        return None


# ─── Stablecoin data from CoinGecko ──────────────────────────────
def get_stablecoins():
    # Fetch top stablecoins by market cap
    url = ("https://api.coingecko.com/api/v3/coins/markets"
           "?vs_currency=usd&category=stablecoins&order=market_cap_desc&per_page=5")
    data = fetch_json(url)
    if not data or not isinstance(data, list):
        return None
    try:
        coins = []
        for c in data[:5]:
            coins.append({
                "id": c.get("id"),
                "symbol": c.get("symbol", "").upper(),
                "name": c.get("name"),
                "market_cap": c.get("market_cap"),
                "price": c.get("current_price"),
                "price_change_24h": round(c.get("price_change_percentage_24h") or 0, 4),
            })
        total_stable_cap = sum(c["market_cap"] or 0 for c in coins)
        return {
            "coins": coins,
            "total_top5_market_cap": total_stable_cap,
        }
    except Exception:
        return None


# ─── Cross-asset prices via CoinGecko (no auth needed) ────────────
def get_cross_asset():
    """
    Use CoinGecko to get proxies for:
    - Gold (paxg as gold-linked token proxy)
    - S&P 500 (not directly available — skip or use wrapped)
    - DXY (not directly available on free CG)
    We get: Gold via PAXG, ETH/BTC ratio, BTC/USD, ETH/USD.
    """
    ids = "pax-gold,bitcoin,ethereum,wrapped-bitcoin"
    url = f"https://api.coingecko.com/api/v3/simple/price?ids={ids}&vs_currencies=usd&include_24hr_change=true"
    data = fetch_json(url)
    if not data:
        return None
    try:
        result = {}
        if "pax-gold" in data:
            pg = data["pax-gold"]
            result["gold_proxy_price"] = pg.get("usd")
            result["gold_proxy_change_24h"] = round(pg.get("usd_24h_change") or 0, 2)
            result["gold_proxy_symbol"] = "PAXG"
        if "bitcoin" in data:
            btc = data["bitcoin"]
            result["btc_usd"] = btc.get("usd")
            result["btc_change_24h"] = round(btc.get("usd_24h_change") or 0, 2)
        if "ethereum" in data:
            eth = data["ethereum"]
            result["eth_usd"] = eth.get("usd")
            result["eth_change_24h"] = round(eth.get("usd_24h_change") or 0, 2)
        # ETH/BTC ratio
        if result.get("btc_usd") and result.get("eth_usd"):
            result["eth_btc_ratio"] = round(result["eth_usd"] / result["btc_usd"], 6)
        return result
    except Exception:
        return None


# ─── Main ─────────────────────────────────────────────────────────
def main():
    cached = load_cache()
    if cached:
        print("Content-Type: application/json")
        print("Access-Control-Allow-Origin: *")
        print()
        print(json.dumps(cached))
        return

    fear_greed = get_fear_greed()
    global_data = get_coingecko_global()
    stablecoins = get_stablecoins()
    cross_asset = get_cross_asset()

    payload = {
        "fear_greed": fear_greed,
        "global": global_data,
        "stablecoins": stablecoins,
        "cross_asset": cross_asset,
        "fetched_at": int(time.time()),
    }

    save_cache(payload)

    print("Content-Type: application/json")
    print("Access-Control-Allow-Origin: *")
    print()
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
