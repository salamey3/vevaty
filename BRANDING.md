# Vevaty brand

The single source of truth for the brand. Anything visual — a logo file, an
icon, a colour, a typeface — is decided here first and generated from here.
If a value in the app disagrees with this file, this file is right and the
app is a bug.

Built from scratch in August 2026. Everything that existed before this
(the stock Expo icon, the "diamond" glyph in a rounded square, the
placeholder charcoal palette) was placeholder art and carries no weight.

Status: **complete** — all seven parts approved.

| # | Part | Status |
|---|------|--------|
| 1 | The mark | ✅ approved |
| 2 | Wordmark + lockups (EN/AR) | ✅ approved |
| 3 | Colour | ✅ approved |
| 4 | Typography | ✅ approved (unchanged) |
| 5 | App icon (iOS / Android adaptive / monochrome) | ✅ approved |
| 6 | Favicon + splash | ✅ approved |
| 7 | Social / OG image | ✅ approved |

---

## 1. The mark — "Tag" ✅

A price tag with the **V** punched clean through it, plus a round eyelet.

**Why this one.** It is unmistakably a marketplace object, it carries the
initial without spelling anything out, and it is the only one of the four
candidates that held together at 16 px — the size a browser tab and an
Android notification actually get. Chosen over a shopping bag (too common
in commerce apps, and the V inside one reads like a download arrow), an
open ring (reads as a check-in-a-circle when small), and a plain two-stroke
V (timeless but generic).

### Construction

Drawn on a **64 × 64 grid**. One path, `fill-rule="evenodd"`, three
subpaths: the tag body, the eyelet, and the V. The eyelet and the V are
**real holes, not white shapes**. That is the whole point — the mark drops
onto any colour, photo or dark field with no backdrop and no second
variant, and it survives Android's monochrome icon treatment, which
flattens everything to a single colour and would destroy a mark that
faked its voids with white fills.

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" fill="currentColor"
        d="M30 8h20a6 6 0 0 1 6 6v20a6 6 0 0 1-1.76 4.24L36.24 56.24a6 6 0 0 1-8.48 0L7.76 36.24a6 6 0 0 1 0-8.48L25.76 9.76A6 6 0 0 1 30 8zM49.7 18.5a4.2 4.2 0 1 0-8.4 0 4.2 4.2 0 0 0 8.4 0zM23.6 25.4 32 35.6l8.4-10.2 4.7 4.5L32 45.6 18.9 29.9z"/>
</svg>
```

`fill="currentColor"` on purpose: the mark inherits its colour from
context rather than hard-coding one, so the same file serves light, dark
and monochrome.

### Rules

- **Never** re-colour the holes. If the V or the eyelet is ever filled in
  rather than punched out, it is being drawn wrong.
- Minimum size **16 px**. Below that use no mark at all rather than a
  smudge.
- Clear space on all four sides: **one eyelet diameter** (8 units on the
  64-grid, i.e. 12.5% of the mark's width).
- Do not rotate it. The tag already sits on a diagonal by construction;
  rotating it reads as a mistake.
- Do not outline it, add a shadow to it, or place it inside a second
  container shape when it is already on a plain field.

---

## 2. Wordmark ✅

### English — `vevaty`

Set in **Cairo Bold (700)**, **all lowercase**, tracking `-0.5px` at 40px
(≈ `-0.0125em`). Never 800 — it thickens enough to out-shout the mark.

Lowercase is deliberate: it keeps the name approachable and reads as a
product rather than an institution. It is lowercase *everywhere*, including
at the start of a sentence and in the app store listing. The only places
the name takes a capital are ordinary prose written by people (this file
included) and legal/company documents.

### Arabic — `ڤيڤاتي`

Set in **Cairo Bold (700)**, right-to-left.

Spelled with **ڤ** (feh with three dots, U+06A4), not ف. Arabic has no
native V; ڤ is the borrowed letter Lebanese speakers use for foreign
V-names, so the written name and the spoken name agree. ف would have made
it read "Fifaty".

The ڤ glyph is missing from some older system fonts. That is a real risk
for *body text* and a non-issue for the logo, because the logo ships as
artwork, not as live text.

### Typeface

**Cairo Bold**, both scripts, one family — so Latin and Arabic share a
skeleton instead of looking like two brands stapled together. Chosen over
IBM Plex Sans Arabic (tighter bilingual match, but colder) and Tajawal
(more elegant Arabic, plainer Latin) for being the most readable and most
familiar face in the region.

Licence: SIL Open Font License 1.1 — free for commercial use and
embedding. Fetched at design time from `@fontsource/cairo`.

**This is a design-time dependency only.** The wordmark is rendered to
artwork from the font; neither the app nor the website loads Cairo to
display the logo. What the *interface* is set in is a separate decision
(Part 4) and does not have to be Cairo.

### Lockup

Mark on the leading side, wordmark following — so the mark is on the left
in English and **on the right in Arabic**. The lockup mirrors with the
language; it is never left-aligned in an RTL layout.

- Gap between mark and wordmark: **0.30 × the mark's height**.
- Mark height ≈ **1.15 × the Latin cap height**, optically centred on the
  lowercase x-height rather than mathematically centred on the line box.
- Arabic sets **≈0.9 ×** the Latin point size. Arabic letterforms read
  optically larger at the same nominal size, and matching the numbers
  makes the Arabic lockup look inflated next to the English one.
- Minimum lockup width **96 px**. Below that, drop the wordmark and use
  the mark alone.

---

## 3. Colour — "Forest & gold" ✅

Deep green carries the two things this app needs people to believe: that
handing money to a stranger here is safe, and that buying used is worth
doing. Nobody in this market owns green — OLX is purple, Dubizzle is red,
Facebook Marketplace is blue — and green avoids the Lebanese flag's
red-and-green pairing, which reads political rather than commercial.

Gold is a **rare** colour, not a secondary brand colour. It appears on
prices, the verified badge, and the single "sell" call to action. If a
screen has gold in three places, two of them are wrong.

### Tokens

| Token | Hex | Used for |
|---|---|---|
| `primary` | `#0F3D2E` | the mark, primary buttons, prices, links |
| `primaryPressed` | `#0A2E22` | pressed/active state of primary |
| `primaryTint` | `#E3EDE8` | quiet primary backgrounds — chips, selected rows |
| `accent` | `#D9A441` | the "sell" CTA, verified badge fill |
| `accentInk` | `#2A1F06` | text **on** accent (never white — it fails contrast) |
| `accentTint` | `#F6EBD3` | badge backgrounds |
| `accentDeep` | `#7A5A16` | text on `accentTint` |
| `ink` | `#1C2420` | body text — near-black, warmed green so it sits with the brand |
| `inkSoft` | `#626A67` | secondary text, captions, metadata |
| `bg` | `#F4F3EE` | page background |
| `card` | `#FFFFFF` | cards, sheets, inputs |
| `surface` | `#EDEBE3` | image placeholders, inset wells |
| `line` | `#E4E2DA` | hairline borders |
| `success` | `#1F5E43` | confirmations (distinct from `primary`, deliberately) |
| `danger` | `#A3332F` | destructive actions, rejection notices |
| `warn` | `#B9822B` | under-review / pending states |

`primary` and `accent` map to the existing `--vevaty-primary` and
`--vevaty-accent` CSS custom properties, so the admin branding editor keeps
working and can still override them live without a rebuild.

### Contrast

Every pairing in the table above was measured, not eyeballed. All clear
WCAG AA; most clear AAA. Two results worth keeping:

- **`inkSoft` is `#626A67`, not something lighter.** The first value tried
  (`#6B7370`) measured 4.38:1 on `bg` — under the 4.5 threshold for body
  text. `#626A67` is the lightest value that clears AA on all three of
  `bg`, `surface` and `card`. Do not lighten it back for looks.
- **Text on `accent` is `accentInk`, never white.** White on `#D9A441` is
  about 2:1 and fails outright.

### Rules

- The mark is `primary` on light, and white (or `accentTint`) reversed on
  `primary`. It is never gold — gold is for moments, and a logo is not a
  moment.
- Never put `accent` next to `danger`; at small sizes the two warm tones
  are hard to tell apart, which matters because one means "pay attention"
  and the other means "this failed".
- Photographs are the loudest thing on any screen in this app. Chrome stays
  in the neutral range so listing photos carry the colour.

---

## 4. Typography ✅ — keep what is already there

**Inter** for Latin, **Almarai** for Arabic. Unchanged, by decision: it
already works and it already looks right.

Both are self-hosted and base64-embedded into the bundle as `@font-face`
rules injected at startup (`src/theme/fonts.ts`), not fetched from a CDN —
correct for an app that deploys as one self-contained `index.html`, since a
font CDN would mean unstyled text on a slow or offline connection.

- Inter: 400 / 500 / 600 / 700 — every weight the codebase actually uses.
- Almarai: 400 / 700, **Arabic subset only**, bounded by a `unicode-range`.
  Latin characters inside Arabic strings fall through to Inter
  automatically via the font-family fallback list, which is plain CSS
  rather than custom logic — and looks better, since Almarai's Latin is a
  poor stylistic match for Inter-drawn chrome.
- `applyFontFamily(lang)` swaps the stack when the language changes.

### Two things this leaves open

- **ڤ is safe here.** Decoding the embedded Almarai subset confirms
  U+06A4 is present, so the Arabic brand name renders in body text and
  not just in the logo. Re-check this if the subset is ever regenerated.
- **This mechanism is web-only.** It injects CSS into `<head>`, so the
  native Android/iOS build falls back to system fonts and does *not* get
  Inter or Almarai. The app and the website are therefore set in different
  typefaces today. Out of scope for branding; worth fixing later with
  `expo-font`.

### Relationship to the wordmark

The logo is Cairo; the interface is Inter/Almarai. That is deliberate and
normal — a logo should be distinctive, an interface should be invisible.
The wordmark is artwork, so the two never have to resolve to the same font
file. Do not "fix" the mismatch by resetting the logo in Inter.

### Fix owed to Part 2

`src/i18n/translations.ts` currently writes the Arabic name as **فيفاتي**
(`nav.footer`, `listingDetail.whatsappMessage`) and as Latin "Vevaty"
elsewhere (`sellerProfile.unknownSeller`, `sellerProfile.shareText`). Per
Part 2 the Arabic name is **ڤيڤاتي**, and Arabic strings should use it
consistently rather than mixing scripts.

---

## 5. App icon ✅ — solid green, white mark

Flat `#0F3D2E`. Mark in white, centred, at **52% of the canvas width**.
No gradient: it would band on cheap screens, add nothing below 64 px, and
reproduce inconsistently in print.

52% is not an aesthetic choice. Android's adaptive icon reserves the outer
third of the canvas for the launcher to crop — only the central **66%
circle** is guaranteed visible, and a launcher may mask to a circle, a
squircle, a rounded square or a plain square. At 52% the mark clears that
safe circle under every mask with margin to spare.

### Files to generate

| File | Size | Contents |
|---|---|---|
| `assets/icon.png` | 1024×1024 | full green square, white mark. **No transparency, no pre-rounded corners** — iOS masks it itself, and a pre-rounded PNG gets rounded twice |
| `assets/android-icon-background.png` | 512×512 | flat `#0F3D2E`, nothing else |
| `assets/android-icon-foreground.png` | 512×512 | white mark on transparent, at 52% |
| `assets/android-icon-monochrome.png` | 432×432 | the mark as a **solid silhouette on transparent** |
| `assets/splash-icon.png` | 1024×1024 | white mark on transparent |

### Monochrome

Android 13+ themed icons throw away the colours entirely and re-tint the
silhouette to match the user's wallpaper. Only the *shape* survives — which
is exactly why the mark is a solid form whose V and eyelet are real holes.
A mark that faked its voids with white fill would come out as a featureless
blob here. Do not supply a monochrome file with any colour in it.

---

## 6. Favicon and splash ✅

### Favicon — green tile, white mark

The app icon, shrunk: `#0F3D2E` tile, white mark. Not the bare mark on
transparent. At 16 px the tile is what makes it read as an object rather
than a smudge, and it holds its own against a pale tab strip.

Ship `favicon.ico` containing **16, 32 and 48 px** — browsers pick per
context and a single-size ico gets scaled badly in bookmark bars.

### Splash — cream, matching the app

Background `#F4F3EE`, mark in `#0F3D2E`, wordmark beneath.

Cream rather than the more obvious brand green, on purpose: the app opens
into `#F4F3EE`, so a cream splash has no dark-to-light flash — the splash
simply becomes the app. A green splash would be a stronger brand moment and
a visible stutter, and a splash that is on screen for under a second should
buy speed, not attention.

## 7. Share image ✅ — green

1200 × 630, `#0F3D2E` ground, white headline in Cairo Bold, lockup bottom
left. This is the single most-seen brand asset for a marketplace in
Lebanon, because links get pasted into WhatsApp far more than anywhere
else — and a WhatsApp thread is a pale background, so the green card carves
out its own space instead of dissolving into the chat. Cream tested weaker
at thumbnail size.

Green here is deliberate even though the splash is cream: they solve
opposite problems. The splash is trying not to be noticed; the share card
exists to be noticed.

---

## Generating the assets

Nothing in `assets/` is drawn by hand. Everything derives from the geometry
and tokens above:

```
npm run brand
```

- `scripts/brand/mark.svg` — the one piece of source geometry.
- `scripts/generate-brand-assets.mjs` — rasterises every mark-only asset
  (app icon, adaptive layers, monochrome, favicon, splash) with `sharp`.
- `scripts/brand/wordmark.html` — source for the assets that contain type
  (logos, share image), rendered with the real Cairo font.

To change an asset, change the spec or the source and re-run. Do not open
a PNG in an editor — the next regeneration silently reverts it.

---

## Where the brand lives in the code

| Concern | File |
|---|---|
| Colour tokens | `src/theme/theme.ts` |
| Brand colour defaults (feed `applyBrandColors`) | `src/data/categories.ts` → `DEFAULT_SITE_SETTINGS` |
| The mark, as a component | `src/components/VevatyMark.tsx` |
| The lockup (mark + wordmark, RTL-aware) | `src/components/BrandMark.tsx` |
| Icons, splash, adaptive icon config | `app.json` |
| Favicon, theme-colour, share-image meta | `build-standalone.mjs` |
| Brand name in copy (EN + AR) | `src/i18n/translations.ts` |

### Two traps worth knowing about

**`site_settings` outranks the code.** The admin branding editor writes
`brand_primary_color` / `brand_accent_color` / `logo_*_url` to the database,
and `applyBrandColors()` pushes those onto `--vevaty-primary` /
`--vevaty-accent` at startup. That means a stale row silently repaints the
whole app in the old colours no matter what `theme.ts` says — which is
exactly what happened the first time this rebrand was applied, and it looked
like the change simply hadn't worked. `DEFAULT_SITE_SETTINGS` and the live
row both had to be updated.

The same applies to logos: if `logo_en_url` / `logo_ar_url` are set,
`BrandMark` renders those images and ignores the built-in lockup entirely.
They were pointing at the old placeholder artwork and had to be cleared.
Uploading a logo through the admin panel will override the built-in lockup
again — which is the intended behaviour, just worth knowing before wondering
why an edit to `BrandMark.tsx` had no effect.

**`ink` is no longer the brand colour.** It used to be both the body text
colour and the button colour, which is why every button matched the
paragraph next to it. Text is `ink`; anything that carries the brand —
buttons, selected states, the mark, prices — is `primary`.

---

## Category icons

The icon disc carries the brand: **forest green disc, cream glyph**, label
underneath unchanged in `ink`. It used to be a pale grey disc with a dark
glyph, which read as a disabled control rather than a category.

Selection can no longer be "turn the disc green", because every disc is
green now. The selected disc flips to **accent gold with an `accentDeep`
ring**, and its label goes bold.

The ring is not decoration. The gold fill reads clearly against its green
siblings (5.4:1) — which is what actually communicates *which* one is
selected — but only 2:1 against the cream page, under the 3:1 WCAG asks of
a state indicator's own edge. The darker ring gives the disc a defined
boundary (5.7:1) without dulling the fill.

Two components must stay in step, because they sit side by side in the same
strip and any drift between them is immediately visible:

- `src/components/CategoryCard.tsx` — the category chips
- `src/screens/HomeScreen.tsx` — the "All" chip (`allChipIconWrap*`)

Uploaded category icons (`categories.icon_url`) are inset to 72% rather
than filling the disc, so a custom icon sits *inside* the brand colour
instead of painting over it. No category uses one today; this only shapes
what happens the first time one does.
