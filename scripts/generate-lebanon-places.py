#!/usr/bin/env python3
"""
Regenerates src/data/lebanonPlacesData.ts from GeoNames' Lebanon gazetteer
joined against geoBoundaries' Lebanon administrative boundaries.

This is the source of truth for how the map-locator feature's town/village
dataset was built. Re-run it (with real internet access -- it fetches from
download.geonames.org, www.geoboundaries.org, and media.githubusercontent.com)
to refresh against a newer GeoNames or geoBoundaries release. Do NOT hand-edit
src/data/lebanonPlacesData.ts directly -- it's overwritten wholesale by this
script.

Why the join is needed at all: GeoNames' own per-record admin2 (caza/
district) field is populated for well under 1% of Lebanon's populated-place
rows (spot-checked during initial development: 8 of 3,712), so district
cannot be read directly off GeoNames data. Governorate (admin1) is reliable
for ~99% of rows, but for full internal consistency (a caza belongs to
exactly one governorate, and independently-simplified ADM1/ADM2 polygon sets
can disagree right at shared borders) this script derives BOTH governorate
and caza from a single point-in-polygon join against geoBoundaries' ADM2
(caza) layer, then maps caza -> governorate via a fixed lookup table (see
CAZA_TO_GOV below) rather than doing two independent spatial joins.

Requires: requests, shapely (`pip install requests shapely --break-system-packages`)
"""
import io
import json
import re
import zipfile
from pathlib import Path

import requests
from shapely.geometry import shape, Point

GEONAMES_LB_ZIP = "https://download.geonames.org/export/dump/LB.zip"
GEOBOUNDARIES_ADM2_API = "https://www.geoboundaries.org/api/current/gbOpen/LBN/ADM2/"

# Feature codes to drop even though they're class 'P' (populated place) --
# historical/abandoned/destroyed settlements, not real present-day towns.
EXCLUDE_FEATURE_CODES = {"PPLH", "PPLQ", "PPLW"}

# geoBoundaries' ADM2 shapeName -> our canonical caza display name. Also
# doubles as the definitive list of Lebanon's 26 cazas -- every value here
# must have an entry in CAZA_TO_GOV below.
CAZA_NAME_MAP = {
    "Sour": "Tyre", "El Metn": "Matn", "Kesrouan": "Keserwan", "Jbail": "Jbeil",
    "Minieh-Dinnieh": "Danniyeh", "Marjaayoun": "Marjeyoun", "West Bekaa": "West Beqaa",
    "Bent Jbail": "Bent Jbeil", "Nabatiye": "Nabatieh",
}

# Caza -> governorate, reflecting Lebanon's 2017 administrative reform (9
# governorates, with Keserwan-Jbeil split out of Mount Lebanon) -- confirmed
# against geoBoundaries' ADM1 layer during initial development, which
# already reflects the split (GeoNames' own admin1 codes are older and still
# show only 8 governorates, which is why this script doesn't use them).
CAZA_TO_GOV = {
    "Beirut": "Beirut",
    "Baabda": "Mount Lebanon", "Aley": "Mount Lebanon", "Chouf": "Mount Lebanon", "Matn": "Mount Lebanon",
    "Keserwan": "Keserwan-Jbeil", "Jbeil": "Keserwan-Jbeil",
    "Tripoli": "North Lebanon", "Zgharta": "North Lebanon", "Koura": "North Lebanon",
    "Batroun": "North Lebanon", "Bcharre": "North Lebanon", "Danniyeh": "North Lebanon",
    "Akkar": "Akkar",
    "Zahle": "Beqaa", "West Beqaa": "Beqaa", "Rachaya": "Beqaa",
    "Baalbek": "Baalbek-Hermel", "Hermel": "Baalbek-Hermel",
    "Saida": "South Lebanon", "Jezzine": "South Lebanon", "Tyre": "South Lebanon",
    "Nabatieh": "Nabatieh", "Bent Jbeil": "Nabatieh", "Marjeyoun": "Nabatieh", "Hasbaya": "Nabatieh",
}

OUT_PATH = Path(__file__).resolve().parent.parent / "src" / "data" / "lebanonPlacesData.ts"


def fetch_geoboundaries_adm2():
    meta = requests.get(GEOBOUNDARIES_ADM2_API, timeout=30).json()
    # Full-resolution geometry, NOT simplifiedGeometryGeoJSON. Simplifying a
    # caza outline moves its border by up to a few hundred metres, which is
    # irrelevant for drawing a map and decisive for a point-in-polygon test:
    # a village sitting close to a caza line lands on whichever side the
    # simplification happened to put it. Re-running both layers over the
    # 3,712 places puts twelve of them in a different caza -- Bsifrin and
    # Zahriye reading Baabda instead of Matn, El Fradis reading Zgharta
    # instead of Bcharre, and so on -- plus one village that the simplified
    # outlines placed outside Lebanon entirely. The full file is 337 KB
    # against 145 KB and is downloaded once by this script, never shipped to
    # a client, so the smaller file buys nothing here.
    #
    # gjDownloadURL points at a git-lfs pointer via raw.githubusercontent.com;
    # media.githubusercontent.com resolves the actual LFS-backed content.
    url = meta["gjDownloadURL"].replace(
        "https://github.com/wmgeolab/geoBoundaries/raw/",
        "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/",
    )
    gj = requests.get(url, timeout=60).json()
    polygons = []
    for feat in gj["features"]:
        raw_name = feat["properties"]["shapeName"]
        caza = CAZA_NAME_MAP.get(raw_name, raw_name)
        gov = CAZA_TO_GOV.get(caza)
        if not gov:
            raise ValueError(f"Unmapped caza from geoBoundaries: {raw_name!r} (normalized: {caza!r})")
        polygons.append((caza, gov, shape(feat["geometry"])))
    return polygons


def resolve_caza_gov(lat, lng, polygons):
    pt = Point(lng, lat)  # GeoJSON is (lng, lat)
    for caza, gov, poly in polygons:
        if poly.contains(pt):
            return caza, gov
    # Fallback for points that fall just outside a simplified polygon's edge
    # (coastal points, etc.) -- nearest centroid rather than leaving it null.
    best, best_dist = None, float("inf")
    for caza, gov, poly in polygons:
        d = pt.distance(poly.centroid)
        if d < best_dist:
            best_dist, best = d, (caza, gov)
    return best


# Latin script incl. accented Latin (diacritics), digits, basic punctuation.
_LATIN_RE = re.compile(r"^[A-Za-z0-9À-ɏ'’\-.,()\s]+$")
_ASCII_ONLY_RE = re.compile(r"^[A-Za-z0-9'\-.,()\s]+$")
_ARABIC_RE = re.compile(r"[؀-ۿ]")


def parse_alternatenames(raw_alt, name, name_raw):
    """Returns (name_ar, alt_names). GeoNames' alternatenames column mixes
    lang-tagged entries ("ar:...", "fr:...") with untagged bare strings in
    arbitrary scripts (Latin, Arabic, Greek, Cyrillic, Armenian, Hebrew,
    CJK). Only Latin-script entries are useful as search alt-names for this
    app's English/Arabic UI -- non-Latin, non-Arabic scripts are dropped so
    they don't crowd out common colloquial Latin spellings (e.g. "Jbeil"
    for Byblos) under the cap. Untagged Arabic-script strings are accepted
    as a name_ar fallback when no explicit "ar:" tag is present -- this
    roughly doubled Arabic-name coverage during initial development (2,388
    of 3,712 places, vs a small fraction using only "ar:"-tagged entries).
    ASCII-only Latin variants are prioritized over accented ones so a
    seller typing on a plain keyboard is more likely to find their spelling
    within the cap.
    """
    if not raw_alt:
        return None, []
    name_ar = None
    latin_ascii, latin_accented, seen = [], [], set()
    for part in raw_alt.split(","):
        if not part:
            continue
        m = re.match(r"^([a-z]{2,3}):(.*)$", part)
        if m:
            if m.group(1) == "ar" and not name_ar:
                name_ar = m.group(2)
            continue
        if part in (name, name_raw):
            continue
        key = part.lower()
        if key in seen:
            continue
        if _ARABIC_RE.search(part):
            if not name_ar:
                name_ar = part
            seen.add(key)
            continue
        if _LATIN_RE.match(part):
            seen.add(key)
            (latin_ascii if _ASCII_ONLY_RE.match(part) else latin_accented).append(part)
        # else: other script (Greek/Cyrillic/Armenian/Hebrew/CJK) -- dropped.
    return name_ar, (latin_ascii + latin_accented)[:20]


def main():
    print("Fetching geoBoundaries ADM2 (caza) polygons...")
    polygons = fetch_geoboundaries_adm2()
    print(f"  {len(polygons)} caza polygons loaded")

    print("Fetching GeoNames LB.zip...")
    zip_bytes = requests.get(GEONAMES_LB_ZIP, timeout=60).content
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        lb_txt = zf.read("LB.txt").decode("utf-8")

    rows = []
    unresolved = 0
    for line in lb_txt.splitlines():
        if not line.strip():
            continue
        c = line.split("\t")
        geonameid, name, ascii_name, alt = c[0], c[1], c[2], c[3]
        lat, lng = float(c[4]), float(c[5])
        fclass, fcode, cc = c[6], c[7], c[8]
        population = int(c[14]) if c[14] else 0
        if cc != "LB" or fclass != "P" or fcode in EXCLUDE_FEATURE_CODES:
            continue
        resolved = resolve_caza_gov(lat, lng, polygons)
        if not resolved:
            unresolved += 1
            continue
        caza, gov = resolved
        name_ar, alt_names = parse_alternatenames(alt, ascii_name, name)
        rows.append({
            "id": int(geonameid), "name": ascii_name, "nameAr": name_ar, "altNames": alt_names,
            "governorate": gov, "caza": caza,
            "lat": round(lat, 4), "lng": round(lng, 4), "population": population,
        })

    print(f"  {len(rows)} populated places resolved, {unresolved} unresolved (dropped)")
    gov_counts = {}
    for r in rows:
        gov_counts[r["governorate"]] = gov_counts.get(r["governorate"], 0) + 1
    print("  Governorate breakdown:", json.dumps(gov_counts, indent=2))

    ts_rows = ",\n".join(
        "  { id: %d, name: %s, nameAr: %s, altNames: %s, governorate: %s, caza: %s, lat: %s, lng: %s, population: %d }"
        % (
            r["id"], json.dumps(r["name"], ensure_ascii=False), json.dumps(r["nameAr"], ensure_ascii=False),
            json.dumps(r["altNames"], ensure_ascii=False), json.dumps(r["governorate"]), json.dumps(r["caza"]),
            r["lat"], r["lng"], r["population"],
        )
        for r in rows
    )
    content = (
        "import { LebanonPlace } from './lebanonPlaces';\n\n"
        "// AUTO-GENERATED by scripts/generate-lebanon-places.py -- do not hand-edit.\n"
        "// Source: GeoNames Lebanon gazetteer (download.geonames.org/export/dump/LB.zip,\n"
        "// CC-BY-4.0) joined against geoBoundaries Lebanon ADM2 district boundaries\n"
        "// (geoboundaries.org, Public Domain). Re-run the generator script to refresh.\n"
        f"export const LEBANON_PLACES: LebanonPlace[] = [\n{ts_rows}\n];\n"
    )
    OUT_PATH.write_text(content, encoding="utf-8")
    print(f"Wrote {len(rows)} places to {OUT_PATH}")


if __name__ == "__main__":
    main()
