# Bitcoin Price Tracker — Data Layer

A data infrastructure layer for the **Bitcoin Price Tracker** project. It provides historical BTC/USD price data, market statistics, halving history, and synthetic extended data for timeframes beyond free API limits.

## Features

- **Real-time data fetching** from CoinGecko Public API (`/coins/bitcoin/market_chart`) for 1D, 7D, 30D, 90D, 180D, and 365D timeframes.
- **Historical milestone data** with key BTC prices and events.
- **Halving events history** with block reward changes and price multiples.
- **Market statistics** (ATH, ATL, supply, hashrate, correlations).
- **Synthetic data generation** for 2Y, 3Y, 5Y, and ALL timeframes using anchor-based random walk constrained by real historical milestones.
- **Combined `prices_all.json`** merges real and synthetic data into a single file.
- **Build automation** via `scripts/build.py` (fetch, generate, dist).
- **GitHub Actions** workflow to auto-deploy `dist/` to GitHub Pages on every push to `main`.

## Project Structure

```
btc-agent-D/
├── data/
│   ├── year_data.json            # Real 366-day data (May 2025 – May 2026)
│   ├── price_milestones.json     # Key historical BTC prices & events
│   ├── halving_events.json       # Bitcoin halving history
│   ├── market_stats.json         # Market cap, ATH, supply, hashrate
│   ├── prices_*.json             # Fetched and synthetic data files
│   └── manifest.json             # Build manifest (generated)
├── scripts/
│   ├── fetch_data.py             # Fetch data from CoinGecko
│   ├── generate_demo_data.py     # Generate synthetic extended data
│   └── build.py                  # Orchestration & dist builder
├── .github/workflows/
│   └── static.yml                # GitHub Pages deployment
├── dist/                         # Build output (GitHub Pages)
├── README.md
└── LICENSE (MIT)
```

## Setup

Requires **Python 3.8+** and a working internet connection.

```bash
# Clone and enter the directory
cd btc-agent-D

# (Optional) Create a virtual environment
python3 -m venv venv
source venv/bin/activate

# No external dependencies beyond Python stdlib
python3 scripts/fetch_data.py
python3 scripts/generate_demo_data.py
python3 scripts/build.py --all
```

## Usage

### Fetch real-time data

```bash
python3 scripts/fetch_data.py
```

Downloads:
- `data/prices_1d.json`
- `data/prices_7d.json`
- `data/prices_30d.json`
- `data/prices_90d.json`
- `data/prices_180d.json`
- `data/prices_365d.json`
- `data/prices_all.json`

Rate-limited to **1 request/second** with **3 retries** and a custom `User-Agent`.

### Generate synthetic extended data

```bash
python3 scripts/generate_demo_data.py
```

Creates:
- `data/prices_2y.json`
- `data/prices_3y.json`
- `data/prices_5y.json`
- `data/prices_all.json` (updated)

Uses a mean-reverting random walk anchored to real historical milestones.

### Build everything

```bash
python3 scripts/build.py --all
```

Or individually:

```bash
python3 scripts/build.py --fetch
python3 scripts/build.py --generate
python3 scripts/build.py --build
```

The `--build` step creates the `dist/` directory containing all data files (and frontend assets if siblings exist).

## Data Sources

| Data | Source | URL |
|------|--------|-----|
| Live prices | CoinGecko Public API | https://api.coingecko.com/api/v3/coins/bitcoin/market_chart |
| Milestones | CoinDesk, CMC, Blockchain.com | Various |
| Halvings | Bitcoin blockchain data | https://www.blockchain.com |

## Limitations

- **CoinGecko Public API** limits historical queries to **365 days**. Requests beyond that return error 10012.
- For longer timeframes (2Y, 3Y, 5Y, ALL), this project uses **synthetic data** generated from known milestones. It is plausible but not precise.
- No API key management is included; upgrade to a paid CoinGecko plan for full historical access.
- Synthetic data uses a deterministic seed (`SEED=42`) and a simple mean-reverting random walk. It does not model flash crashes, exchange hacks, or regulatory shocks.

## Deployment

Push to `main` and the included **GitHub Actions workflow** (`.github/workflows/static.yml`) will automatically deploy the contents of `dist/` to **GitHub Pages**.

## License

```
MIT License

Copyright (c) 2026 Bitcoin Price Tracker Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
