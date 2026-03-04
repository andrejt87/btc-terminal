#!/usr/bin/env python3
"""
BTC Bloomberg Terminal — Economic & Crypto Event Calendar
Combines hardcoded 2026 macro events (FOMC, CPI, NFP) with
known crypto events. Cache: 3600s (1 hour).
"""

import sys
import os

# Remove script's own directory from sys.path to avoid shadowing stdlib 'calendar' module
_this_dir = os.path.dirname(os.path.abspath(__file__))
for _p in [_this_dir, "", "."]:
    while _p in sys.path:
        sys.path.remove(_p)

import json
import time
from urllib.request import urlopen, Request

TIMEOUT = 8
USER_AGENT = "BTC-Terminal/1.0 (Calendar Proxy)"
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "calendar_cache.json")
CACHE_TTL = 3600  # 1 hour


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


# ─── Static 2026 Event Calendar ──────────────────────────────────
# Sources: Fed calendar, BLS schedule, known crypto milestones
STATIC_EVENTS = [
    # ── FOMC Meetings 2026 ──
    {
        "date": "2026-01-28",
        "title": "FOMC Rate Decision",
        "category": "macro",
        "subcategory": "fomc",
        "impact": "high",
        "description": "Federal Reserve interest rate decision and statement",
        "source": "Federal Reserve",
    },
    {
        "date": "2026-03-18",
        "title": "FOMC Rate Decision",
        "category": "macro",
        "subcategory": "fomc",
        "impact": "high",
        "description": "Federal Reserve interest rate decision + press conference",
        "source": "Federal Reserve",
    },
    {
        "date": "2026-05-06",
        "title": "FOMC Rate Decision",
        "category": "macro",
        "subcategory": "fomc",
        "impact": "high",
        "description": "Federal Reserve interest rate decision and statement",
        "source": "Federal Reserve",
    },
    {
        "date": "2026-06-17",
        "title": "FOMC Rate Decision",
        "category": "macro",
        "subcategory": "fomc",
        "impact": "high",
        "description": "Federal Reserve interest rate decision + press conference",
        "source": "Federal Reserve",
    },
    {
        "date": "2026-07-29",
        "title": "FOMC Rate Decision",
        "category": "macro",
        "subcategory": "fomc",
        "impact": "high",
        "description": "Federal Reserve interest rate decision and statement",
        "source": "Federal Reserve",
    },
    {
        "date": "2026-09-16",
        "title": "FOMC Rate Decision",
        "category": "macro",
        "subcategory": "fomc",
        "impact": "high",
        "description": "Federal Reserve interest rate decision + press conference",
        "source": "Federal Reserve",
    },
    {
        "date": "2026-11-04",
        "title": "FOMC Rate Decision",
        "category": "macro",
        "subcategory": "fomc",
        "impact": "high",
        "description": "Federal Reserve interest rate decision and statement",
        "source": "Federal Reserve",
    },
    {
        "date": "2026-12-16",
        "title": "FOMC Rate Decision",
        "category": "macro",
        "subcategory": "fomc",
        "impact": "high",
        "description": "Federal Reserve interest rate decision + press conference + SEP",
        "source": "Federal Reserve",
    },
    # ── CPI Releases 2026 (BLS — typically 2nd week of month) ──
    {
        "date": "2026-01-14",
        "title": "CPI Inflation Report",
        "category": "macro",
        "subcategory": "cpi",
        "impact": "high",
        "description": "US Consumer Price Index — December 2025 data",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-02-11",
        "title": "CPI Inflation Report",
        "category": "macro",
        "subcategory": "cpi",
        "impact": "high",
        "description": "US Consumer Price Index — January 2026 data",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-03-11",
        "title": "CPI Inflation Report",
        "category": "macro",
        "subcategory": "cpi",
        "impact": "high",
        "description": "US Consumer Price Index — February 2026 data",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-04-10",
        "title": "CPI Inflation Report",
        "category": "macro",
        "subcategory": "cpi",
        "impact": "high",
        "description": "US Consumer Price Index — March 2026 data",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-05-13",
        "title": "CPI Inflation Report",
        "category": "macro",
        "subcategory": "cpi",
        "impact": "high",
        "description": "US Consumer Price Index — April 2026 data",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-06-10",
        "title": "CPI Inflation Report",
        "category": "macro",
        "subcategory": "cpi",
        "impact": "high",
        "description": "US Consumer Price Index — May 2026 data",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-07-15",
        "title": "CPI Inflation Report",
        "category": "macro",
        "subcategory": "cpi",
        "impact": "high",
        "description": "US Consumer Price Index — June 2026 data",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-08-12",
        "title": "CPI Inflation Report",
        "category": "macro",
        "subcategory": "cpi",
        "impact": "high",
        "description": "US Consumer Price Index — July 2026 data",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-09-11",
        "title": "CPI Inflation Report",
        "category": "macro",
        "subcategory": "cpi",
        "impact": "high",
        "description": "US Consumer Price Index — August 2026 data",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-10-14",
        "title": "CPI Inflation Report",
        "category": "macro",
        "subcategory": "cpi",
        "impact": "high",
        "description": "US Consumer Price Index — September 2026 data",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-11-12",
        "title": "CPI Inflation Report",
        "category": "macro",
        "subcategory": "cpi",
        "impact": "high",
        "description": "US Consumer Price Index — October 2026 data",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-12-10",
        "title": "CPI Inflation Report",
        "category": "macro",
        "subcategory": "cpi",
        "impact": "high",
        "description": "US Consumer Price Index — November 2026 data",
        "source": "Bureau of Labor Statistics",
    },
    # ── NFP (Non-Farm Payrolls) 2026 — first Friday of month ──
    {
        "date": "2026-01-09",
        "title": "Non-Farm Payrolls",
        "category": "macro",
        "subcategory": "nfp",
        "impact": "high",
        "description": "US employment report — December 2025",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-02-06",
        "title": "Non-Farm Payrolls",
        "category": "macro",
        "subcategory": "nfp",
        "impact": "high",
        "description": "US employment report — January 2026",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-03-06",
        "title": "Non-Farm Payrolls",
        "category": "macro",
        "subcategory": "nfp",
        "impact": "high",
        "description": "US employment report — February 2026",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-04-03",
        "title": "Non-Farm Payrolls",
        "category": "macro",
        "subcategory": "nfp",
        "impact": "high",
        "description": "US employment report — March 2026",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-05-08",
        "title": "Non-Farm Payrolls",
        "category": "macro",
        "subcategory": "nfp",
        "impact": "high",
        "description": "US employment report — April 2026",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-06-05",
        "title": "Non-Farm Payrolls",
        "category": "macro",
        "subcategory": "nfp",
        "impact": "high",
        "description": "US employment report — May 2026",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-07-10",
        "title": "Non-Farm Payrolls",
        "category": "macro",
        "subcategory": "nfp",
        "impact": "high",
        "description": "US employment report — June 2026",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-08-07",
        "title": "Non-Farm Payrolls",
        "category": "macro",
        "subcategory": "nfp",
        "impact": "high",
        "description": "US employment report — July 2026",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-09-04",
        "title": "Non-Farm Payrolls",
        "category": "macro",
        "subcategory": "nfp",
        "impact": "high",
        "description": "US employment report — August 2026",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-10-02",
        "title": "Non-Farm Payrolls",
        "category": "macro",
        "subcategory": "nfp",
        "impact": "high",
        "description": "US employment report — September 2026",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-11-06",
        "title": "Non-Farm Payrolls",
        "category": "macro",
        "subcategory": "nfp",
        "impact": "high",
        "description": "US employment report — October 2026",
        "source": "Bureau of Labor Statistics",
    },
    {
        "date": "2026-12-04",
        "title": "Non-Farm Payrolls",
        "category": "macro",
        "subcategory": "nfp",
        "impact": "high",
        "description": "US employment report — November 2026",
        "source": "Bureau of Labor Statistics",
    },
    # ── GDP Releases 2026 (advance estimate — last week of month) ──
    {
        "date": "2026-01-29",
        "title": "GDP Q4 2025 Advance Estimate",
        "category": "macro",
        "subcategory": "gdp",
        "impact": "high",
        "description": "US GDP advance estimate for Q4 2025",
        "source": "BEA",
    },
    {
        "date": "2026-04-30",
        "title": "GDP Q1 2026 Advance Estimate",
        "category": "macro",
        "subcategory": "gdp",
        "impact": "high",
        "description": "US GDP advance estimate for Q1 2026",
        "source": "BEA",
    },
    {
        "date": "2026-07-30",
        "title": "GDP Q2 2026 Advance Estimate",
        "category": "macro",
        "subcategory": "gdp",
        "impact": "high",
        "description": "US GDP advance estimate for Q2 2026",
        "source": "BEA",
    },
    {
        "date": "2026-10-29",
        "title": "GDP Q3 2026 Advance Estimate",
        "category": "macro",
        "subcategory": "gdp",
        "impact": "high",
        "description": "US GDP advance estimate for Q3 2026",
        "source": "BEA",
    },
    # ── Crypto Events ──
    {
        "date": "2026-03-31",
        "title": "Ethereum Pectra Upgrade (est.)",
        "category": "crypto",
        "subcategory": "protocol",
        "impact": "medium",
        "description": "Ethereum protocol upgrade — account abstraction and staking improvements",
        "source": "Ethereum Foundation",
    },
    {
        "date": "2026-05-29",
        "title": "BTC Options Expiry (Deribit — May)",
        "category": "crypto",
        "subcategory": "options",
        "impact": "medium",
        "description": "Monthly Bitcoin options expiry on Deribit — large open interest event",
        "source": "Deribit",
    },
    {
        "date": "2026-06-26",
        "title": "BTC Options Expiry (Deribit — June)",
        "category": "crypto",
        "subcategory": "options",
        "impact": "medium",
        "description": "Monthly Bitcoin options expiry on Deribit",
        "source": "Deribit",
    },
    {
        "date": "2026-06-26",
        "title": "BTC Quarterly Options Expiry (Q2 2026)",
        "category": "crypto",
        "subcategory": "options",
        "impact": "high",
        "description": "Quarterly Bitcoin options/futures expiry — high OI rollover",
        "source": "Deribit / CME",
    },
    {
        "date": "2026-09-25",
        "title": "BTC Quarterly Options Expiry (Q3 2026)",
        "category": "crypto",
        "subcategory": "options",
        "impact": "high",
        "description": "Quarterly Bitcoin options/futures expiry — high OI rollover",
        "source": "Deribit / CME",
    },
    {
        "date": "2026-12-25",
        "title": "BTC Quarterly Options Expiry (Q4 2026)",
        "category": "crypto",
        "subcategory": "options",
        "impact": "high",
        "description": "Quarterly Bitcoin options/futures expiry — high OI rollover",
        "source": "Deribit / CME",
    },
    {
        "date": "2026-01-15",
        "title": "Bitcoin ETF Options Expiry (Jan)",
        "category": "etf",
        "subcategory": "options",
        "impact": "medium",
        "description": "Monthly expiry for BTC spot ETF options (BlackRock IBIT, etc.)",
        "source": "CBOE / Nasdaq",
    },
    {
        "date": "2026-02-20",
        "title": "Bitcoin ETF Options Expiry (Feb)",
        "category": "etf",
        "subcategory": "options",
        "impact": "medium",
        "description": "Monthly expiry for BTC spot ETF options",
        "source": "CBOE / Nasdaq",
    },
    {
        "date": "2026-03-20",
        "title": "Bitcoin ETF Options Expiry (Mar)",
        "category": "etf",
        "subcategory": "options",
        "impact": "medium",
        "description": "Monthly expiry for BTC spot ETF options",
        "source": "CBOE / Nasdaq",
    },
    {
        "date": "2026-04-17",
        "title": "Bitcoin ETF Options Expiry (Apr)",
        "category": "etf",
        "subcategory": "options",
        "impact": "medium",
        "description": "Monthly expiry for BTC spot ETF options",
        "source": "CBOE / Nasdaq",
    },
    {
        "date": "2028-04-20",
        "title": "Bitcoin Halving #5",
        "category": "crypto",
        "subcategory": "halving",
        "impact": "high",
        "description": "Bitcoin block reward halves from 3.125 to 1.5625 BTC (~block 1,050,000)",
        "source": "Bitcoin Protocol",
    },
    {
        "date": "2026-04-15",
        "title": "US Tax Day 2026",
        "category": "macro",
        "subcategory": "fiscal",
        "impact": "medium",
        "description": "US federal income tax filing deadline — historically causes crypto selling",
        "source": "IRS",
    },
    {
        "date": "2026-03-20",
        "title": "Jackson Hole Fed Symposium (est.)",
        "category": "macro",
        "subcategory": "fed",
        "impact": "high",
        "description": "Annual Federal Reserve economic symposium — Fed Chair speech",
        "source": "Kansas City Fed",
    },
    {
        "date": "2026-08-27",
        "title": "Jackson Hole Fed Symposium (est.)",
        "category": "macro",
        "subcategory": "fed",
        "impact": "high",
        "description": "Annual Federal Reserve economic symposium — potential policy signals",
        "source": "Kansas City Fed",
    },
]


# ─── Date-to-timestamp ────────────────────────────────────────────
def date_to_ts(date_str):
    """Convert YYYY-MM-DD string to UTC Unix timestamp (noon)."""
    try:
        import time as _time
        t = _time.strptime(date_str + " 12:00:00", "%Y-%m-%d %H:%M:%S")
        return int(_time.mktime(t))
    except Exception:
        return 0


# ─── Main ─────────────────────────────────────────────────────────
def main():
    import os as _os
    query = _os.environ.get("QUERY_STRING", "")
    params = {}
    if query:
        for pair in query.split("&"):
            if "=" in pair:
                k, v = pair.split("=", 1)
                params[k] = v

    category_filter = params.get("category", "").lower()
    upcoming_only = params.get("upcoming", "0") == "1"
    limit = int(params.get("limit", 100))

    cached = load_cache()
    if cached:
        events = cached.get("events", [])
        # Apply filters at serving time (not cached)
        now_ts = int(time.time())
        if upcoming_only:
            events = [e for e in events if e.get("timestamp", 0) >= now_ts]
        if category_filter:
            events = [e for e in events if e.get("category", "") == category_filter]
        events = events[:limit]
        out = dict(cached)
        out["events"] = events
        print("Content-Type: application/json")
        print("Access-Control-Allow-Origin: *")
        print()
        print(json.dumps(out))
        return

    # Build events with timestamps
    now_ts = int(time.time())
    events = []
    for ev in STATIC_EVENTS:
        e = dict(ev)
        e["timestamp"] = date_to_ts(ev["date"])
        e["is_past"] = e["timestamp"] < now_ts
        events.append(e)

    # Sort by date ascending
    events.sort(key=lambda x: x["timestamp"])

    payload = {
        "events": events,
        "total": len(events),
        "upcoming_count": sum(1 for e in events if not e.get("is_past")),
        "categories": sorted(set(e["category"] for e in events)),
        "fetched_at": int(time.time()),
    }

    save_cache(payload)

    # Apply request-time filters
    out_events = payload["events"]
    if upcoming_only:
        out_events = [e for e in out_events if not e.get("is_past")]
    if category_filter:
        out_events = [e for e in out_events if e.get("category", "") == category_filter]
    out_events = out_events[:limit]

    out = dict(payload)
    out["events"] = out_events

    print("Content-Type: application/json")
    print("Access-Control-Allow-Origin: *")
    print()
    print(json.dumps(out))


if __name__ == "__main__":
    main()
