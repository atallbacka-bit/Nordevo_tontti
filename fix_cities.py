#!/usr/bin/env python3
"""
Fix the kunta (city) field for all imported plots by re-geocoding with
Nominatim's addressdetails=1, which gives a proper structured address
with city/town/municipality — not a raw comma-split of display_name.

Run from repo root:  python3 fix_cities.py
"""

import time
import requests
from pathlib import Path

# ---- Config ----------------------------------------------------------------
ENV_PATH = Path(__file__).parent / "tonttihaku" / ".env.local"

def load_env():
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env

ENV = load_env()
SUPABASE_URL = ENV["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = ENV["SUPABASE_SERVICE_ROLE_KEY"]
HEADERS = {
    "apikey":        SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type":  "application/json",
}

# ---------------------------------------------------------------------------

def geocode_municipality(address: str, hint_city: str) -> tuple[float, float, str]:
    """
    Returns (lat, lng, municipality_name) using Nominatim addressdetails.
    Municipality is taken from the structured address fields in priority order:
      city → town → municipality → county → ""
    """
    query = f"{address}, {hint_city}, Finland" if address and hint_city else (address or hint_city or "")
    if not query.strip():
        return 0.0, 0.0, ""

    try:
        r = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": query,
                "format": "json",
                "limit": 1,
                "countrycodes": "fi",
                "addressdetails": 1,
            },
            headers={"User-Agent": "nordevo-tonttihaku-fixcity/1.0"},
            timeout=10,
        )
        time.sleep(1.1)
        results = r.json()
        if results:
            hit = results[0]
            addr = hit.get("address", {})
            # Try fields from most to least specific
            city = (
                addr.get("city") or
                addr.get("town") or
                addr.get("municipality") or
                addr.get("county") or
                ""
            )
            return float(hit["lat"]), float(hit["lon"]), city
    except Exception as e:
        print(f"    [geocode] WARNING: {e}")

    return 0.0, 0.0, hint_city


def get_all_plots():
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/plots?select=id,name,address,kunta,lat,lng",
        headers=HEADERS,
        timeout=20,
    )
    r.raise_for_status()
    return r.json()


def patch_plot(plot_id: str, kunta: str, lat: float, lng: float):
    payload = {"kunta": kunta}
    # Only update lat/lng if we didn't already have coordinates
    if lat != 0.0:
        payload["lat"] = lat
        payload["lng"] = lng
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/plots?id=eq.{plot_id}",
        headers=HEADERS,
        json=payload,
        timeout=15,
    )
    return r.status_code in (200, 201, 204)


def main():
    plots = get_all_plots()
    print(f"Found {len(plots)} plots to check.\n")

    updated = []
    skipped = []
    failed  = []

    for plot in plots:
        pid     = plot["id"]
        name    = plot["name"]
        address = plot.get("address") or ""
        kunta   = plot.get("kunta") or ""
        lat     = plot.get("lat") or 0.0
        lng     = plot.get("lng") or 0.0

        print(f"  [{pid}] '{name[:40]}' — current kunta: '{kunta}'")

        new_lat, new_lng, new_city = geocode_municipality(address, kunta)

        # Fallback: geocode by name alone if no result
        if not new_city and not new_lat:
            new_lat, new_lng, new_city = geocode_municipality(name, "Finland")

        if not new_city:
            print(f"    → Could not resolve city, keeping '{kunta}'")
            skipped.append(f"'{name}': no city found, kept '{kunta}'")
            continue

        if new_city == kunta and lat != 0.0:
            print(f"    → OK ('{kunta}' unchanged, lat/lng already set)")
            skipped.append(f"'{name}': already correct ('{kunta}')")
            continue

        print(f"    → Updating: '{kunta}' → '{new_city}'  lat={new_lat:.5f}, lng={new_lng:.5f}")
        ok = patch_plot(pid, new_city, new_lat, new_lng)
        if ok:
            updated.append(f"'{name}': '{kunta}' → '{new_city}'")
        else:
            failed.append(f"'{name}': patch failed")

    print()
    print("=" * 60)
    print(f"Updated: {len(updated)}")
    print(f"Skipped (already OK / no result): {len(skipped)}")
    print(f"Failed:  {len(failed)}")
    if updated:
        print("\nChanged:")
        for u in updated:
            print(f"  {u}")
    if failed:
        print("\nFailed:")
        for f in failed:
            print(f"  {f}")


if __name__ == "__main__":
    main()
