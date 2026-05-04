#!/usr/bin/env python3
"""
Generate synthetic but realistic BTC price data for timeframes beyond
CoinGecko public API limits (2Y, 3Y, 5Y, ALL).

Uses actual historical milestone prices as anchor points, then fills
gaps with a constrained random walk to produce plausible daily data.
"""

import json
import os
import sys
import random
import math
from datetime import datetime, timedelta
from typing import List, Tuple

DATADIR = os.path.join(os.path.dirname(__file__), "..", "data")
SEED = 42

# Anchor points: (ISO date string, price USD, note)
ANCHORS: List[Tuple[str, float, str]] = [
    ("2010-07-18", 0.09, "Mt.Gox open"),
    ("2011-02-09", 1.00, "USD parity"),
    ("2011-06-08", 31.00, "First bubble"),
    ("2013-04-01", 100.00, "$100"),
    ("2013-11-29", 1242.00, "$1242 peak"),
    ("2015-01-14", 150.00, "Post-crash low"),
    ("2017-05-20", 2000.00, "$2000"),
    ("2017-12-17", 19783.00, "2017 ATH"),
    ("2018-12-15", 3120.00, "2018 bottom"),
    ("2020-03-13", 3850.00, "COVID crash"),
    ("2020-05-11", 8600.00, "Third halving"),
    ("2020-12-17", 23000.00, "$23K"),
    ("2021-04-14", 64800.00, "Coinbase IPO"),
    ("2021-07-20", 30000.00, "China ban"),
    ("2021-11-10", 69000.00, "All-time high 2021"),
    ("2022-06-18", 17600.00, "2022 bottom"),
    ("2022-11-21", 15480.00, "FTX collapse"),
    ("2023-01-01", 16500.00, "2023 start"),
    ("2023-12-17", 42000.00, "2023 close"),
    ("2024-01-11", 49000.00, "Spot ETF"),
    ("2024-03-14", 73757.00, "2024 ATH"),
    ("2024-04-20", 64000.00, "Fourth halving"),
    ("2024-11-06", 75000.00, "Trump election"),
    ("2024-12-17", 108000.00, "$108K"),
    ("2025-01-20", 102000.00, "Inauguration"),
    ("2025-04-04", 82650.00, "Tariff panic"),
    ("2025-05-01", 97000.00, "Current era"),
]


def parse_date(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d")


def make_anchor_lookup() -> dict:
    """Return {timestamp_ms: price_usd} from anchors."""
    return {int(parse_date(d).timestamp() * 1000): p for d, p, _ in ANCHORS}


def price_at(t: datetime, anchors_sorted: List[Tuple[datetime, float]]) -> float:
    """Find anchor bracket and interpolate price linearly."""
    if t <= anchors_sorted[0][0]:
        return anchors_sorted[0][1]
    if t >= anchors_sorted[-1][0]:
        return anchors_sorted[-1][1]

    for i in range(len(anchors_sorted) - 1):
        t0, p0 = anchors_sorted[i]
        t1, p1 = anchors_sorted[i + 1]
        if t0 <= t <= t1:
            frac = (t - t0).total_seconds() / (t1 - t0).total_seconds()
            return p0 + (p1 - p0) * frac
    return anchors_sorted[-1][1]


def random_walk(
    start_dt: datetime,
    end_dt: datetime,
    anchors_sorted: List[Tuple[datetime, float]],
    vol_pct: float = 0.025,
) -> Tuple[List[List[float]], List[List[float]]]:
    """
    Generate daily timestamps + constrained random walk anchored by milestones.
    Returns prices [[ts_ms, price], ...] and volumes [[ts_ms, btc_vol], ...].
    """
    random.seed(SEED)

    prices = []
    volumes = []
    current = float(price_at(start_dt, anchors_sorted))

    t = start_dt
    while t <= end_dt:
        ts = int(t.timestamp() * 1000)
        anchor = price_at(t, anchors_sorted)

        # drift toward anchor with mean-reversion
        drift = (anchor - current) * 0.06
        noise = current * random.gauss(0, vol_pct)
        current = max(current + drift + noise, 0.01)

        # clamp within ±40% of anchor to stay realistic
        lo, hi = anchor * 0.6, anchor * 1.4
        if current < lo:
            current = lo + abs(noise) * 0.5
        if current > hi:
            current = hi - abs(noise) * 0.5

        # volume correlates with price volatility/spikes
        base_vol_btc = 20000 + (current / 1000) * 500
        vol_factor = random.uniform(0.5, 2.5)
        btc_vol = base_vol_btc * vol_factor

        prices.append([ts, round(current, 2)])
        volumes.append([ts, round(btc_vol, 2)])
        t += timedelta(days=1)

    return prices, volumes


def generate_timeframe(days: int, label: str):
    os.makedirs(DATADIR, exist_ok=True)
    end_dt = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    start_dt = end_dt - timedelta(days=days)

    anchors_sorted = sorted(
        [(parse_date(d), p) for d, p, _ in ANCHORS], key=lambda x: x[0]
    )

    # For shorter synthetic windows, use last-N days from year_data if available
    if days <= 730:
        fallback_path = os.path.join(DATADIR, "year_data.json")
        if os.path.exists(fallback_path):
            with open(fallback_path, "r") as f:
                fb = json.load(f)
            fb_prices = fb.get("prices", [])
            if fb_prices:
                # slice to requested length
                fb_prices = fb_prices[-days:]
                fb_vols = fb.get("total_volumes", [])
                if fb_vols:
                    fb_vols = fb_vols[-days:]
            out = {
                "prices": fb_prices,
                "total_volumes": fb_vols if fb_vols else [],
                "meta": {
                    "synthetic": False,
                    "source": "CoinGecko year_data.json slice",
                    "days": days,
                    "points": len(fb_prices),
                },
            }
            path = os.path.join(DATADIR, f"prices_{label}.json")
            with open(path, "w") as f:
                json.dump(out, f, indent=2)
            print(f"Generated {path} from real year_data.json ({len(fb_prices)} points)")
            return

    # fallback to random walk
    prices, volumes = random_walk(start_dt, end_dt, anchors_sorted)
    out = {
        "prices": prices,
        "total_volumes": volumes,
        "meta": {
            "synthetic": True,
            "source": "generated_demo_data.py random walk anchored on milestones",
            "days": days,
            "points": len(prices),
            "seed": SEED,
        },
    }
    filename = f"prices_{label}.json"
    # prevent overwriting the API combined file
    if label == "all":
        filename = "prices_all_synth.json"
    path = os.path.join(DATADIR, filename)
    with open(path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"Generated {path} ({len(prices)} points, synthetic)")


def main():
    os.makedirs(DATADIR, exist_ok=True)

    # Build files for timeframes CoinGecko public API cannot serve
    generate_timeframe(730, "2y")
    generate_timeframe(1095, "3y")
    generate_timeframe(1825, "5y")
    generate_timeframe(5500, "all")

    # Also emit a combined synthetic file
    combined = {}
    for label in ["2y", "3y", "5y", "all"]:
        filename = f"prices_{label}.json"
        if label == "all":
            filename = "prices_all_synth.json"
        path = os.path.join(DATADIR, filename)
        if os.path.exists(path):
            with open(path, "r") as f:
                combined[label] = json.load(f)

    all_path = os.path.join(DATADIR, "prices_all.json")
    # If the all_path already exists from fetch_data, merge rather than overwrite
    existing = {}
    if os.path.exists(all_path):
        try:
            with open(all_path, "r") as f:
                existing = json.load(f)
        except Exception:
            pass
    existing.update(combined)
    with open(all_path, "w") as f:
        json.dump(existing, f, indent=2)
    print(f"Updated {all_path} with synthetic timeframes.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
