import { Platform, Share } from 'react-native';

// Same constant, same reasoning, as legalLinks.ts's SITE_ORIGIN: on native
// there is no window.location to read an origin from, so sharing from the
// app needs a real absolute domain to fall back to. Duplicated rather than
// imported -- legalLinks.ts doesn't export its copy, and this is a single
// literal already kept in sync by hand in a few places (build-og.mjs,
// ship.mjs) rather than a shared module.
const SITE_ORIGIN = 'https://vevaty.com';

export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'error';

// One place for "share a page of this app" -- web and native need
// genuinely different mechanisms (there's no Web Share API or clipboard on
// navigator in React Native, and no native share sheet on the web), so
// this is the single spot that branches on Platform.OS rather than every
// call site reimplementing both halves.
//
// `path` is an app-relative path starting with '/', e.g.
// '/listing/abc123' or '/seller/abc123' -- see RootNavigator's linking
// config for the full list of paths a listing/seller/etc. resolves to.
export async function shareLink({
  path,
  title,
  text,
}: {
  path: string;
  title: string;
  text: string;
}): Promise<ShareOutcome> {
  const url =
    Platform.OS === 'web' && typeof window !== 'undefined' ? `${window.location.origin}${path}` : `${SITE_ORIGIN}${path}`;

  if (Platform.OS !== 'web') {
    // React Native's own Share module -- already part of core RN, no extra
    // dependency needed. iOS reads the separate `url` field; Android has
    // no such field at all and only ever surfaces `message` in whatever
    // app the person shares to, so the link has to be embedded in the text
    // there for it to actually reach anyone on that platform.
    try {
      const result = await Share.share(
        Platform.OS === 'ios' ? { title, message: text, url } : { title, message: `${text}\n${url}` },
      );
      // dismissedAction is iOS-only (RN docs) -- Android's Share.share
      // resolves as "shared" regardless of what the person actually did
      // with the sheet, since the OS doesn't report that back.
      return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
    } catch {
      return 'error';
    }
  }

  // Web: the native share sheet where the browser exposes one (mobile web,
  // some desktop browsers), copy-to-clipboard everywhere else -- matches
  // the app's other "use the web API directly, no wrapper library"
  // conventions (see SellerProfileScreen/StorefrontScreen/CollectionScreen,
  // which each have their own inline copy of just this web half).
  if (typeof navigator !== 'undefined' && (navigator as any).share) {
    try {
      await (navigator as any).share({ title, text, url });
      return 'shared';
    } catch {
      // Cancelled (or the browser rejected this particular data) -- the
      // share sheet already gave the user the choice, nothing else to do.
      return 'dismissed';
    }
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      return 'copied';
    }
    return 'error';
  } catch {
    return 'error';
  }
}
