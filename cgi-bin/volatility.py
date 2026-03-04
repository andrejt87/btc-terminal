#!/usr/bin/env python3
"""
BTC Bloomberg Terminal — Volatility Metrics Proxy
Calculates realized volatility from Binance klines and fetches
implied volatility data from Deribit options API.
Cache: 60s
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

TIMEOUT = 10
USER_AGENT = "BTC-Terminal/1.0 (Volatility Proxy)"
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "volatility_cache.json")
CACHE_TTL = 60  # 60 seconds


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


# ─── Realized Volatility ─────────────────────────────────────────
def calc_realized_vol(closes):
    """
    Calculate annualized realized volatility from a list of closing prices.
    Uses log returns: σ = std(log(P[i]/P[i-1])) * sqrt(trading_periods_per_year)
    """
    if len(closes) < 2:
        return None
    log_returns = []
    for i in range(1, len(closes)):
        if closes[i - 1] > 0 and closes[i] > 0:
            log_returns.append(math.log(closes[i] / closes[i - 1]))

    if len(log_returns) < 2:
        return None

    n = len(log_returns)
    mean = sum(log_returns) / n
    variance = sum((r - mean) ** 2 for r in log_returns) / (n - 1)
    daily_std = math.sqrt(variance)
    # Annualize: sqrt(365) for crypto (trades 365 days/year)
    annualized_vol = daily_std * math.sqrt(365) * 100
    return round(annualized_vol, 2)


def get_realized_vols():
    """Fetch daily klines for 7d, 30d, 90d and compute realized vol."""
    result = {}

    for days, key in [(7, "vol_7d"), (30, "vol_30d"), (90, "vol_90d")]:
        url = (
            f"https://data-api.binance.vision/api/v3/klines"
            f"?symbol=BTCUSDT&interval=1d&limit={days + 1}"
        )
        data = fetch_json(url)
        if data and isinstance(data, list):
            try:
                closes = [float(k[4]) for k in data]
                vol = calc_realized_vol(closes)
                result[key] = vol
            except (TypeError, ValueError, IndexError):
                result[key] = None
        else:
            result[key] = None

    return result


# ─── Deribit IV ───────────────────────────────────────────────────
def get_deribit_index():
    """Get Deribit BTC spot index price."""
    data = fetch_json("https://www.deribit.com/api/v2/public/get_index_price?index_name=btc_usd")
    if not data:
        return None
    result_data = data.get("result", {})
    try:
        return float(result_data.get("index_price", 0))
    except (TypeError, ValueError):
        return None


def get_deribit_options_iv():
    """
    Fetch BTC option book summary from Deribit.
    Returns ATM IV (nearest-to-spot strikes), IV rank proxy, put/call ratio.
    """
    data = fetch_json(
        "https://www.deribit.com/api/v2/public/get_book_summary_by_currency"
        "?currency=BTC&kind=option"
    )
    if not data:
        return None

    instruments = data.get("result", [])
    if not instruments:
        return None

    # Get spot price for ATM detection
    index_price = get_deribit_index()

    ivs = []
    put_volume = 0.0
    call_volume = 0.0
    atm_ivs = []

    for inst in instruments:
        try:
            iv = float(inst.get("mark_iv", 0) or 0)
            volume = float(inst.get("volume", 0) or 0)
            name = inst.get("instrument_name", "")

            if iv <= 0:
                continue

            ivs.append(iv)

            # Count put/call volume
            if "-P" in name:
                put_volume += volume
            elif "-C" in name:
                call_volume += volume

            # Find ATM: parse strike from instrument name (e.g. BTC-28MAR26-70000-C)
            if index_price and index_price > 0:
                parts = name.split("-")
                if len(parts) >= 3:
                    try:
                        strike = float(parts[2])
                        # Consider "ATM" if within 5% of current index
                        if abs(strike - index_price) / index_price < 0.05:
                            atm_ivs.append(iv)
                    except (ValueError, IndexError):
                        pass
        except (TypeError, ValueError):
            continue

    if not ivs:
        return None

    # ATM IV: average of near-money options
    atm_iv = round(sum(atm_ivs) / len(atm_ivs), 2) if atm_ivs else round(sum(ivs) / len(ivs), 2)

    # Put/call ratio
    pc_ratio = round(put_volume / call_volume, 4) if call_volume > 0 else None

    # IV Rank: (current_iv - 52w_low) / (52w_high - 52w_low) * 100
    # We can only approximate from the current distribution
    min_iv = min(ivs)
    max_iv = max(ivs)
    iv_rank = None
    if max_iv > min_iv:
        iv_rank = round((atm_iv - min_iv) / (max_iv - min_iv) * 100, 1)

    return {
        "atm_iv": atm_iv,
        "iv_rank": iv_rank,
        "min_iv": round(min_iv, 2),
        "max_iv": round(max_iv, 2),
        "put_call_ratio": pc_ratio,
        "option_count": len(instruments),
    }


# ─── Main ─────────────────────────────────────────────────────────
def main():
    cached = load_cache()
    if cached:
        print("Content-Type: application/json")
        print("Access-Control-Allow-Origin: *")
        print()
        print(json.dumps(cached))
        return

    realized = get_realized_vols()
    deribit_index = get_deribit_index()
    options_iv = get_deribit_options_iv()

    # HV/IV ratio
    hv_iv_ratio = None
    if realized.get("vol_30d") and options_iv and options_iv.get("atm_iv"):
        hv_iv_ratio = round(realized["vol_30d"] / options_iv["atm_iv"], 4)

    payload = {
        "realized": realized,
        "implied": options_iv,
        "hv_iv_ratio": hv_iv_ratio,
        "deribit_index": deribit_index,
        "fetched_at": int(time.time()),
    }

    save_cache(payload)

    print("Content-Type: application/json")
    print("Access-Control-Allow-Origin: *")
    print()
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
