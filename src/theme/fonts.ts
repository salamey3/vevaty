// Inter (Latin) + Almarai (Arabic), self-hosted as real .woff2 files in
// public/fonts/ and injected as @font-face CSS into <head> at app startup
// (see ensureFontsInjected() below). Self-hosted rather than linked from
// Google Fonts' CDN so a slow, flaky or blocked third party can never cost
// this app its typography.
//
// They used to be base64-embedded in THIS FILE, because the website
// deployed as one self-contained index.html and a font file that was never
// uploaded would simply not exist. That constraint is gone (the site is a
// shell plus a hashed bundle now -- see DEPLOY.md), and the embedding was
// costing every single visitor 162 KB COMPRESSED: base64 inflates a file
// by a third, the result sat inside the JS bundle where it could not be
// cached separately, and it was 15% of the entire first-visit download.
// Measured, not estimated.
//
// As real files the browser does what browsers are good at: fetches each
// weight only if the page actually uses it, caches them for a month, and
// never asks again. Expo copies public/ into dist/ verbatim on export, so
// /fonts/... resolves in development and in production without a build
// step -- and the fingerprint that decides whether over-the-air updates
// reach installed apps is unchanged by adding that directory (checked,
// both before and after: 543df3a5...).
//
// IF YOU EVER REPLACE A FONT FILE, RENAME IT. The URL is the cache key,
// and these are served with a long max-age; same name means a visitor who
// has been here before keeps the old one.
//
// Weight coverage: Inter ships 400/500/600/700, which is every fontWeight
// value used anywhere in the app (see theme.ts's `type` presets and a
// repo-wide grep for `fontWeight`). Almarai's available static weights are
// only 300/400/700/800 -- 400 and 700 are here; a component requesting 500
// or 600 while in Arabic mode gets the browser's normal
// nearest-available-weight fallback, which is standard CSS, not a bug.
//
// Almarai is the ARABIC-SCRIPT SUBSET ONLY, with a `unicode-range`
// restricting it to Arabic code points. That has a second benefit now that
// these are separate files: a browser does not download a font whose
// unicode-range never matches anything on the page, so an English-only
// visitor never fetches Almarai's 65 KB at all. Latin characters inside
// Arabic UI (USD prices, the "AR"/"EN" toggle) fall through to Inter via
// the font-family fallback list in applyFontFamily() below.

import { Platform } from 'react-native';

// Served from public/fonts/, which Expo copies to dist/fonts/ on export
// and deploy-web.mjs uploads alongside the bundle.
const FONT_DIR = '/fonts';

// Standard Arabic-script Unicode ranges (Arabic, Arabic Supplement, Arabic
// Extended-A, Presentation Forms A/B) -- matches what Google Fonts itself
// serves as the "arabic" subset for this family.
const ARABIC_UNICODE_RANGE =
  'U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0898-08E1, U+08E3-08FF, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC';

type FontSpec = { family: 'Inter' | 'Almarai'; weight: number; file: string; unicodeRange?: string };

// Exported so build-standalone.mjs can emit a <link rel="preload"> for the
// Latin weights into the HTML shell. Without that the fetch would not start
// until this file runs, i.e. after the whole JS bundle has arrived, and the
// first text painted would be system-ui swapping to Inter a moment later.
// Preloaded from the shell instead, the fonts are fetched in PARALLEL with
// the bundle and are always there before React can paint anything.
export const FONT_FILES: FontSpec[] = [
  { family: 'Inter', weight: 400, file: 'inter-400.woff2' },
  { family: 'Inter', weight: 500, file: 'inter-500.woff2' },
  { family: 'Inter', weight: 600, file: 'inter-600.woff2' },
  { family: 'Inter', weight: 700, file: 'inter-700.woff2' },
  { family: 'Almarai', weight: 400, file: 'almarai-400-arabic.woff2', unicodeRange: ARABIC_UNICODE_RANGE },
  { family: 'Almarai', weight: 700, file: 'almarai-700-arabic.woff2', unicodeRange: ARABIC_UNICODE_RANGE },
];

function fontFace({ family, weight, file, unicodeRange }: FontSpec) {
  return `@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url(${FONT_DIR}/${file}) format('woff2');${unicodeRange ? `\n  unicode-range: ${unicodeRange};` : ''}
}`;
}

const FONT_CSS = [
  ...FONT_FILES.map(fontFace),
  // Root-level rule so every piece of text in the app picks up the active
  // language's font stack via ordinary CSS inheritance, not just the ones
  // that go through theme.ts's `type` presets (which also set fontFamily
  // explicitly -- belt and suspenders, not a conflict: same var()).
  `html, body, #root { font-family: var(--vevaty-font, 'Inter', system-ui, -apple-system, sans-serif); }`,
].join('\n\n');

let injected = false;

// Call once at app startup (see LanguageContext.tsx). No-op on native/SSR,
// same guard pattern as applyBrandColors/applyFavicon elsewhere in the app.
export function ensureFontsInjected() {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || injected) return;
  injected = true;
  const style = document.createElement('style');
  style.setAttribute('data-vevaty-fonts', 'true');
  style.textContent = FONT_CSS;
  document.head.appendChild(style);
}

// Swaps the --vevaty-font custom property between the English and Arabic
// stacks. Called from LanguageContext.tsx alongside applyDocumentDirection
// (both on initial restore from storage and on every setLanguage), so the
// active UI language always drives which font is showing -- 'Almarai' for
// Arabic script, falling back to 'Inter' for any Latin characters mixed
// into Arabic-language screens (prices, the language toggle itself).
export function applyFontFamily(lang: 'en' | 'ar') {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const stack =
    lang === 'ar'
      ? "'Almarai', 'Inter', system-ui, -apple-system, sans-serif"
      : "'Inter', system-ui, -apple-system, sans-serif";
  document.documentElement.style.setProperty('--vevaty-font', stack);
}
