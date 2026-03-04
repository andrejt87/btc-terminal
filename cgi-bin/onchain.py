#!/usr/bin/env python3
"""
BTC Bloomberg Terminal — On-Chain Data Proxy
Fetches Bitcoin mempool, mining, difficulty, and lightning network
statistics from mempool.space public API.
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

TIMEOUT = 8
USER_AGENT = "BTC-Terminal/1.0 (OnChain Proxy)"
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "onchain_cache.json")
CACHE_TTL = 60  # 60 seconds

MEMPOOL_BASE = "https://mempool.space/api"

# Bitcoin halving block intervals
HALVING_INTERVAL = 210000


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


def fetch_json(url):
    try:
        req = Request(url, headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read())
    except Exception:
        return None


# ─── Mempool fees + stats ─────────────────────────────────────────
def get_mempool_data():
    fees = fetch_json(f"{MEMPOOL_BASE}/v1/fees/recommended")
    stats = fetch_json(f"{MEMPOOL_BASE}/mempool")

    result = {}
    if fees:
        result["fee_fast"] = fees.get("fastestFee")
        result["fee_medium"] = fees.get("halfHourFee")
        result["fee_slow"] = fees.get("hourFee")
        result["fee_minimum"] = fees.get("minimumFee")

    if stats:
        result["tx_count"] = stats.get("count")
        vsize = stats.get("vsize", 0)
        result["vsize_mb"] = round(vsize / 1_000_000, 2) if vsize else None
        total_fee_sat = stats.get("total_fee", 0)
        result["total_fee_btc"] = round(total_fee_sat / 1e8, 6) if total_fee_sat else None

    # Congestion level based on fee / tx count
    if fees:
        fast = fees.get("fastestFee", 0)
        if fast >= 50:
            result["congestion"] = "high"
        elif fast >= 20:
            result["congestion"] = "medium"
        else:
            result["congestion"] = "low"

    return result if result else None


# ─── Mining / blocks ──────────────────────────────────────────────
def get_mining_data():
    result = {}

    # Latest blocks (for height + timestamp)
    blocks = fetch_json(f"{MEMPOOL_BASE}/v1/blocks")
    if blocks and isinstance(blocks, list) and len(blocks) > 0:
        latest = blocks[0]
        result["latest_block_height"] = latest.get("height")
        result["latest_block_time"] = latest.get("timestamp")

    # Hashrate (1m window)
    hashrate_data = fetch_json(f"{MEMPOOL_BASE}/v1/mining/hashrate/1m")
    if hashrate_data:
        # currentHashrate is in H/s, convert to EH/s
        current_hr = hashrate_data.get("currentHashrate", 0)
        if current_hr:
            result["hashrate_eh"] = round(current_hr / 1e18, 2)
        current_diff = hashrate_data.get("currentDifficulty", 0)
        if current_diff:
            result["difficulty"] = current_diff

    # Difficulty adjustment
    diff_data = fetch_json(f"{MEMPOOL_BASE}/v1/difficulty-adjustment")
    if diff_data:
        result["next_adjustment_pct"] = round(diff_data.get("difficultyChange", 0), 2)
        result["next_adjustment_blocks"] = diff_data.get("remainingBlocks")
        result["estimated_retarget_date"] = diff_data.get("estimatedRetargetDate")
        result["previous_retarget"] = diff_data.get("previousRetarget")

    # Blocks until halving
    height = result.get("latest_block_height")
    if height is not None:
        next_halving = ((height // HALVING_INTERVAL) + 1) * HALVING_INTERVAL
        result["blocks_until_halving"] = next_halving - height
        result["next_halving_block"] = next_halving

    return result if result else None


# ─── Lightning network ────────────────────────────────────────────
def get_lightning_data():
    data = fetch_json(f"{MEMPOOL_BASE}/v1/lightning/statistics/latest")
    if not data:
        return None
    try:
        latest = data.get("latest", data)  # API may wrap in "latest" key
        capacity_sat = latest.get("total_capacity", 0)
        capacity_btc = round(capacity_sat / 1e8, 2) if capacity_sat else None
        return {
            "capacity_btc": capacity_btc,
            "channel_count": latest.get("channel_count"),
            "node_count": latest.get("node_count"),
            "tor_node_count": latest.get("tor_nodes"),
            "clearnet_node_count": latest.get("clearnet_nodes"),
            "unannounced_node_count": latest.get("unannounced_nodes"),
        }
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

    mempool = get_mempool_data()
    mining = get_mining_data()
    lightning = get_lightning_data()

    payload = {
        "mempool": mempool,
        "mining": mining,
        "lightning": lightning,
        "fetched_at": int(time.time()),
    }

    save_cache(payload)

    print("Content-Type: application/json")
    print("Access-Control-Allow-Origin: *")
    print()
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
