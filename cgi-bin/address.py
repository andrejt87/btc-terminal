#!/usr/bin/env python3
"""
BTC Bloomberg Terminal — Bitcoin Address / TX Inspector
Looks up BTC addresses and transaction IDs via mempool.space API.
Accepts query param ?q=ADDRESS_OR_TXID
Cache: 30s per unique query (stored in a single cache file with multiple entries).
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
import re
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from urllib.parse import unquote_plus

TIMEOUT = 8
USER_AGENT = "BTC-Terminal/1.0 (Address Inspector)"
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "address_cache.json")
CACHE_TTL = 30  # 30 seconds
MAX_CACHE_ENTRIES = 100  # prevent unbounded growth

MEMPOOL_BASE = "https://mempool.space/api"


# ─── Cache helpers (keyed by query string) ────────────────────────────
def load_cache(query_key):
    try:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, "r") as f:
                store = json.load(f)
            entry = store.get(query_key)
            if entry and time.time() - entry.get("ts", 0) < CACHE_TTL:
                return entry.get("payload")
    except Exception:
        pass
    return None


def save_cache(query_key, payload):
    try:
        store = {}
        if os.path.exists(CACHE_FILE):
            try:
                with open(CACHE_FILE, "r") as f:
                    store = json.load(f)
            except Exception:
                store = {}

        # Evict oldest entries if too large
        if len(store) >= MAX_CACHE_ENTRIES:
            oldest = sorted(store.items(), key=lambda x: x[1].get("ts", 0))
            for k, _ in oldest[:MAX_CACHE_ENTRIES // 2]:
                del store[k]

        store[query_key] = {"ts": time.time(), "payload": payload}
        with open(CACHE_FILE, "w") as f:
            json.dump(store, f)
    except Exception:
        pass


def fetch_json(url):
    try:
        req = Request(url, headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read())
    except Exception:
        return None


# ─── Query type detection ───────────────────────────────────────────
def looks_like_txid(s):
    """A txid is a 64-character hex string."""
    return bool(re.fullmatch(r"[0-9a-fA-F]{64}", s))


def looks_like_address(s):
    """
    Bitcoin address patterns:
    - Legacy P2PKH: starts with 1, 25-34 chars
    - P2SH: starts with 3, 25-34 chars
    - Bech32 (P2WPKH/P2WSH): starts with bc1, 14-74 chars
    - Taproot (P2TR): starts with bc1p, 62 chars
    """
    return bool(
        re.fullmatch(r"[13][a-km-zA-HJ-NP-Z1-9]{25,33}", s)
        or re.fullmatch(r"bc1[a-z0-9]{6,87}", s, re.IGNORECASE)
    )


# ─── Address lookup ───────────────────────────────────────────────
def lookup_address(addr):
    addr_data = fetch_json(f"{MEMPOOL_BASE}/address/{addr}")
    txs_data = fetch_json(f"{MEMPOOL_BASE}/address/{addr}/txs")

    result = {
        "type": "address",
        "address": addr,
        "balance_btc": None,
        "balance_sat": None,
        "total_received_sat": None,
        "total_sent_sat": None,
        "tx_count": None,
        "unconfirmed_tx_count": None,
        "unconfirmed_balance_sat": None,
        "recent_txs": [],
        "error": None,
    }

    if addr_data:
        chain = addr_data.get("chain_stats", {})
        mempool = addr_data.get("mempool_stats", {})

        funded = chain.get("funded_txo_sum", 0)
        spent = chain.get("spent_txo_sum", 0)
        balance_sat = funded - spent
        unconf_funded = mempool.get("funded_txo_sum", 0)
        unconf_spent = mempool.get("spent_txo_sum", 0)
        unconf_balance = unconf_funded - unconf_spent

        result["balance_sat"] = balance_sat
        result["balance_btc"] = round(balance_sat / 1e8, 8)
        result["total_received_sat"] = funded
        result["total_sent_sat"] = spent
        result["tx_count"] = chain.get("tx_count")
        result["unconfirmed_tx_count"] = mempool.get("tx_count")
        result["unconfirmed_balance_sat"] = unconf_balance
        result["mempool_url"] = f"https://mempool.space/address/{addr}"
    else:
        result["error"] = "Address not found or API unavailable"

    if txs_data and isinstance(txs_data, list):
        for tx in txs_data[:10]:  # limit to 10 most recent
            tx_status = tx.get("status", {})
            confirmed = tx_status.get("confirmed", False)
            block_height = tx_status.get("block_height")
            block_time = tx_status.get("block_time")

            # Calculate value sent to/from this address
            out_value = sum(
                vout.get("value", 0)
                for vout in tx.get("vout", [])
                if vout.get("scriptpubkey_address") == addr
            )

            result["recent_txs"].append({
                "txid": tx.get("txid"),
                "confirmed": confirmed,
                "block_height": block_height,
                "block_time": block_time,
                "fee": tx.get("fee"),
                "size": tx.get("size"),
                "weight": tx.get("weight"),
                "value_to_addr_sat": out_value,
                "vin_count": len(tx.get("vin", [])),
                "vout_count": len(tx.get("vout", [])),
            })

    return result


# ─── Transaction lookup ─────────────────────────────────────────────
def lookup_tx(txid):
    tx_data = fetch_json(f"{MEMPOOL_BASE}/tx/{txid}")

    result = {
        "type": "transaction",
        "txid": txid,
        "confirmed": None,
        "block_height": None,
        "block_time": None,
        "block_hash": None,
        "fee": None,
        "fee_rate": None,
        "size": None,
        "weight": None,
        "locktime": None,
        "version": None,
        "vin": [],
        "vout": [],
        "total_output_sat": None,
        "mempool_url": f"https://mempool.space/tx/{txid}",
        "error": None,
    }

    if not tx_data:
        result["error"] = "Transaction not found or API unavailable"
        return result

    status = tx_data.get("status", {})
    result["confirmed"] = status.get("confirmed", False)
    result["block_height"] = status.get("block_height")
    result["block_time"] = status.get("block_time")
    result["block_hash"] = status.get("block_hash")
    result["fee"] = tx_data.get("fee")
    result["size"] = tx_data.get("size")
    result["weight"] = tx_data.get("weight")
    result["locktime"] = tx_data.get("locktime")
    result["version"] = tx_data.get("version")

    # Fee rate (sat/vbyte)
    if result["fee"] and result["weight"] and result["weight"] > 0:
        vsize = result["weight"] / 4.0
        result["fee_rate"] = round(result["fee"] / vsize, 2)

    # Inputs (abbreviated)
    for vin in tx_data.get("vin", []):
        prevout = vin.get("prevout", {})
        result["vin"].append({
            "txid": vin.get("txid"),
            "vout": vin.get("vout"),
            "address": prevout.get("scriptpubkey_address"),
            "value_sat": prevout.get("value"),
            "is_coinbase": vin.get("is_coinbase", False),
        })

    # Outputs
    total_out = 0
    for vout in tx_data.get("vout", []):
        val = vout.get("value", 0)
        total_out += val
        result["vout"].append({
            "address": vout.get("scriptpubkey_address"),
            "value_sat": val,
            "value_btc": round(val / 1e8, 8),
            "script_type": vout.get("scriptpubkey_type"),
        })

    result["total_output_sat"] = total_out
    result["total_output_btc"] = round(total_out / 1e8, 8)

    # Limit to 20 inputs/outputs to avoid huge response
    result["vin"] = result["vin"][:20]
    result["vout"] = result["vout"][:20]
    result["vin_count"] = len(tx_data.get("vin", []))
    result["vout_count"] = len(tx_data.get("vout", []))

    return result


# ─── Main ─────────────────────────────────────────────────────────
def main():
    query_string = os.environ.get("QUERY_STRING", "")
    params = {}
    if query_string:
        for pair in query_string.split("&"):
            if "=" in pair:
                k, v = pair.split("=", 1)
                params[k] = unquote_plus(v)

    q = params.get("q", "").strip()

    if not q:
        payload = {
            "error": "Missing query parameter: ?q=ADDRESS_OR_TXID",
            "examples": [
                "?q=bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
                "?q=a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d",
            ],
        }
        print("Content-Type: application/json")
        print("Access-Control-Allow-Origin: *")
        print()
        print(json.dumps(payload))
        return

    # Try cache
    cached = load_cache(q)
    if cached:
        print("Content-Type: application/json")
        print("Access-Control-Allow-Origin: *")
        print()
        print(json.dumps(cached))
        return

    # Determine type and dispatch
    if looks_like_txid(q):
        payload = lookup_tx(q)
    elif looks_like_address(q):
        payload = lookup_address(q)
    else:
        payload = {
            "error": f"Could not determine if '{q}' is a BTC address or txid",
            "hint": "Addresses start with 1, 3, or bc1. TXIDs are 64 hex characters.",
            "query": q,
        }

    payload["fetched_at"] = int(time.time())

    save_cache(q, payload)

    print("Content-Type: application/json")
    print("Access-Control-Allow-Origin: *")
    print()
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
