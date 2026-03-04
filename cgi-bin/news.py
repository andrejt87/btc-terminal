#!/usr/bin/env python3
"""
BTC Bloomberg Terminal — Multi-Source News Aggregator
Fetches and merges RSS feeds from 16+ crypto news sources.
Returns unified JSON for the frontend ticker and news panel.
"""

import json
import os
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from html import unescape
import re
import hashlib

# ─── RSS Feed Sources ─────────────────────────────────────────────
FEEDS = {
    # Tier 1: Major outlets
    "CoinDesk": "https://coindesk.com/arc/outboundfeeds/rss/",
    "CoinTelegraph": "https://cointelegraph.com/rss",
    "Decrypt": "https://decrypt.co/feed",
    "The Block": "https://www.theblock.co/rss.xml",
    "Bitcoin Magazine": "https://bitcoinmagazine.com/.rss/full",
    "Bitcoin.com": "https://news.bitcoin.com/feed",
    # Tier 2: Specialist
    "NewsBTC": "https://newsbtc.com/feed",
    "CryptoBriefing": "https://cryptobriefing.com/feed",
    "The Daily Hodl": "https://dailyhodl.com/feed",
    "AMBCrypto": "https://ambcrypto.com/feed",
    "Crypto.news": "https://crypto.news/feed",
    "U.Today": "https://u.today/rss",
    "CryptoDaily": "https://cryptodaily.co.uk/feed",
    # Tier 3: Analytics / Research
    "Investing.com": "https://investing.com/rss/news_301.rss",
    "Messari": "https://messari.io/rss",
    "Glassnode": "https://insights.glassnode.com/rss",
}

TIMEOUT = 6  # seconds per feed
MAX_ITEMS_PER_FEED = 10
MAX_TOTAL = 100
USER_AGENT = "BTC-Terminal/1.0 (News Aggregator)"

# ─── Simple file-based cache ─────────────────────────────────────
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "news_cache.json")
CACHE_TTL = 120  # 2 minutes


def load_cache():
    try:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, "r") as f:
                data = json.load(f)
            if time.time() - data.get("ts", 0) < CACHE_TTL:
                return data.get("items")
    except Exception:
        pass
    return None


def save_cache(items):
    try:
        with open(CACHE_FILE, "w") as f:
            json.dump({"ts": time.time(), "items": items}, f)
    except Exception:
        pass


# ─── HTML cleaning ────────────────────────────────────────────────
def clean_html(text):
    if not text:
        return ""
    text = unescape(text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    # Limit to ~200 chars for summaries
    if len(text) > 200:
        text = text[:197] + "..."
    return text


def make_id(title, link):
    raw = (title or "") + (link or "")
    return hashlib.md5(raw.encode()).hexdigest()[:12]


# ─── Parse date from various formats ─────────────────────────────
def parse_date(date_str):
    if not date_str:
        return None
    date_str = date_str.strip()

    # Try RFC 2822 (standard RSS)
    try:
        return parsedate_to_datetime(date_str)
    except Exception:
        pass

    # Try ISO 8601 variants
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%d %H:%M:%S",
        "%a, %d %b %Y %H:%M:%S %Z",
        "%a, %d %b %Y %H:%M:%S",
    ]:
        try:
            dt = datetime.strptime(date_str, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return None


# ─── Fetch and parse a single RSS feed ────────────────────────────
def fetch_feed(source_name, url):
    items = []
    try:
        req = Request(url, headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read()

        root = ET.fromstring(raw)

        # Handle Atom feeds
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        atom_entries = root.findall("atom:entry", ns) or root.findall("{http://www.w3.org/2005/Atom}entry")

        if atom_entries:
            for entry in atom_entries[:MAX_ITEMS_PER_FEED]:
                title_el = entry.find("{http://www.w3.org/2005/Atom}title")
                link_el = entry.find("{http://www.w3.org/2005/Atom}link")
                summary_el = entry.find("{http://www.w3.org/2005/Atom}summary") or entry.find("{http://www.w3.org/2005/Atom}content")
                date_el = entry.find("{http://www.w3.org/2005/Atom}published") or entry.find("{http://www.w3.org/2005/Atom}updated")

                title = title_el.text if title_el is not None else ""
                link = link_el.get("href", "") if link_el is not None else ""
                summary = summary_el.text if summary_el is not None else ""
                date_str = date_el.text if date_el is not None else ""

                dt = parse_date(date_str)
                items.append({
                    "id": make_id(title, link),
                    "title": clean_html(title),
                    "link": link,
                    "summary": clean_html(summary),
                    "source": source_name,
                    "published": dt.isoformat() if dt else "",
                    "timestamp": dt.timestamp() if dt else 0,
                })
        else:
            # Standard RSS 2.0
            for item in root.iter("item"):
                title_el = item.find("title")
                link_el = item.find("link")
                desc_el = item.find("description")
                date_el = item.find("pubDate")

                # Try dc:date as fallback
                if date_el is None:
                    date_el = item.find("{http://purl.org/dc/elements/1.1/}date")

                title = title_el.text if title_el is not None else ""
                link = link_el.text if link_el is not None else ""
                desc = desc_el.text if desc_el is not None else ""
                date_str = date_el.text if date_el is not None else ""

                dt = parse_date(date_str)
                items.append({
                    "id": make_id(title, link),
                    "title": clean_html(title),
                    "link": link,
                    "summary": clean_html(desc),
                    "source": source_name,
                    "published": dt.isoformat() if dt else "",
                    "timestamp": dt.timestamp() if dt else 0,
                })

    except Exception as e:
        # Silently skip failed feeds — we have 15 others
        pass

    return items


# ─── Main handler ─────────────────────────────────────────────────
def main():
    method = os.environ.get("REQUEST_METHOD", "GET")
    query = os.environ.get("QUERY_STRING", "")

    # Parse query params
    params = {}
    if query:
        for pair in query.split("&"):
            if "=" in pair:
                k, v = pair.split("=", 1)
                params[k] = v

    source_filter = params.get("source", "").lower()
    search_q = params.get("q", "").lower()
    limit = min(int(params.get("limit", MAX_TOTAL)), MAX_TOTAL)
    no_cache = params.get("nocache", "0") == "1"

    # Try cache first
    all_items = None
    if not no_cache:
        all_items = load_cache()

    if all_items is None:
        # Fetch all feeds (sequentially — CGI has 30s timeout, this takes ~10s)
        all_items = []
        for name, url in FEEDS.items():
            feed_items = fetch_feed(name, url)
            all_items.extend(feed_items)

        # Sort by timestamp descending (newest first)
        all_items.sort(key=lambda x: x.get("timestamp", 0), reverse=True)

        # Deduplicate by similar titles
        seen_titles = set()
        deduped = []
        for item in all_items:
            # Normalize title for dedup
            norm = re.sub(r"[^a-z0-9]", "", item["title"].lower())[:50]
            if norm and norm not in seen_titles:
                seen_titles.add(norm)
                deduped.append(item)
        all_items = deduped

        # Cache the results
        save_cache(all_items)

    # Apply filters
    result = all_items
    if source_filter:
        result = [i for i in result if source_filter in i["source"].lower()]
    if search_q:
        result = [i for i in result if search_q in i["title"].lower() or search_q in i["summary"].lower()]

    result = result[:limit]

    # Build source stats
    source_counts = {}
    for item in all_items:
        src = item["source"]
        source_counts[src] = source_counts.get(src, 0) + 1

    output = {
        "items": result,
        "total": len(all_items),
        "filtered": len(result),
        "sources": source_counts,
        "cached": load_cache() is not None,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }

    print("Content-Type: application/json")
    print("Access-Control-Allow-Origin: *")
    print()
    print(json.dumps(output))


if __name__ == "__main__":
    main()
