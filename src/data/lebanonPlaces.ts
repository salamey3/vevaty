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
const byLowerName = new Map<string, LebanonPlace>();
for (const p of LEBANON_PLACES) {
  const keys = [p.name, ...(p.nameAr ? [p.nameAr] : []), ...p.altNames];
  for (const k of keys) {
    const lower = k.trim().toLowerCase();
    // First place wins a given exact-name key (population-sorted data would
    // be nicer, but LEBANON_PLACES isn't guaranteed sorted -- exact-name
    // lookup is a convenience fallback for unambiguous names; genuinely
    // ambiguous same-named villages in different cazas are why the search
    // dropdown always shows "Town — Caza, Governorate", not just the name).
    if (!byLowerName.has(lower)) byLowerName.set(lower, p);
  }
}

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

function byRankThenId(a: LebanonPlace, b: LebanonPlace): number {
  return placeRank(b) - placeRank(a) || a.id - b.id;
}

// Matches `query` against name/nameAr/altNames -- prefix matches first, then
// anywhere-in-string, each group ranked by placeRank so recognisable towns
// outrank obscure hamlets/cadastral zones on an ambiguous prefix.
// Mirrors SuggestInput's rankSuggestions ordering philosophy.
export function searchPlaces(query: string, limit = 8): LebanonPlace[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const starts: LebanonPlace[] = [];
  const contains: LebanonPlace[] = [];
  const seen = new Set<number>();
  for (const p of LEBANON_PLACES) {
    if (seen.has(p.id)) continue;
    const haystacks = [p.name, ...(p.nameAr ? [p.nameAr] : []), ...p.altNames].map((s) => s.toLowerCase());
    const startsHit = haystacks.some((h) => h.startsWith(q));
    const containsHit = !startsHit && haystacks.some((h) => h.includes(q));
    if (startsHit) { starts.push(p); seen.add(p.id); }
    else if (containsHit) { contains.push(p); seen.add(p.id); }
  }
  starts.sort(byRankThenId);
  contains.sort(byRankThenId);
  return [...starts, ...contains].slice(0, limit);
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
