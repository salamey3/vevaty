import { Linking } from 'react-native';

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

// Keep these filenames in sync with legal/*.html and the FILES list in
// deploy-web.mjs -- renaming one without the other silently 404s the link.
export const LEGAL_PATHS: Record<LegalPageKey, string> = {
  about: '/about.html',
  privacy: '/privacy-policy.html',
  terms: '/terms.html',
};

export function legalUrl(key: LegalPageKey): string {
  return `${SITE_ORIGIN}${LEGAL_PATHS[key]}`;
}

// On web this opens a new tab, so a visitor reading the Terms doesn't lose
// their place (search filters, an in-progress listing draft) in the SPA
// underneath. On native it hands off to the device's browser, same as any
// other external link.
export function openLegalPage(key: LegalPageKey) {
  Linking.openURL(legalUrl(key));
}
