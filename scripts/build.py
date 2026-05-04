#!/usr/bin/env python3
"""
Build script for Bitcoin Price Tracker data layer.
Runs fetch (best effort), generates synthetic extended data, and
produces a dist/ output suitable for GitHub Pages.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys

BASE = os.path.dirname(__file__)
ROOT = os.path.join(BASE, "..")
SCRIPTS = os.path.join(ROOT, "scripts")
DATA = os.path.join(ROOT, "data")
DIST = os.path.join(ROOT, "dist")


def run_py(script_name: str, label: str) -> int:
    path = os.path.join(SCRIPTS, script_name)
    if not os.path.exists(path):
        print(f"[WARN] Missing {path}")
        return 1
    print(f"\n=== Running {label} ===")
    rc = subprocess.call([sys.executable, path], cwd=ROOT)
    print(f"=== {label} exit={rc} ===")
    return rc


def copy_data_to_dist():
    os.makedirs(DIST, exist_ok=True)
    # Ensure dist/data/ exists
    dist_data = os.path.join(DIST, "data")
    os.makedirs(dist_data, exist_ok=True)

    for fname in os.listdir(DATA):
        src = os.path.join(DATA, fname)
        if os.path.isfile(src):
            shutil.copy2(src, dist_data)
            print(f"  copied {fname} -> dist/data/")

    # Write a manifest
    manifest = {
        "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "files": sorted(os.listdir(dist_data)),
    }
    with open(os.path.join(DIST, "data", "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print("  wrote manifest.json")


def maybe_copy_frontend():
    """If sibling A/B/C directories exist, copy their files into dist/."""
    for sibling, files in [
        ("/tmp/btc-agent-A", ["index.html"]),
        ("/tmp/btc-agent-B/js", ["main.js"]),
        ("/tmp/btc-agent-C/css", ["style.css"]),
    ]:
        for fname in files:
            src = os.path.join(sibling, fname)
            if os.path.exists(src):
                if fname.endswith(".js"):
                    dest_dir = os.path.join(DIST, "js")
                elif fname.endswith(".css"):
                    dest_dir = os.path.join(DIST, "css")
                else:
                    dest_dir = DIST
                os.makedirs(dest_dir, exist_ok=True)
                shutil.copy2(src, dest_dir)
                print(f"  copied frontend {fname} -> {dest_dir}/")


def main():
    parser = argparse.ArgumentParser(description="Build BTC tracker data")
    parser.add_argument("--fetch", action="store_true", help="Run fetch_data.py")
    parser.add_argument("--generate", action="store_true", help="Run generate_demo_data.py")
    parser.add_argument("--build", action="store_true", help="Create dist/ output")
    parser.add_argument("--all", action="store_true", help="Run everything")
    args = parser.parse_args()

    if not (args.fetch or args.generate or args.build or args.all):
        args.all = True

    if args.all or args.fetch:
        run_py("fetch_data.py", "fetch_data")

    if args.all or args.generate:
        run_py("generate_demo_data.py", "generate_demo_data")

    if args.all or args.build:
        print("\n=== Building dist/ ===")
        copy_data_to_dist()
        maybe_copy_frontend()
        print(f"\nDist ready at: {DIST}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
