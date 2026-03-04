#!/usr/bin/env python3
"""
BTC Bloomberg Terminal — Polymarket History API
Serves historical odds data from SQLite for chart rendering.

Endpoints (via query params):
  ?action=markets              — List all tracked markets
  ?action=history&slug=X       — Time series for market slug X (all outcomes)
  ?action=history&slug=X&outcome=Yes  — Time series for specific outcome
  ?action=history&slug=X&hours=24     — Limit to last N hours (default: 24)
  ?action=history&slug=X&hours=168    — Last 7 days
  ?action=status               — Logger status (running, DB size, last entry)
"""

import json
import os
import sys
import sqlite3
import time
from urllib.parse import parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "data")
DB_PATH = os.path.join(DATA_DIR, "pm_history.db")
PID_FILE = os.path.join(DATA_DIR, "pm_logger.pid")


def respond(data, status=200):
    """Output JSON CGI response."""
    print("Content-Type: application/json")
    print("Access-Control-Allow-Origin: *")
    print("Cache-Control: public, max-age=10")
    print()
    print(json.dumps(data))


def get_db():
    """Get read-only DB connection."""
    if not os.path.exists(DB_PATH):
        return None
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def list_markets():
    """Return a list of all tracked markets with latest values."""
    conn = get_db()
    if not conn:
        return respond({"error": "No history database found. Is pm_logger.py running?"})

    c = conn.cursor()
    c.execute("""
        SELECT
            lv.market_slug,
            lv.outcome,
            lv.probability,
            lv.volume,
            lv.liquidity,
            lv.event_slug,
            lv.event_title,
            lv.market_question,
            lv.updated_at,
            (SELECT COUNT(*) FROM odds_log ol WHERE ol.market_slug = lv.market_slug AND ol.outcome = lv.outcome) as data_points,
            (SELECT MIN(ts) FROM odds_log ol WHERE ol.market_slug = lv.market_slug AND ol.outcome = lv.outcome) as first_ts,
            (SELECT MAX(ts) FROM odds_log ol WHERE ol.market_slug = lv.market_slug AND ol.outcome = lv.outcome) as last_ts
        FROM last_values lv
        ORDER BY lv.event_slug, lv.market_slug, lv.outcome
    """)

    markets = {}
    for row in c.fetchall():
        slug = row["market_slug"]
        if slug not in markets:
            markets[slug] = {
                "market_slug": slug,
                "event_slug": row["event_slug"],
                "event_title": row["event_title"],
                "question": row["market_question"],
                "outcomes": [],
                "volume": row["volume"],
                "liquidity": row["liquidity"],
            }
        markets[slug]["outcomes"].append({
            "outcome": row["outcome"],
            "probability": row["probability"],
            "data_points": row["data_points"],
            "first_ts": row["first_ts"],
            "last_ts": row["last_ts"],
        })

    conn.close()
    respond({"markets": list(markets.values()), "count": len(markets)})


def get_history(slug, outcome=None, hours=24):
    """Return time series for a specific market slug."""
    conn = get_db()
    if not conn:
        return respond({"error": "No history database found"})

    c = conn.cursor()
    since_ts = int(time.time()) - (hours * 3600)

    if outcome:
        c.execute("""
            SELECT ts, ts_iso, outcome, probability, volume, liquidity, is_gap_fill
            FROM odds_log
            WHERE market_slug = ? AND outcome = ? AND ts >= ?
            ORDER BY ts ASC
        """, (slug, outcome, since_ts))
    else:
        c.execute("""
            SELECT ts, ts_iso, outcome, probability, volume, liquidity, is_gap_fill
            FROM odds_log
            WHERE market_slug = ? AND ts >= ?
            ORDER BY ts ASC
        """, (slug, since_ts))

    rows = c.fetchall()

    # Also get meta info
    c.execute("SELECT * FROM last_values WHERE market_slug = ? LIMIT 1", (slug,))
    meta_row = c.fetchone()

    conn.close()

    # Group by outcome
    series = {}
    for row in rows:
        oc = row["outcome"]
        if oc not in series:
            series[oc] = []
        series[oc].append({
            "ts": row["ts"],
            "iso": row["ts_iso"],
            "value": row["probability"],
            "volume": row["volume"],
            "gap": bool(row["is_gap_fill"]),
        })

    meta = {}
    if meta_row:
        meta = {
            "market_slug": meta_row["market_slug"],
            "event_slug": meta_row["event_slug"],
            "event_title": meta_row["event_title"],
            "question": meta_row["market_question"],
        }

    respond({
        "slug": slug,
        "meta": meta,
        "hours": hours,
        "series": series,
        "data_points": len(rows),
    })


def get_status():
    """Return logger status info."""
    conn = get_db()
    info = {
        "db_exists": os.path.exists(DB_PATH),
        "db_size_mb": round(os.path.getsize(DB_PATH) / 1048576, 2) if os.path.exists(DB_PATH) else 0,
        "logger_running": False,
        "logger_pid": None,
        "total_entries": 0,
        "unique_markets": 0,
        "first_entry": None,
        "last_entry": None,
    }

    # Check PID
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, "r") as f:
                pid = int(f.read().strip())
            # Check if process is alive
            os.kill(pid, 0)
            info["logger_running"] = True
            info["logger_pid"] = pid
        except (ProcessLookupError, ValueError, PermissionError):
            info["logger_running"] = False

    if conn:
        c = conn.cursor()
        c.execute("SELECT COUNT(*) FROM odds_log")
        info["total_entries"] = c.fetchone()[0]

        c.execute("SELECT COUNT(DISTINCT market_slug) FROM odds_log")
        info["unique_markets"] = c.fetchone()[0]

        c.execute("SELECT MIN(ts_iso) FROM odds_log")
        row = c.fetchone()
        info["first_entry"] = row[0] if row else None

        c.execute("SELECT MAX(ts_iso) FROM odds_log")
        row = c.fetchone()
        info["last_entry"] = row[0] if row else None

        conn.close()

    respond(info)


# ─── Main CGI Handler ─────────────────────────────────────────────
def main():
    qs = os.environ.get("QUERY_STRING", "")
    params = parse_qs(qs)

    action = params.get("action", ["markets"])[0]

    if action == "markets":
        list_markets()
    elif action == "history":
        slug = params.get("slug", [None])[0]
        if not slug:
            respond({"error": "Missing 'slug' parameter"})
            return
        outcome = params.get("outcome", [None])[0]
        hours = int(params.get("hours", ["24"])[0])
        hours = min(hours, 720)  # Max 30 days
        get_history(slug, outcome, hours)
    elif action == "status":
        get_status()
    else:
        respond({"error": f"Unknown action: {action}"})


if __name__ == "__main__":
    main()
