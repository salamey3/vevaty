// Curated Arabic display names for the districts our listings actually use,
// for the cases the GeoNames dataset cannot serve correctly on its own.
//
// Every entry below was added because of a specific, verified failure found
// by auditing all active listings' `district` values against
// findPlaceByFreeText() -- not defensively. The comment on each says which
// kind of failure it is, so a future refresh of lebanonPlacesData.ts can
// drop any entry GeoNames has since fixed.
//
// Keys are normalised (lowercase, letters and spaces only) -- see
// normalizeDistrictKey in ../lib/listingText.ts.
export const DISTRICT_NAME_AR: Record<string, string> = {
  // NOT IN THE DATASET AT ALL. GeoNames has no entry for Beirut's Hamra
  // district; every "hamra" row it does have is a different village
  // elsewhere (Qornet el Hamra in Matn, Mazraat el Hamra in Nabatieh, ...).
  // Without this, "Hamra, Beirut" fell through to matching just "Beirut".
  hamra: 'الحمرا',

  // IN THE DATASET, BUT nameAr IS NULL. GeoNames knows `Verdun` (caza
  // Beirut) but carries no Arabic name for it, so it rendered in English.
  verdun: 'فردان',

  // IN THE DATASET UNDER A DIFFERENT TRANSLITERATION. GeoNames spells this
  // `Ez Zalqa` (nameAr الزلقا) with alt names Az Zalqa / Az Zalqa' / alzlqa
  // -- none of which is "Zalka", so the q/k difference meant no match at
  // all and the district stayed English.
  zalka: 'الزلقا',

  // MATCHES, BUT nameAr IS NULL. GeoNames' `Dbaiye` does list "Dbayeh" as
  // an alt name, so the lookup succeeds -- it just has no Arabic name to
  // return.
  dbayeh: 'ضبية',

  // DATASET RETURNS THE WRONG REGISTER. GeoNames resolves Jbeil to
  // `Byblos` (بيبلوس), the Greek/archaeological name. Lebanese sellers and
  // buyers call the town جبيل -- which is also what GeoNames itself names
  // the surrounding caza.
  jbeil: 'جبيل',

  // DATASET VALUE IS MALFORMED. GeoNames' Arabic name for Antelias is
  // "أنطلیاس", which contains U+06CC (Persian/Farsi yeh ی) where Arabic
  // uses U+064A (ي). It renders, but it is the wrong character for Arabic
  // text and would break any exact-match search against it.
  antelias: 'أنطلياس',
};
