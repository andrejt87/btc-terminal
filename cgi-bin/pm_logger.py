#!/usr/bin/env python3
"""
BTC Bloomberg Terminal — Polymarket Odds Logger
Runs as a background daemon. Polls all configured Polymarket events every 30s,
logs every individual outcome probability into a SQLite database.
Gaps (API errors, off-hours, missing data) are forward-filled with the last known value.

Usage:
    python3 pm_logger.py            # Run in foreground
    python3 pm_logger.py --daemon   # Run as background daemon (nohup-style)

Database: ../data/pm_history.db
"""

import json
import os
import sys
import time
import sqlite3
import signal
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from datetime import datetime, timezone

# ─── Config ─────────────────────────────────────────────────────────────────
POLL_INTERVAL = 30  # seconds between polls
GAMMA_BASE = "https://gamma-api.polymarket.com"
TIMEOUT = 10
USER_AGENT = "BTC-Terminal/1.0 (PM Logger)"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "data")
DB_PATH = os.path.join(DATA_DIR, "pm_history.db")
PID_FILE = os.path.join(DATA_DIR, "pm_logger.pid")

# Same market config as polymarket.py
MARKET_SLUGS = [
    "what-price-will-bitcoin-hit-in-march-2026",
    "bitcoin-above-on-march-5",
    "will-bitcoin-hit-60k-or-80k-first-965",
    "what-price-will-bitcoin-hit-before-2027",
    "bitcoin-all-time-high-by",
    "when-will-bitcoin-hit-150k",
]

# ─── Database ───────────────────────────────────────────────────────────────
def init_db():
    """Create database and tables if they don't exist."""
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # Main time-series table
    c.execute("""
        CREATE TABLE IF NOT EXISTS odds_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,              -- UNIX timestamp (UTC)
            ts_iso TEXT NOT NULL,              -- ISO 8601 string
            event_slug TEXT NOT NULL,          -- parent event slug
            event_title TEXT,                  -- human-readable title
            market_slug TEXT NOT NULL,         -- individual market slug
            market_question TEXT,              -- market question text
            outcome TEXT NOT NULL,             -- "Yes"/"No" or outcome name
            probability REAL NOT NULL,         -- 0.0 to 100.0
            volume REAL,                       -- market volume
            liquidity REAL,                    -- market liquidity
            is_gap_fill INTEGER DEFAULT 0      -- 1 if forward-filled
        )
    """)

    # Index for fast queries by market + time
    c.execute("""
        CREATE INDEX IF NOT EXISTS idx_odds_market_ts
        ON odds_log (market_slug, outcome, ts)
    """)

    c.execute("""
        CREATE INDEX IF NOT EXISTS idx_odds_event_ts
        ON odds_log (event_slug, ts)
    """)

    # Last-known-values table for gap filling
    c.execute("""
        CREATE TABLE IF NOT EXISTS last_values (
            market_slug TEXT NOT NULL,
            outcome TEXT NOT NULL,
            probability REAL NOT NULL,
            volume REAL,
            liquidity REAL,
            event_slug TEXT,
            event_title TEXT,
            market_question TEXT,
            updated_at INTEGER,
            PRIMARY KEY (market_slug, outcome)
        )
    """)

    conn.commit()
    return conn


def get_last_values(conn):
    """Load all last-known values into a dict keyed by (market_slug, outcome)."""
    c = conn.cursor()
    c.execute("SELECT market_slug, outcome, probability, volume, liquidity, event_slug, event_title, market_question FROM last_values")
    result = {}
    for row in c.fetchall():
        result[(row[0], row[1])] = {
            "probability": row[2],
            "volume": row[3],
            "liquidity": row[4],
            "event_slug": row[5],
            "event_title": row[6],
            "market_question": row[7],
        }
    return result


def upsert_last_value(conn, market_slug, outcome, probability, volume, liquidity, event_slug, event_title, market_question, ts):
    """Update or insert the last known value for a market+outcome."""
    conn.execute("""
        INSERT INTO last_values (market_slug, outcome, probability, volume, liquidity, event_slug, event_title, market_question, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(market_slug, outcome) DO UPDATE SET
            probability = excluded.probability,
            volume = excluded.volume,
            liquidity = excluded.liquidity,
            event_slug = excluded.event_slug,
            event_title = excluded.event_title,
            market_question = excluded.market_question,
            updated_at = excluded.updated_at
    """, (market_slug, outcome, probability, volume, liquidity, event_slug, event_title, market_question, ts))


# ─── Fetch ──────────────────────────────────────────────────────────────────
def fetch_event(slug):
    """Fetch a single event by slug from Gamma API."""
    url = f"{GAMMA_BASE}/events?slug={slug}"
    try:
        req = Request(url, headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read())
        if data and isinstance(data, list) and len(data) > 0:
            return data[0]
    except Exception as e:
        log(f"  [WARN] Fetch failed for {slug}: {e}")
    return None


def parse_outcomes(market):
    """Parse market outcomes into list of {outcome, probability}."""
    outcomes_raw = market.get("outcomes", "[]")
    prices_raw = market.get("outcomePrices", "[]")
    try:
        outcomes = json.loads(outcomes_raw) if isinstance(outcomes_raw, str) else outcomes_raw
        prices = json.loads(prices_raw) if isinstance(prices_raw, str) else prices_raw
    except (json.JSONDecodeError, TypeError):
        return []

    result = []
    for i in range(len(outcomes)):
        price = float(prices[i]) if i < len(prices) else 0
        result.append({
            "outcome": outcomes[i],
            "probability": round(price * 100, 1),
        })
    return result


# ─── Logging ────────────────────────────────────────────────────────────────
def log(msg):
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print(f"[{ts}] {msg}", flush=True)


# ─── Poll Cycle ─────────────────────────────────────────────────────────────
def poll_once(conn):
    """Run one full poll cycle: fetch all markets, log all outcomes, gap-fill missing ones."""
    now_ts = int(time.time())
    now_iso = datetime.fromtimestamp(now_ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    last_values = get_last_values(conn)
    seen_keys = set()  # Track which (market_slug, outcome) we saw this cycle
    logged_count = 0

    for slug in MARKET_SLUGS:
        event = fetch_event(slug)
        if not event:
            continue

        event_slug = event.get("slug", slug)
        event_title = event.get("title", "")
        markets = event.get("markets", [])

        for market in markets:
            market_slug = market.get("slug", "")
            market_question = market.get("question", "")
            active = market.get("active", False)
            closed = market.get("closed", False)

            if not market_slug:
                continue

            # Only log active, non-closed markets
            if not active or closed:
                continue

            volume = market.get("volumeNum", 0) or float(market.get("volume", "0") or "0")
            liquidity = market.get("liquidityNum", 0) or float(market.get("liquidity", "0") or "0")

            outcomes = parse_outcomes(market)
            for oc in outcomes:
                key = (market_slug, oc["outcome"])
                seen_keys.add(key)

                # Log to database
                conn.execute("""
                    INSERT INTO odds_log (ts, ts_iso, event_slug, event_title, market_slug, market_question, outcome, probability, volume, liquidity, is_gap_fill)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                """, (now_ts, now_iso, event_slug, event_title, market_slug, market_question, oc["outcome"], oc["probability"], volume, liquidity))

                # Update last known value
                upsert_last_value(conn, market_slug, oc["outcome"], oc["probability"], volume, liquidity, event_slug, event_title, market_question, now_ts)
                logged_count += 1

    # ─── Gap fill: for any previously-seen market+outcome NOT seen this cycle ───
    gap_count = 0
    for (mk, oc), last in last_values.items():
        if (mk, oc) not in seen_keys:
            conn.execute("""
                INSERT INTO odds_log (ts, ts_iso, event_slug, event_title, market_slug, market_question, outcome, probability, volume, liquidity, is_gap_fill)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            """, (now_ts, now_iso, last["event_slug"], last["event_title"], mk, last["market_question"], oc, last["probability"], last["volume"], last["liquidity"]))
            gap_count += 1

    conn.commit()
    log(f"Logged {logged_count} values, gap-filled {gap_count}")


# ─── Main Loop ──────────────────────────────────────────────────────────────
def run():
    log("=== Polymarket Logger starting ===")
    log(f"DB: {DB_PATH}")
    log(f"Poll interval: {POLL_INTERVAL}s")
    log(f"Tracking {len(MARKET_SLUGS)} event slugs")

    conn = init_db()

    # Write PID file
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))

    # Graceful shutdown
    running = [True]
    def handle_signal(sig, frame):
        log("Received signal, shutting down...")
        running[0] = False
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    while running[0]:
        try:
            poll_once(conn)
        except Exception as e:
            log(f"[ERROR] Poll cycle failed: {e}")
        time.sleep(POLL_INTERVAL)

    conn.close()
    log("=== Logger stopped ===")
    try:
        os.remove(PID_FILE)
    except Exception:
        pass


if __name__ == "__main__":
    if "--daemon" in sys.argv:
        # Fork into background
        if os.fork() > 0:
            sys.exit(0)
        os.setsid()
        if os.fork() > 0:
            sys.exit(0)
        # Redirect stdout/stderr to log file
        log_file = os.path.join(DATA_DIR, "pm_logger.log")
        os.makedirs(DATA_DIR, exist_ok=True)
        sys.stdout = open(log_file, "a", buffering=1)
        sys.stderr = sys.stdout
    run()
