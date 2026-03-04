#!/usr/bin/env python3
"""
BTC Bloomberg Terminal — Derivatives Data Proxy
Aggregates funding rates, open interest, basis, liquidations,
and long/short ratio from OKX, Deribit, and CoinGecko.
Cache: 30s
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
import math
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

TIMEOUT = 8
USER_AGENT = "BTC-Terminal/1.0 (Derivatives Proxy)"
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "derivatives_cache.json")
CACHE_TTL = 30  # 30 seconds


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
    """Fetch URL and return parsed JSON, or None on failure."""
    try:
        h = {"User-Agent": USER_AGENT}
        if headers:
            h.update(headers)
        req = Request(url, headers=h)
        with urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read())
    except Exception:
        return None


# ─── Spot price (Binance Vision — geo-unrestricted) ───────────────
def get_spot_price():
    data = fetch_json("https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT")
    if data and "price" in data:
        try:
            return float(data["price"])
        except (TypeError, ValueError):
            pass
    return None


# ─── Funding Rates ────────────────────────────────────────────────
def get_okx_funding():
    """OKX BTC-USDT-SWAP funding rate."""
    data = fetch_json("https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP")
    if not data:
        return None
    items = data.get("data", [])
    if not items:
        return None
    try:
        rate = float(items[0].get("fundingRate", 0))
        next_time_ms = int(items[0].get("nextFundingTime", 0))
        annualized = rate * 3 * 365 * 100  # 3x per day * 365 days
        return {
            "rate": rate,
            "annualized": round(annualized, 4),
            "next_time": next_time_ms // 1000 if next_time_ms else None,
        }
    except (TypeError, ValueError):
        return None


def get_deribit_funding():
    """Deribit BTC-PERPETUAL 8h funding rate."""
    data = fetch_json("https://www.deribit.com/api/v2/public/ticker?instrument_name=BTC-PERPETUAL")
    if not data:
        return None
    result = data.get("result", {})
    try:
        rate_8h = float(result.get("funding_8h", 0) or 0)
        # Annualize: 3 periods per day * 365
        annualized = rate_8h * 3 * 365 * 100
        mark_price = float(result.get("mark_price", 0) or 0)
        return {
            "rate": rate_8h,
            "annualized": round(annualized, 4),
            "mark_price": round(mark_price, 2),
        }
    except (TypeError, ValueError):
        return None


def get_coingecko_derivatives():
    """
    CoinGecko derivatives endpoint — returns multi-exchange funding rates and OI.
    We parse Binance Futures, Bybit, and average them.
    """
    data = fetch_json("https://api.coingecko.com/api/v3/derivatives?include_tickers=unexpired")
    if not data or not isinstance(data, list):
        return None

    # Filter to BTC perpetuals
    btc_perps = [
        d for d in data
        if d.get("symbol") == "BTCUSDT"
        and d.get("contract_type") == "perpetual"
        and d.get("funding_rate") is not None
    ]

    result = {}
    for d in btc_perps:
        market = d.get("market", "")
        try:
            fr = float(d.get("funding_rate", 0) or 0) / 100  # CoinGecko returns percentage
            oi = float(d.get("open_interest", 0) or 0)
        except (TypeError, ValueError):
            continue

        if "Binance" in market:
            result["binance"] = {
                "rate": fr,
                "annualized": round(fr * 3 * 365 * 100, 4),
                "oi_usd": round(oi, 2),
                "basis_pct": round(float(d.get("basis", 0) or 0), 4),
            }
        elif "Bybit" in market:
            result["bybit"] = {
                "rate": fr,
                "annualized": round(fr * 3 * 365 * 100, 4),
                "oi_usd": round(oi, 2),
            }

    return result if result else None


# ─── Open Interest ────────────────────────────────────────────────
def get_okx_oi():
    """OKX BTC-USDT-SWAP open interest."""
    data = fetch_json("https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instFamily=BTC-USDT")
    if not data:
        return None
    items = data.get("data", [])
    if not items:
        return None
    try:
        item = items[0]
        oi_usd = float(item.get("oiUsd", 0) or 0)
        oi_ccy = float(item.get("oiCcy", 0) or 0)
        return {"btc": round(oi_ccy, 2), "usd": round(oi_usd, 2)}
    except (TypeError, ValueError):
        return None


def get_deribit_oi():
    """Deribit BTC-PERPETUAL open interest (returned in USD)."""
    data = fetch_json("https://www.deribit.com/api/v2/public/ticker?instrument_name=BTC-PERPETUAL")
    if not data:
        return None
    result = data.get("result", {})
    try:
        oi_usd = float(result.get("open_interest", 0) or 0)
        return {"usd": round(oi_usd, 2)}
    except (TypeError, ValueError):
        return None


# ─── Basis (Spot vs Perp) ────────────────────────────────────────
def get_basis(spot_price):
    """Calculate basis from Deribit BTC-PERPETUAL mark price vs spot."""
    if not spot_price:
        return None
    data = fetch_json("https://www.deribit.com/api/v2/public/ticker?instrument_name=BTC-PERPETUAL")
    if not data:
        return None
    result = data.get("result", {})
    try:
        mark = float(result.get("mark_price", 0) or 0)
        if mark == 0 or spot_price == 0:
            return None
        basis_pct = (mark - spot_price) / spot_price * 100
        # Annualized rough estimate (perp, not dated futures)
        annualized_basis = basis_pct * 365 * 3
        return {
            "spot": round(spot_price, 2),
            "mark": round(mark, 2),
            "basis_pct": round(basis_pct, 4),
            "annualized_basis": round(annualized_basis, 4),
        }
    except (TypeError, ValueError, ZeroDivisionError):
        return None


# ─── Liquidations ─────────────────────────────────────────────────
def get_okx_liquidations():
    """OKX BTC-USDT-SWAP recent liquidations."""
    data = fetch_json(
        "https://www.okx.com/api/v5/public/liquidation-orders"
        "?instType=SWAP&instFamily=BTC-USDT&state=filled&limit=100"
    )
    if not data:
        return None
    items = data.get("data", [])
    if not items:
        return None

    long_usd = 0.0
    short_usd = 0.0
    count = 0

    for order in items:
        details = order.get("details", [])
        for d in details:
            try:
                sz = float(d.get("sz", 0) or 0)
                bk_px = float(d.get("bkPx", 0) or 0)
                usd_val = sz * bk_px
                pos_side = d.get("posSide", "")
                # long position being liquidated
                if pos_side == "long":
                    long_usd += usd_val
                elif pos_side == "short":
                    short_usd += usd_val
                count += 1
            except (TypeError, ValueError):
                continue

    return {
        "long_usd": round(long_usd, 2),
        "short_usd": round(short_usd, 2),
        "total_usd": round(long_usd + short_usd, 2),
        "count": count,
        "note": "Recent liquidation orders from OKX (last 100 records)"
    }


# ─── Long/Short Ratio ─────────────────────────────────────────────
def get_long_short_ratio():
    """OKX long/short account ratio for BTC-USDT perpetual."""
    data = fetch_json(
        "https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio-contract"
        "?instId=BTC-USDT-SWAP&period=1H&limit=1"
    )
    if not data:
        return None
    items = data.get("data", [])
    if not items or not isinstance(items[0], list):
        return None
    try:
        # Format: [timestamp, longShortRatio]
        ratio = float(items[0][1])
        # Derive long/short percentages from ratio
        long_pct = ratio / (1 + ratio) * 100
        short_pct = 100 - long_pct
        return {
            "ratio": round(ratio, 4),
            "long_pct": round(long_pct, 2),
            "short_pct": round(short_pct, 2),
            "source": "okx",
        }
    except (TypeError, ValueError, IndexError, ZeroDivisionError):
        return None


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

    # Gather data
    spot_price = get_spot_price()
    okx_funding = get_okx_funding()
    deribit_funding = get_deribit_funding()
    cg_derivs = get_coingecko_derivatives()
    okx_oi = get_okx_oi()
    deribit_oi = get_deribit_oi()
    basis = get_basis(spot_price)
    liquidations = get_okx_liquidations()
    ls_ratio = get_long_short_ratio()

    # Extract per-exchange funding from CoinGecko
    binance_funding = None
    bybit_funding = None
    if cg_derivs:
        if "binance" in cg_derivs:
            binance_funding = {
                "rate": cg_derivs["binance"]["rate"],
                "annualized": cg_derivs["binance"]["annualized"],
            }
        if "bybit" in cg_derivs:
            bybit_funding = {"rate": cg_derivs["bybit"]["rate"]}

    # Average funding rate across exchanges
    rates = []
    for src in [okx_funding, deribit_funding, binance_funding, bybit_funding]:
        if src and src.get("rate") is not None:
            rates.append(src["rate"])
    avg_rate = round(sum(rates) / len(rates), 8) if rates else None

    # Total OI across exchanges
    oi_parts = []
    binance_oi_usd = cg_derivs["binance"]["oi_usd"] if cg_derivs and "binance" in cg_derivs else None
    bybit_oi_usd = cg_derivs["bybit"]["oi_usd"] if cg_derivs and "bybit" in cg_derivs else None
    for v in [okx_oi, deribit_oi, binance_oi_usd, bybit_oi_usd]:
        val = v if isinstance(v, (int, float)) else (v.get("usd") if isinstance(v, dict) else None)
        if val:
            oi_parts.append(val)
    total_oi_usd = round(sum(oi_parts), 2) if oi_parts else None

    payload = {
        "funding": {
            "binance": binance_funding,
            "bybit": bybit_funding,
            "okx": okx_funding,
            "deribit": {
                "rate": deribit_funding["rate"],
                "annualized": deribit_funding["annualized"],
            } if deribit_funding else None,
            "avg": avg_rate,
        },
        "open_interest": {
            "okx": okx_oi,
            "deribit": deribit_oi,
            "binance": {"usd": binance_oi_usd} if binance_oi_usd else None,
            "bybit": {"usd": bybit_oi_usd} if bybit_oi_usd else None,
            "total_usd": total_oi_usd,
        },
        "basis": basis,
        "liquidations_24h": liquidations,
        "long_short_ratio": ls_ratio,
        "fetched_at": int(time.time()),
    }

    save_cache(payload)

    print("Content-Type: application/json")
    print("Access-Control-Allow-Origin: *")
    print()
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
