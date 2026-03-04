#!/usr/bin/env python3
"""
BTC Bloomberg Terminal — Macro Data Proxy
Cross-asset macro data: DXY proxy (via EUR/USD), gold, stablecoin supply,
Fear & Greed Index, and BTC 30-day daily closes.
Cache: 300s (5 minutes)
"""

import sys as _sys
import os as _os
# Prevent cgi-bin/calendar.py from shadowing stdlib calendar module
_cgi_dir = _os.path.dirname(_os.path.abspath(__file__))
for _p in [_cgi_dir]:
    while _p in _sys.path:
        _sys.path.remove(_p)
del _cgi_dir, _os


import json
import os
import time
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

TIMEOUT = 8
USER_AGENT = "BTC-Terminal/1.0 (Macro Proxy)"
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "macro_cache.json")
CACHE_TTL = 300  # 5 minutes


# ─── Cache helpers ────────────────────────────────────────────────
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


def fetch_json(url, headers=None):
    try:
        h = {"User-Agent": USER_AGENT}
        if headers:
            h.update(headers)
        req = Request(url, headers=h)
        with urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read())
    except Exception:
        return None


# ─── DXY Proxy (EUR/USD inverted) ────────────────────────────────
def get_dxy_proxy():
    """
    EUR/USD from Binance (EURUSDT). DXY is roughly 57.6% EUR-weighted.
    Simple estimate: DXY ≈ 103 / (EUR/USD / 1.08) — rough inverse scaling.
    """
    data = fetch_json("https://data-api.binance.vision/api/v3/ticker/24hr?symbol=EURUSDT")
    if not data:
        return None
    try:
        eur_usd = float(data.get("lastPrice", 0))
        change_pct = float(data.get("priceChangePercent", 0))
        if eur_usd == 0:
            return None
        # DXY rough estimate: inverted EUR/USD scaled to ~DXY range
        # When EUR/USD = 1.08, DXY ≈ 103. Approx: DXY = 103 * (1.08 / EUR_USD)
        dxy_est = round(103.0 * (1.08 / eur_usd), 2)
        # DXY change is roughly inverse of EUR/USD change
        dxy_change = round(-change_pct, 3)
        return {
            "eur_usd": round(eur_usd, 5),
            "eur_usd_change_24h": round(change_pct, 3),
            "dxy_est": dxy_est,
            "dxy_change_est": dxy_change,
        }
    except (TypeError, ValueError, ZeroDivisionError):
        return None


# ─── Gold ─────────────────────────────────────────────────────────
def get_gold():
    """Try XAUUSDT on Binance first, fall back to CoinGecko tether-gold."""
    data = fetch_json("https://data-api.binance.vision/api/v3/ticker/24hr?symbol=XAUUSDT")
    if data and data.get("lastPrice"):
        try:
            price = float(data["lastPrice"])
            if price > 100:  # sanity check
                change_pct = float(data.get("priceChangePercent", 0))
                return {
                    "price": round(price, 2),
                    "change_24h": round(change_pct, 3),
                    "source": "binance",
                }
        except (TypeError, ValueError):
            pass

    # Fallback: CoinGecko tether-gold
    cg_data = fetch_json(
        "https://api.coingecko.com/api/v3/simple/price"
        "?ids=tether-gold&vs_currencies=usd&include_24hr_change=true"
    )
    if cg_data and "tether-gold" in cg_data:
        entry = cg_data["tether-gold"]
        try:
            price = float(entry.get("usd", 0))
            change = float(entry.get("usd_24h_change", 0))
            return {
                "price": round(price, 2),
                "change_24h": round(change, 3),
                "source": "coingecko",
            }
        except (TypeError, ValueError):
            pass

    return None


# ─── Stablecoin Supply ────────────────────────────────────────────
def get_stablecoins():
    data = fetch_json(
        "https://api.coingecko.com/api/v3/coins/markets"
        "?vs_currency=usd&ids=tether,usd-coin,dai,first-digital-usd"
        "&order=market_cap_desc&per_page=10&page=1"
    )
    if not data or not isinstance(data, list):
        return None

    result = {}
    total_mcap = 0
    for coin in data:
        try:
            symbol_map = {
                "tether": "tether",
                "usd-coin": "usdc",
                "dai": "dai",
                "first-digital-usd": "fdusd",
            }
            cid = coin.get("id", "")
            key = symbol_map.get(cid, cid)
            mcap = float(coin.get("market_cap", 0) or 0)
            change = float(coin.get("price_change_percentage_24h", 0) or 0)
            total_mcap += mcap
            result[key] = {
                "mcap": round(mcap, 0),
                "change_24h": round(change, 4),
                "price": float(coin.get("current_price", 1)),
            }
        except (TypeError, ValueError):
            continue

    return {"total_mcap": round(total_mcap, 0), **result}


# ─── Fear & Greed Index ───────────────────────────────────────────
def get_fear_greed():
    data = fetch_json("https://api.alternative.me/fng/?limit=2")
    if not data:
        return None
    items = data.get("data", [])
    if not items:
        return None
    try:
        current = items[0]
        result = {
            "value": int(current.get("value", 0)),
            "label": current.get("value_classification", ""),
            "timestamp": int(current.get("timestamp", 0)),
        }
        if len(items) > 1:
            result["yesterday"] = int(items[1].get("value", 0))
            result["yesterday_label"] = items[1].get("value_classification", "")
        return result
    except (TypeError, ValueError):
        return None


# ─── BTC 30-day daily closes ──────────────────────────────────────
def get_btc_30d_daily():
    """Fetch 30 daily BTC closes from Binance klines."""
    url = (
        "https://data-api.binance.vision/api/v3/klines"
        "?symbol=BTCUSDT&interval=1d&limit=30"
    )
    data = fetch_json(url)
    if not data or not isinstance(data, list):
        return None
    try:
        # Kline format: [open_time, open, high, low, close, volume, ...]
        closes = [round(float(k[4]), 2) for k in data]
        return closes
    except (TypeError, ValueError, IndexError):
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

    dxy_proxy = get_dxy_proxy()
    gold = get_gold()
    stablecoins = get_stablecoins()
    fear_greed = get_fear_greed()
    btc_30d_daily = get_btc_30d_daily()

    payload = {
        "dxy_proxy": dxy_proxy,
        "gold": gold,
        "stablecoins": stablecoins,
        "fear_greed": fear_greed,
        "btc_30d_daily": btc_30d_daily,
        "fetched_at": int(time.time()),
    }

    save_cache(payload)

    print("Content-Type: application/json")
    print("Access-Control-Allow-Origin: *")
    print()
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
