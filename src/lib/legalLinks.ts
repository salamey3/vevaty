import { Linking } from 'react-native';
import { Language } from '../i18n/translations';

// About Us / Privacy Policy / Terms & Conditions are deliberately NOT React
// screens -- see AGENTS.md on how fragile the OTA/fingerprint setup is, and
// WORKFLOW.md/DEPLOY.md on this app's release pipeline. They're static HTML
// files that ride alongside dist/index.html: build-standalone.mjs copies
// them from legal/ into dist/ on every `npm run build:web`, and
// deploy-web.mjs uploads them next to index.html on every `npm run
// deploy:web`. Opening them by absolute URL (not a relative path) works
// identically from the web build and from the native Android app, where
// there is no "current origin" to resolve a relative link against.
const SITE_ORIGIN = 'https://vevaty.com';

export type LegalPageKey = 'about' | 'privacy' | 'terms';

// Each page has an English and an Arabic sibling (about.html / about-ar.html,
// etc) -- both are plain hand-maintained HTML in legal/, built by
// website/build_*_ar.js in the docs workspace, not generated from the app's
// translations.ts. Keep these filenames in sync with legal/*.html and the
// FILES list in deploy-web.mjs -- renaming one without the other silently
// 404s the link.
export const LEGAL_PATHS: Record<LegalPageKey, Record<Language, string>> = {
  about: { en: '/about.html', ar: '/about-ar.html' },
  privacy: { en: '/privacy-policy.html', ar: '/privacy-policy-ar.html' },
  terms: { en: '/terms.html', ar: '/terms-ar.html' },
};

export function legalUrl(key: LegalPageKey, lang: Language = 'en'): string {
  return `${SITE_ORIGIN}${LEGAL_PATHS[key][lang] ?? LEGAL_PATHS[key].en}`;
}

// On web this opens a new tab, so a visitor reading the Terms doesn't lose
// their place (search filters, an in-progress listing draft) in the SPA
// underneath. On native it hands off to the device's browser, same as any
// other external link. `lang` should be the caller's current
// useLanguage().language, so a reader on the Arabic UI lands on the Arabic
// document instead of the English one -- see the bug this fixed (2026-08-21):
// the nav labels were already translated, but every link pointed at the
// English-only file regardless of UI language.
export function openLegalPage(key: LegalPageKey, lang: Language = 'en') {
  Linking.openURL(legalUrl(key, lang));
}
