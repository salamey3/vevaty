import { LatLng, haversineKm } from '../lib/geo';
import { LEBANON_PLACES } from './lebanonPlacesData';

// Replaces lebanonRegions.ts (Region -> flat town-name suggestions, never
// persisted) and lebanonDistricts.ts (flat town -> centroid substring
// lookup, no governorate/caza at all) with one merged, hierarchical,
// coordinate-aware dataset: governorate (muhafazah) -> caza (qadaa) ->
// town/village, sourced from GeoNames' Lebanon gazetteer joined against
// geoBoundaries' Lebanon administrative boundaries (see
// scripts/generate-lebanon-places.py for how lebanonPlacesData.ts was
// generated -- re-run it to refresh against a newer GeoNames/geoBoundaries
// release rather than hand-editing the generated file).
export interface LebanonPlace {
  id: number; // GeoNames geonameid
  name: string; // ASCII display name (primary, Latin script)
  nameAr: string | null;
  altNames: string[]; // extra Latin spellings/transliterations, for search only
  governorate: string;
  caza: string;
  lat: number;
  lng: number;
  population: number;
}

const byId = new Map<number, LebanonPlace>(LEBANON_PLACES.map((p) => [p.id, p]));

export function getGovernorateNames(): string[] {
  return Array.from(new Set(LEBANON_PLACES.map((p) => p.governorate))).sort();
}

export function getCazasForGovernorate(governorate: string): string[] {
  const key = governorate.trim().toLowerCase();
  return Array.from(
    new Set(LEBANON_PLACES.filter((p) => p.governorate.toLowerCase() === key).map((p) => p.caza))
  ).sort();
}

export function getTownsForCaza(governorate: string, caza: string): string[] {
  const gKey = governorate.trim().toLowerCase();
  const cKey = caza.trim().toLowerCase();
  return LEBANON_PLACES.filter((p) => p.governorate.toLowerCase() === gKey && p.caza.toLowerCase() === cKey)
    .map((p) => p.name)
    .sort();
}

export function getAllTowns(): string[] {
  return Array.from(new Set(LEBANON_PLACES.map((p) => p.name))).sort();
}

// How prominent a place is, for ordering search results and for settling
// ties between same-named places. Higher wins.
//
// Population alone -- the previous rule -- does not work on this dataset:
// GeoNames carries a population figure for 42 of the 3,712 Lebanese places
// and zero for the other 3,670, so "sort by population descending" was a
// no-op for 98.9% of rows and search results came back in whatever order
// the generator happened to emit them. That is how searching "Broummana"
// offered an obscure hamlet in Keserwan ahead of the Brummana in Matn that
// everyone means.
//
// The two fields that DO separate them are already in the data. GeoNames
// records an Arabic name and a spread of alternate spellings for places
// that are actually written about, and neither for cadastral sub-localities
// -- Brummana/Matn has an Arabic name and six spellings, its Keserwan
// namesake has none and two. Across the 222 names shared by more than one
// place, that decides 156 outright; the rest are genuinely
// indistinguishable generic names ("Haret et Tahta", the lower quarter,
// exists in sixteen cazas) where any order is as good as another, so `id`
// keeps it at least deterministic.
//
// Population still leads where it exists, since those 42 are the real
// cities and no proxy should outrank a known figure.
function placeRank(p: LebanonPlace): number {
  return (p.population > 0 ? 1_000_000 + p.population : 0) + (p.nameAr ? 1_000 : 0) + p.altNames.length;
}

// Exact-name index. Where several places answer to the same name, the
// highest-ranked one wins the key -- this used to be "whichever came first
// in the file", which is why typing "Broummana" in full and pressing the
// keyboard's Go key resolved to the hamlet in Keserwan even after the
// dropdown had been fixed to list the Matn one first. The two paths have to
// agree, or the field contradicts the menu it just offered you.
const byLowerName = new Map<string, LebanonPlace>();
for (const p of LEBANON_PLACES) {
  for (const k of [p.name, ...(p.nameAr ? [p.nameAr] : []), ...p.altNames]) {
    const lower = k.trim().toLowerCase();
    const held = byLowerName.get(lower);
    if (!held || byRankThenId(p, held) < 0) byLowerName.set(lower, p);
  }
}

function byRankThenId(a: LebanonPlace, b: LebanonPlace): number {
  return placeRank(b) - placeRank(a) || a.id - b.id;
}

// How well a place answers `q`, independent of how prominent it is.
// Higher wins; 0 means no match at all.
//
// The distinction between matching on the displayed name and matching on a
// buried alternate spelling is what stops a prominence score from running
// away with the results. "Hamra" used to return a village in Jezzine
// first: it is really called Mrah Abou Chdid, but it carries five
// alternate spellings -- two of which happen to begin "Hamra Abou..." --
// and those five spellings outscored Hamra in Beirut, which has one. A
// place whose actual name IS what you typed must come before a place that
// merely has a nickname starting the same way, however well-documented the
// second one is. Prominence only settles matches of equal quality.
const MATCH_NAME_EXACT = 4;
const MATCH_ALT_EXACT = 3;
const MATCH_NAME_PREFIX = 2;
const MATCH_ALT_PREFIX = 1;
const MATCH_ANYWHERE = 0.5;

function matchQuality(p: LebanonPlace, q: string): number {
  const primary = [p.name, ...(p.nameAr ? [p.nameAr] : [])].map((s) => s.toLowerCase());
  const alts = p.altNames.map((s) => s.toLowerCase());
  if (primary.some((h) => h === q)) return MATCH_NAME_EXACT;
  if (alts.some((h) => h === q)) return MATCH_ALT_EXACT;
  if (primary.some((h) => h.startsWith(q))) return MATCH_NAME_PREFIX;
  if (alts.some((h) => h.startsWith(q))) return MATCH_ALT_PREFIX;
  if (primary.some((h) => h.includes(q)) || alts.some((h) => h.includes(q))) return MATCH_ANYWHERE;
  return 0;
}

// Matches `query` against name/nameAr/altNames, ordered by how well each
// place matches and then by placeRank, so recognisable towns outrank
// obscure hamlets/cadastral zones on an ambiguous prefix.
// Mirrors SuggestInput's rankSuggestions ordering philosophy.
export function searchPlaces(query: string, limit = 8): LebanonPlace[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: { p: LebanonPlace; quality: number }[] = [];
  for (const p of LEBANON_PLACES) {
    const quality = matchQuality(p, q);
    if (quality > 0) hits.push({ p, quality });
  }
  hits.sort((a, b) => b.quality - a.quality || byRankThenId(a.p, b.p));
  return hits.slice(0, limit).map((h) => h.p);
}

export function findPlaceByExactName(name: string): LebanonPlace | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  return byLowerName.get(key) ?? null;
}

export function findPlaceById(id: number | null | undefined): LebanonPlace | null {
  if (id == null) return null;
  return byId.get(id) ?? null;
}

function normalizeFreeText(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Precomputed once at module load, not per call -- findPlaceByFreeText used
// to re-run normalizeFreeText (two regex passes) over every place's
// name+altNames on every single invocation, for every place in the ~1,700
// row dataset. That's static data; normalizing it once here instead of on
// every call is what actually removes the cost, not just moving it around.
// (Short keys are pre-filtered here too, so the per-call loop below never
// has to re-check the length-3 minimum.)
const freeTextCandidates: { key: string; place: LebanonPlace }[] = LEBANON_PLACES.flatMap((p) =>
  [p.name, ...p.altNames]
    .map((c) => normalizeFreeText(c))
    .filter((key, i, arr) => key.length >= 3 && arr.indexOf(key) === i)
    .map((key) => ({ key, place: p }))
);

// listingDistrict() (see ../lib/listingText.ts) calls this for every visible
// listing card, on every render -- including the mass re-render a language
// toggle triggers across the whole visible list. The same handful of district
// strings repeat across dozens of listings, so caching by raw input turns
// nearly every one of those calls into a Map lookup instead of a full rescan.
const freeTextCache = new Map<string, LebanonPlace | null>();

// Resolves a free-text location string (however it was typed -- "Achrafieh,
// Beirut", bare "Jounieh", extra punctuation, etc.) by finding every known
// place name contained in it and ranking the hits by, in order:
//
//   1. EARLIEST position in the string. People write location narrowest
//      first -- "Achrafieh, Beirut", "Hamra, Beirut", "Zouk Mosbeh,
//      Keserwan" -- so whatever they put first is the place they mean, and
//      the rest is context they added to help.
//   2. Longest match, which settles ties at the same position: in
//      "Bhamdoun el Mhatta" both "Bhamdoun" and "Bhamdoun el Mhatta" start
//      at 0, and the fuller name is the more specific one.
//   3. placeRank, for genuinely identical strings -- Lebanon has many
//      same-named villages in different cazas (two El Achrafiye, one in
//      Beirut and one in Saida; two Broummanas), and the more prominent is
//      the likelier meaning absent any other signal.
//
// Ranking by length alone (the previous rule) got "Achrafieh, Beirut"
// right only by accident and got "Hamra, Beirut" wrong: "Beirut" is one
// letter longer than "Hamra", so the general term beat the specific one
// and the pin landed on the city centre instead of the neighbourhood.
//
// Replaces lebanonDistricts.ts's `lookupDistrictCoords`, which relied on a
// hand-ordered 54-entry table to express the same "more specific wins"
// idea -- unnecessary once the ranking is derived from the string itself.
export function findPlaceByFreeText(freeText: string | null | undefined): LebanonPlace | null {
  if (!freeText) return null;
  if (freeTextCache.has(freeText)) return freeTextCache.get(freeText)!;
  const normalized = normalizeFreeText(freeText);
  if (!normalized) {
    freeTextCache.set(freeText, null);
    return null;
  }
  let best: LebanonPlace | null = null;
  let bestPos = Infinity;
  let bestLen = 0;
  for (const { key, place } of freeTextCandidates) {
    const pos = normalized.indexOf(key);
    if (pos < 0) continue;
    const better =
      pos < bestPos ||
      (pos === bestPos &&
        (key.length > bestLen ||
          (key.length === bestLen && best !== null && byRankThenId(place, best) < 0)));
    if (better) {
      best = place;
      bestPos = pos;
      bestLen = key.length;
    }
  }
  freeTextCache.set(freeText, best);
  return best;
}

// Nearest-locality lookup for the map pin-drop / geolocation reverse-
// resolve. Plain linear haversine scan -- at ~3,700 rows this is
// sub-millisecond even on weak mobile CPUs, and it only ever runs on
// discrete events (marker dragend/click, geolocation resolved), never per
// animation frame, so a spatial index isn't justified here.
export function nearestPlace(coords: LatLng): LebanonPlace | null {
  let best: LebanonPlace | null = null;
  let bestDist = Infinity;
  for (const p of LEBANON_PLACES) {
    const d = haversineKm(coords, { lat: p.lat, lng: p.lng });
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}
