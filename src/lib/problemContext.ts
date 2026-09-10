import { Platform } from 'react-native';
import * as Updates from 'expo-updates';
import { navigationRef } from '../navigation/navigationRef';

// Everything a problem report can know without asking the tester, captured
// at the moment they reach for the Report tab -- before the sheet opens, so
// "which screen" is the screen that broke and not the sheet on top of it.
// This is what turns "the photos don't work" into something that can be
// found: which build, which phone, which screen, which listing.
export type ProblemContext = {
  screen: string | null;
  listingId: string | null;
  platform: string;
  osVersion: string | null;
  device: string | null;
  runtimeVersion: string | null;
  updateId: string | null;
  updateCreatedAt: string | null;
};

// Route params are NOT copied wholesale: only a listing id is ever kept. A
// report is read by an admin, and a route can carry whatever a screen was
// handed -- a return destination, a draft, a phone number.
// The column is a uuid and a malformed one is refused outright -- which,
// from a listing page whose URL was pasted wrong, would make every report
// from exactly the page someone is reporting fail. Anything else is dropped.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function currentRoute(): { screen: string | null; listingId: string | null } {
  try {
    if (!navigationRef.isReady()) return { screen: null, listingId: null };
    const route = navigationRef.getCurrentRoute();
    const params = (route?.params ?? {}) as Record<string, unknown>;
    return {
      screen: route?.name ?? null,
      listingId: typeof params.listingId === 'string' && UUID.test(params.listingId) ? params.listingId : null,
    };
  } catch {
    return { screen: null, listingId: null };
  }
}

// What the phone is. React Native's own Platform constants, deliberately:
// every device-info library is a native module, and a new native module
// changes the update fingerprint and orphans every installed copy of the
// app (@AGENTS.md). Android names the maker and model; iOS names neither,
// only the kind of device, which is as far as RN goes without one.
function deviceAndOs(): { device: string | null; osVersion: string | null } {
  try {
    if (Platform.OS === 'android') {
      const c = Platform.constants as unknown as { Brand?: string; Model?: string; Release?: string };
      const device = [c.Brand, c.Model].filter(Boolean).join(' ') || null;
      const osVersion = c.Release ? `Android ${c.Release} (API ${Platform.Version})` : `API ${Platform.Version}`;
      return { device, osVersion };
    }
    if (Platform.OS === 'ios') {
      const c = Platform.constants as unknown as { interfaceIdiom?: string; systemName?: string };
      return {
        device: c.interfaceIdiom === 'pad' ? 'iPad' : 'iPhone',
        osVersion: `${c.systemName || 'iOS'} ${String(Platform.Version)}`,
      };
    }
    // The website: the browser's own description of itself is the only
    // thing that tells an old Android browser from a desktop Safari.
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    return { device: ua ? ua.slice(0, 200) : null, osVersion: null };
  } catch {
    return { device: null, osVersion: null };
  }
}

// Which bundle is running -- the same three facts BuildStamp shows on the
// Profile screen. Updates.* throws on the web build and in Expo Go.
function build(): { runtimeVersion: string | null; updateId: string | null; updateCreatedAt: string | null } {
  if (Platform.OS === 'web') return { runtimeVersion: 'web', updateId: null, updateCreatedAt: null };
  try {
    const embedded = Updates.isEmbeddedLaunch || !Updates.updateId;
    return {
      runtimeVersion: Updates.runtimeVersion ?? null,
      updateId: embedded ? 'built-in' : Updates.updateId,
      updateCreatedAt: !embedded && Updates.createdAt ? new Date(Updates.createdAt).toISOString() : null,
    };
  } catch {
    return { runtimeVersion: null, updateId: null, updateCreatedAt: null };
  }
}

export function captureProblemContext(): ProblemContext {
  return {
    ...currentRoute(),
    platform: Platform.OS,
    ...deviceAndOs(),
    ...build(),
  };
}
