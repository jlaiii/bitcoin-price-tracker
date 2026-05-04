#!/usr/bin/env python3
"""
Bitcoin Price Data Fetcher
Fetches historical BTC/USD data from CoinGecko API for multiple timeframes.
Saves per-timeframe files and a combined prices_all.json.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime

BASE_URL = "https://api.coingecko.com/api/v3"
ENDPOINT = "/coins/bitcoin/market_chart"
DATADIR = os.path.join(os.path.dirname(__file__), "..", "data")
TIMEOUT = 30
MAX_RETRIES = 3
RATE_LIMIT = 1.0  # seconds between requests

TIMEFRAMES = {
    "1d": {"days": 1, "output": "prices_1d.json"},
    "7d": {"days": 7, "output": "prices_7d.json"},
    "30d": {"days": 30, "output": "prices_30d.json"},
    "90d": {"days": 90, "output": "prices_90d.json"},
    "180d": {"days": 180, "output": "prices_180d.json"},
    "365d": {"days": 365, "output": "prices_365d.json"},
}


def log(msg: str):
    ts = datetime.now().isoformat(timespec="seconds")
    print(f"[{ts}] {msg}", flush=True)


def fetch(url: str) -> dict:
    """Fetch JSON with retries, rate limiting, and User-Agent."""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (btc-tracker-data-fetcher/1.0; contact=dev@example.com)",
            "Accept": "application/json",
        },
    )

    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            log(f"GET {url} (attempt {attempt}/{MAX_RETRIES})")
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            time.sleep(RATE_LIMIT)
            return data
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(body)
            except Exception:
                payload = {"raw": body[:500]}
            last_error = {"code": e.code, "reason": e.reason, "body": payload}
            log(f"HTTP {e.code} {e.reason} — retrying in {attempt}s")
            time.sleep(attempt)  # simple backoff
        except Exception as e:
            last_error = str(e)
            log(f"Error: {last_error} — retrying in {attempt}s")
            time.sleep(attempt)

    raise RuntimeError(f"Failed after {MAX_RETRIES} attempts. Last error: {last_error}")


def save_json(path: str, data: dict):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    log(f"Saved {path}")


def explain_api_error(body: dict):
    """Print a user-friendly explanation when API returns >365 days error."""
    status = body.get("status", body.get("error", {}).get("status", {}))
    msg = status.get("error_message", "")
    code = status.get("error_code", "unknown")
    log(f"CoinGecko error code {code}:")
    if "exceeds the allowed time range" in msg or "365 days" in msg:
        log("The CoinGecko public API limits historical data queries to 365 days.")
        log("To access longer timeframes (2Y, 3Y, 5Y, ALL), you need a paid plan:")
        log("  https://www.coingecko.com/en/api/pricing")
        log("  OR use generate_demo_data.py to synthesize extended data from milestones.")
    else:
        log(f"Message: {msg}")


def main():
    os.makedirs(DATADIR, exist_ok=True)
    combined = {}

    for label, cfg in TIMEFRAMES.items():
        days = cfg["days"]
        out_name = cfg["output"]
        url = f"{BASE_URL}{ENDPOINT}?vs_currency=usd&days={days}"
        path = os.path.join(DATADIR, out_name)

        try:
            data = fetch(url)
        except RuntimeError as exc:
            log(str(exc))
            continue

        # Check for CoinGecko error payloads inside HTTP 200/429-ish wrappers
        if "error" in data or (isinstance(data, dict) and "status" in data):
            explain_api_error(data)
            combined[label] = {"error": data.get("error", data.get("status"))}
        else:
            combined[label] = data

        save_json(path, data)
        log(f"Timeframe {label} ({days} days) OK — {len(data.get('prices', []))} price points")

    # Save combined
    all_path = os.path.join(DATADIR, "prices_all.json")
    save_json(all_path, combined)
    log(f"Combined {len(combined)} timeframes into prices_all.json")

    return 0


if __name__ == "__main__":
    sys.exit(main())
