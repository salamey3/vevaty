import { Platform } from 'react-native';

// Swaps the browser tab favicon at runtime. The static ./assets/favicon.png
// baked into the exported HTML by Expo is still what shows for an instant
// before JS runs (and offline) -- this is what lets an admin-uploaded
// favicon take over after that, with no rebuild/redeploy.
export function applyFavicon(url?: string | null) {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || !url) return;
  let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = url;
}
