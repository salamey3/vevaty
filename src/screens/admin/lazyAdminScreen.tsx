import React, { Suspense, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Pressy from '../../components/Pressy';
import Screen from '../../components/Screen';
import { colors, type } from '../../theme/theme';
import { adminOnly } from './adminOnly';

// The control room is 536 KB of source that nobody but an admin ever opens,
// and until now every visitor downloaded all of it.
//
// Note on the count: 18 screens are registered through this, but Metro
// emits 17 chunks. AdminAuctionsScreen exports `adminMessage`, which
// AdminAuctionLotsScreen imports, so Metro's extractCommonChunk hoists it
// into the eager __common chunk shared by the async ones and then deletes
// the chunk that would have been left empty. It still works -- __common is
// eager, so the module is already registered when the lazy screen asks for
// it -- but that one screen is still in everybody's first paint. If more
// admin screens ever start sharing code with each other, more of them will
// quietly migrate the same way. Count the Admin*Screen-*.js files in
// dist/_expo/static/js/web/ if the saving ever looks smaller than expected. Measured: a first
// visit to vevaty.com fetched the whole app -- the category editor, the
// auction lot builder, the user search, the tester centre -- before it
// could paint a single listing card.
//
// Registered through this instead, each admin page is fetched the first
// time it is actually rendered. The gate is what makes that safe and
// cheap: adminOnly() returns AdminGateScreen without rendering the page
// for anyone who is not signed in to the panel, so a member who types
// /control-room/branding does not merely fail to see it -- the code is
// never requested at all.
//
// Deliberately the admin pages and nothing else. The tempting next step is
// to do this to the auction and batch screens too, but those are screens
// testers are about to use, on Lebanese mobile connections, where a failed
// chunk fetch is a broken screen rather than an inconvenience for the one
// person who can fix it. The admin panel is the safe place to prove this
// pattern works.
//
// Native is unaffected: Metro resolves a dynamic import from the bundle
// that is already on the device, so there is no network and no waiting --
// the same code path, without the fetch.

function AdminChunkLoading() {
  return (
    <Screen maxWidth={520}>
      <View style={styles.centre}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.note}>Loading this part of the control room…</Text>
      </View>
    </Screen>
  );
}

type BoundaryProps = { children: React.ReactNode; onRetry: () => void };

// A class, because catching a render error still requires one. Without it a
// chunk that fails to arrive -- a dropped connection, a deploy mid-flight --
// takes the whole app down to a blank screen with "ChunkLoadError" in a
// console nobody has open.
class AdminChunkBoundary extends React.Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('[admin] could not load this screen:', (error as Error)?.message ?? error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Screen maxWidth={520}>
        <View style={styles.centre}>
          <Text style={type.h3}>This screen didn’t load</Text>
          <Text style={styles.note}>
            The control room loads each page as you open it, and this one didn’t arrive. Usually the
            connection; sometimes a deploy that was still finishing.
          </Text>
          <Pressy
            // Only onRetry. Clearing `failed` here as well would be either
            // dead code or a bug depending on how React batched it: the
            // parent's `key` changes, so this whole boundary is unmounted
            // and a fresh one takes its place. If the setState ever DID
            // land first, it would re-render the still-rejected lazy
            // component from before the retry and throw straight back.
            onPress={() => this.props.onRetry()}
            style={styles.retry}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressy>
        </View>
      </Screen>
    );
  }
}

type Loader<P> = () => Promise<{ default: React.ComponentType<P> }>;

// Wrap once, at module level (see RootNavigator) -- same rule as
// adminOnly's own comment, and it matters twice as much here: a lazy
// component built during a render is a new type every render, so React
// would throw the page away and re-fetch its chunk on each one.
export function lazyAdminScreen<P extends object>(load: Loader<P>, name: string): React.ComponentType<P> {
  function LazyAdminPage(props: P) {
    // Bumped by the retry button. React.lazy caches the promise it was
    // given INCLUDING a rejection, so retrying the same lazy component
    // replays the same failure forever -- the only way back is a fresh one.
    const [attempt, setAttempt] = useState(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const Lazy = useMemo(() => React.lazy(load), [attempt]);
    return (
      <AdminChunkBoundary key={attempt} onRetry={() => setAttempt((a) => a + 1)}>
        <Suspense fallback={<AdminChunkLoading />}>
          <Lazy {...props} />
        </Suspense>
      </AdminChunkBoundary>
    );
  }
  LazyAdminPage.displayName = `lazyAdminScreen(${name})`;
  return adminOnly(LazyAdminPage);
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  note: { ...type.soft, textAlign: 'center' },
  retry: {
    marginTop: 6,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  retryText: { color: colors.white, fontSize: 14, fontWeight: '600' },
});
