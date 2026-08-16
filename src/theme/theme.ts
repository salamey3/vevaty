import { Platform } from 'react-native';

// Vevaty design tokens — kept in sync with the clickable web prototype
// (myazar-prototype.html, from the app's original working name) so the real
// app matches the approved look: charcoal ink, off-white surfaces, minimal
// color, glass cards, no emoji icons.
//
// `ink` and `heroA`/`heroB` are wired through CSS custom properties
// (--vevaty-primary / --vevaty-accent) on web, instead of plain hex
// strings. This is what lets the admin panel's branding editor change the
// app's color scheme live, for every user, with no rebuild:
// applyBrandColors() below just updates the custom properties on <html>,
// and every component that already reads colors.ink / colors.heroA
// (StyleSheet.create calls included, since they're plain strings baked in
// at import time) re-reads the new value automatically -- var() is
// resolved by the browser at paint time, not when the style object was
// created. Verified this also works for react-native-svg's stroke/fill
// attributes on web, which is how every icon in the app gets its color.
//
// On real native rendering (the Android/iOS build added for the map
// locator feature -- see LocationMapPicker.native.tsx) there is no
// browser/DOM/CSS layer at all: a raw "var(--x, #hex)" string is not a
// valid React Native color value, so every one of these would silently
// fail to render its intended color app-wide, not just on the map. Native
// falls back to the plain hex value instead -- it just won't repaint live
// when the admin changes branding in-session the way web does (would need
// a separate mechanism, e.g. re-fetching site_settings into component
// state and re-rendering; tracked as a follow-up, not blocking here).
const ink = Platform.OS === 'web' ? 'var(--vevaty-primary, #2b2b2f)' : '#2b2b2f';
const heroA = Platform.OS === 'web' ? 'var(--vevaty-accent, #4c4d52)' : '#4c4d52';
const heroB = Platform.OS === 'web' ? 'var(--vevaty-primary, #2a2a2e)' : '#2a2a2e';

export const colors = {
  ink,
  inkSoft: '#7a7a78',
  line: '#e6e6e3',
  bg: '#f5f5f3',
  card: '#ffffff',
  surface: '#f0f0ee',
  heroA,
  heroB,
  glassBg: 'rgba(255,255,255,0.6)',
  glassBorder: 'rgba(255,255,255,0.7)',
  white: '#ffffff',
  danger: '#b3413a',
  success: '#3c6e52',
  warnBg: '#fff7cc',
};

// Called once site_settings loads from Supabase (and again whenever the
// admin saves a branding change). No-op on native, where there's no
// document/CSS custom property mechanism -- this app ships web-only.
export function applyBrandColors(primaryHex?: string | null, accentHex?: string | null) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const root = document.documentElement;
  if (primaryHex) root.style.setProperty('--vevaty-primary', primaryHex);
  if (accentHex) root.style.setProperty('--vevaty-accent', accentHex);
}

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
};

export const spacing = (n: number) => n * 4;

export const shadow = {
  card: {
    shadowColor: '#18181a',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  glass: {
    shadowColor: '#18181a',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
};

// Font family wired the same way as colors.ink above: `--vevaty-font` is a
// CSS custom property applied to <html> by applyFontFamily() (see
// src/theme/fonts.ts), swapped between an Inter stack and an Almarai+Inter
// stack whenever LanguageContext's active language changes. The fallback
// value here (before the property is ever set, e.g. very first paint) is
// plain Inter, since 'en' is the app's default language.
// Native has no CSS var() support either (same issue as colors.ink above)
// -- falls back to the OS system font there. The embedded Inter/Almarai
// font files in fonts.ts are injected as web @font-face rules only
// (ensureFontsInjected() is already a no-op off web); real native font
// loading would need expo-font + a bundled font asset, a separate,
// non-blocking follow-up.
const FONT_FAMILY = Platform.OS === 'web'
  ? "var(--vevaty-font, 'Inter', system-ui, -apple-system, sans-serif)"
  : 'System';

export const type = {
  title: { fontSize: 26, fontWeight: '600' as const, color: colors.ink, letterSpacing: -0.3, fontFamily: FONT_FAMILY },
  h2: { fontSize: 19, fontWeight: '600' as const, color: colors.ink, letterSpacing: -0.2, fontFamily: FONT_FAMILY },
  h3: { fontSize: 15, fontWeight: '600' as const, color: colors.ink, fontFamily: FONT_FAMILY },
  body: { fontSize: 14.5, fontWeight: '400' as const, color: colors.ink, fontFamily: FONT_FAMILY },
  soft: { fontSize: 13, fontWeight: '400' as const, color: colors.inkSoft, fontFamily: FONT_FAMILY },
  tiny: { fontSize: 11.5, fontWeight: '500' as const, color: colors.inkSoft, fontFamily: FONT_FAMILY },
};
