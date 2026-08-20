// Turns a shop's display name into a URL-safe slug for vevaty.com/shop/:slug
// -- e.g. "Karam Motors" -> "karam-motors". Deliberately simple (ASCII
// letters/digits only, everything else becomes a hyphen): a merchant's
// name_en is nearly always Latin script since it's also their storefront's
// public English label, and a slug built from Arabic text would need
// transliteration to stay readable in a URL, which isn't worth the
// complexity for a first version. A name with no Latin characters at all
// (falls through to '') is handled by the caller (createShop in
// AppStore.tsx), which falls back to "shop" before appending the
// uniqueness suffix.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents (Cafe -> Cafe)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
