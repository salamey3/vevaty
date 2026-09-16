import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import Button from '../../components/Button';
import { colors, type, radius } from '../../theme/theme';
import { useSettings } from '../../store/SettingsStore';
import { useLanguage } from '../../i18n/LanguageContext';
import { supabase } from '../../lib/supabase';
import { mirrorRow } from '../../lib/mirrorRow';
import { needsYou, type NeedCounts, type NeedKey } from '../../lib/adminNeeds';
import { RootStackParamList } from '../../navigation/types';
import AdminLockedBackdrop from './AdminLockedBackdrop';

const LOCK_DURATION_OPTIONS = [10, 20, 30, 60, 120, 180];

type DrawerKey = 'testers' | 'listings' | 'site' | 'auctions';

// Which drawers are open survives leaving the panel and coming back, which a
// plain useState does not: this screen is navigated to fresh every time --
// unlike Profile, which is a tab and stays mounted -- so without this every
// visit starts with all four shut and the row you want is always two taps
// away. Module scope rather than storage: it resets on reload, which is
// predictable, and a preference this small does not deserve a write.
// The tester round starts open because while the round runs it is what this
// panel is opened for; move that default when the round ends.
const drawerMemory: Record<DrawerKey, boolean> = {
  testers: true, listings: false, site: false, auctions: false,
};

// The four queues, in the order they are worth being interrupted by. Each
// count is the SAME predicate the page it links to filters on, because a
// number that disagrees with the list it opens is worse than no number.


// The admin panel's front door, and since 10 Sep 2026 the ONLY one. The member
// login screen used to carry a "Sign in as admin instead" link that every
// visitor could see; it is gone, and nothing public links here. The ways in:
//
// - vevaty.com/control-room, typed or bookmarked, in any browser. (It was
//   /admin until later on 10 Sep -- too obvious a guess.) Every inner admin
//   page shows this same form in its place to anyone not signed in to the
//   panel -- see adminOnly.
// - Profile shows an Admin row to an account that IS an admin
//   (my_tester_status) -- nobody else ever sees it.
//
// Both land on the same sign-in: the admin email and password, then the
// authenticator code. An admin already signed in with their phone is NOT let
// through on the code alone -- that would make every unlocked phone they are
// signed in on, which usually carries the authenticator too, the whole of
// the admin login, and the privacy policy promises a member session never
// reaches admin. A device that HAS been through this sign-in stays signed
// in to the panel until "Sign out of admin", but after the lock time idle
// the server locks it and only the code reopens it (ACCOUNTS.md, "The admin
// lock is the server's").
//
// The first-admin "set up" form that used to sit below it is gone: the
// bootstrap it served was done long ago, its database half was closed on
// 10 Sep (close_admin_self_insert), and what was left of it could only
// create a stray email account and then fail. An admin is added from the
// database, and needs an email and password to sign in here.
export default function AdminGateScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { t, isRTL } = useLanguage();
  const {
    isAdmin, adminChecked, adminSignIn, adminSignOut,
    adminEnrollMfaStart, adminMfaVerify,
    lockDurationMinutes, setLockDuration, sessionLocked,
    siteSettings,
  } = useSettings();
  const auctionsOn = siteSettings.auctionsEnabled;

  const toggleDrawer = (k: DrawerKey) => setDrawers((d) => {
    const next = { ...d, [k]: !d[k] };
    drawerMemory[k] = next[k];
    return next;
  });

  const [mode, setMode] = useState<'signIn' | 'mfaEnroll' | 'mfaChallenge'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // undefined = not counted yet or the count FAILED. Never 0: a failed count
  // rendered as zero reads as "clear", which is the one thing it must not be
  // allowed to say. See allClear below.
  const [counts, setCounts] = useState<NeedCounts>({});
  const [drawers, setDrawers] = useState<Record<DrawerKey, boolean>>({ ...drawerMemory });
  // MFA enroll/challenge step state -- see submit()/submitMfa() below.
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaQrCode, setMfaQrCode] = useState<string | null>(null);
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  // The lock time is saved on the server now, so saving it can fail.
  const [lockSaving, setLockSaving] = useState<number | null>(null);
  const [lockError, setLockError] = useState<string | null>(null);

  // Defined up here (rather than below, next to the sign-in JSX that uses
  // them) so they're already available if the isAdmin branch below ever
  // needs them too -- keeps this component's control flow simple to
  // reason about regardless of which branch renders.
  const submit = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    const result = await adminSignIn(email.trim(), password);
    if (result.error) {
      setBusy(false);
      setError(result.error);
      return;
    }
    if (result.status === 'needsEnroll') {
      const enroll = await adminEnrollMfaStart();
      setBusy(false);
      if (enroll.error || !enroll.factorId) {
        setError(enroll.error || t('admin.mfaEnrollFailed'));
        return;
      }
      setMfaFactorId(enroll.factorId);
      setMfaQrCode(enroll.qrCode || null);
      setMfaSecret(enroll.secret || null);
      setMode('mfaEnroll');
    } else if (result.status === 'needsChallenge' && 'factorId' in result && result.factorId) {
      setBusy(false);
      setMfaFactorId(result.factorId);
      setMode('mfaChallenge');
    } else {
      setBusy(false);
    }
  };

  const submitMfa = async () => {
    if (!mfaFactorId || mfaCode.trim().length < 6) return;
    setBusy(true);
    setError(null);
    const result = await adminMfaVerify(mfaFactorId, mfaCode.trim());
    setBusy(false);
    // On success isAdmin flips true in SettingsStore and this component
    // re-renders straight into the dashboard branch below -- no extra
    // navigation needed here.
    if (result.error) {
      setError(
        result.code === 'unpinned' ? t('admin.lock.unpinnedCode')
          : result.code === 'session_ended' ? t('admin.lock.sessionEnded')
          : result.error,
      );
      return;
    }
    // Back to a clean sign-in form underneath the dashboard. Left as it was,
    // "Sign out of admin" on this same screen came back to the code step
    // with the spent code still typed in, now on a guest session where
    // Verify can only fail -- and the password and setup secret stayed in
    // memory for as long as the screen did.
    setMode('signIn');
    setMfaCode('');
    setPassword('');
    setMfaQrCode(null);
    setMfaSecret(null);
  };

  const chooseLockTime = async (mins: number) => {
    if (lockSaving !== null || mins === lockDurationMinutes) return;
    setLockSaving(mins);
    setLockError(null);
    const result = await setLockDuration(mins);
    setLockSaving(null);
    if (result.error) setLockError(t('admin.security.saveFailed'));
  };

  // Keyed on the lock too: counted while locked, the server refuses it (0)
  // and the strip would read "nothing needs you" after the code.
  //
  // Five head-counts, no rows fetched. Each one records its answer ONLY on
  // success, so a refused or dropped count leaves its key undefined and its
  // line simply does not appear -- the page behind it is still one tap away
  // in its drawer. The alternative, treating a failure as zero, would have
  // the panel state that there is no work waiting when nobody knows.
  useEffect(() => {
    if (!isAdmin || sessionLocked) return;
    let alive = true;
    const got = (k: NeedKey) => ({ count, error }: { count: number | null; error: unknown }) => {
      if (!alive || error) return;
      setCounts((c) => ({ ...c, [k]: count ?? 0 }));
    };
    // Flags filed against listings and users.
    supabase.from('reports').select('id', { count: 'exact', head: true })
      .eq('status', 'open').then(got('reports'));
    // Storefronts not yet verified -- AdminShopsScreen's own 'pending' filter.
    supabase.from('shops').select('id', { count: 'exact', head: true })
      .is('verified_at', null).then(got('shops'));
    // What testers sent and nobody has opened yet.
    supabase.from('problem_reports').select('id', { count: 'exact', head: true })
      .eq('status', 'new').then(got('problems'));
    // AdminModerationScreen's isFlagged, written as a server-side filter:
    // anything the AI declined, plus anything parked at pending_review.
    supabase.from('listings').select('id', { count: 'exact', head: true })
      .or('moderation_status.eq.flagged,status.eq.pending_review').then(got('moderation'));
    // Only worth asking for while the section exists for buyers at all.
    if (auctionsOn) {
      supabase.from('auction_submissions').select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'needs_info']).then(got('consignments'));
    }
    return () => { alive = false; };
  }, [isAdmin, sessionLocked, auctionsOn]);

  const { needs, allClear } = needsYou(counts, auctionsOn);

  // Opened straight from vevaty.com/control-room -- or from an inner admin
  // page, which shows this form in its place -- this can be the only screen
  // on the stack, where goBack() does nothing at all.
  const leave = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
  };

  const topBar = (
    <View style={styles.topBar}>
      <Pressy onPress={leave} style={styles.iconBtn}>
        <Icon name="back" size={18} />
      </Pressy>
      <Text style={type.h3}>{t('admin.title')}</Text>
      <View style={styles.iconBtn} />
    </View>
  );

  if (!adminChecked) {
    return (
      <Screen maxWidth={480}>
        {topBar}
        <View style={styles.center}>
          <ActivityIndicator color={colors.ink} />
        </View>
      </Screen>
    );
  }

  // Locked: the dashboard is taken down under the lock screen, like every
  // other admin page (see AdminLockedBackdrop).
  if (isAdmin && sessionLocked) return <AdminLockedBackdrop />;

  if (isAdmin) {
    return (
      <Screen maxWidth={480}>
        {topBar}
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.dashboardTitle}>{t('admin.dashboardTitle')}</Text>

          {/* Everything below the strip is grouped by what the thing IS; the
              things that PILE UP are spread across three of those groups, so
              on its own the grouping would still mean opening all four every
              morning to find out whether anything was waiting. Same answer as
              the shop's own morning list (ShopDayScreen): the queue is not a
              place, it is a state, so it gets a strip of shortcuts rather than
              a fifth drawer duplicating four pages. Nothing lives twice. */}
          {needs.length > 0 && (
            <View style={styles.needs}>
              <Text style={styles.needsTitle}>{t('admin.needs.title')}</Text>
              {needs.map((need) => (
                <Pressy
                  key={need.key}
                  onPress={() => navigation.navigate(need.route)}
                  style={[styles.needsRow, mirrorRow(isRTL)]}
                >
                  <View style={styles.needsCount}>
                    <Text style={styles.needsCountText}>{need.count}</Text>
                  </View>
                  <Text style={styles.needsLabel}>{t(need.label)}</Text>
                  <View style={styles.spacer} />
                  <Icon name="chevronRight" size={15} color={colors.inkSoft} />
                </Pressy>
              ))}
            </View>
          )}

          {/* Only once every count has actually come back. A count that failed
              leaves its key undefined, and "nothing needs you" over an unknown
              is the panel telling a comfortable lie. */}
          {allClear && <Text style={styles.allClear}>{t('admin.needs.nothing')}</Text>}

          <Drawer
            title={t('admin.group.testers')}
            open={drawers.testers}
            onToggle={() => toggleDrawer('testers')}
            isRTL={isRTL}
          >
            <DashRow
              isRTL={isRTL}
              title={t('admin.testerCentre')}
              sub={t('admin.testerCentreSub')}
              onPress={() => navigation.navigate('AdminTesters')}
            />
            <DashRow
              isRTL={isRTL}
              title={t('admin.problemReports')}
              sub={t('admin.problemReportsSub')}
              badge={counts.problems}
              onPress={() => navigation.navigate('AdminProblemReports')}
            />
          </Drawer>

          <Drawer
            title={t('admin.group.listings')}
            open={drawers.listings}
            onToggle={() => toggleDrawer('listings')}
            isRTL={isRTL}
          >
            <DashRow
              isRTL={isRTL}
              title={t('admin.manageModeration')}
              sub={t('admin.manageModerationSub')}
              badge={counts.moderation}
              onPress={() => navigation.navigate('AdminModeration')}
            />
            <DashRow
              isRTL={isRTL}
              title={t('admin.manageReports')}
              sub={t('admin.manageReportsSub')}
              badge={counts.reports}
              onPress={() => navigation.navigate('AdminReports')}
            />
            <DashRow
              isRTL={isRTL}
              title={t('admin.manageUsers')}
              sub={t('admin.manageUsersSub')}
              onPress={() => navigation.navigate('AdminUsers')}
            />
            <DashRow
              isRTL={isRTL}
              title={t('admin.manageStorefronts')}
              sub={t('admin.manageStorefrontsSub')}
              badge={counts.shops}
              onPress={() => navigation.navigate('AdminShops')}
            />
          </Drawer>

          <Drawer
            title={t('admin.group.site')}
            open={drawers.site}
            onToggle={() => toggleDrawer('site')}
            isRTL={isRTL}
          >
            <DashRow
              isRTL={isRTL}
              title={t('admin.manageCategories')}
              sub={t('admin.manageCategoriesSub')}
              onPress={() => navigation.navigate('AdminCategories')}
            />
            <DashRow
              isRTL={isRTL}
              title={t('admin.manageCollections')}
              sub={t('admin.manageCollectionsSub')}
              onPress={() => navigation.navigate('AdminCollections')}
            />
            <DashRow
              isRTL={isRTL}
              title={t('admin.manageBanners')}
              sub={t('admin.manageBannersSub')}
              onPress={() => navigation.navigate('AdminBanners')}
            />
            <DashRow
              isRTL={isRTL}
              title={t('admin.manageBranding')}
              sub={t('admin.manageBrandingSub')}
              onPress={() => navigation.navigate('AdminBranding')}
            />
          </Drawer>

          {/* Shown even while the section is switched off for buyers, and
              marked as such -- because the switch that turns it back ON lives
              inside AdminAuctionsScreen. Hiding the drawer would hide the only
              way to reach it. */}
          <Drawer
            title={t('admin.group.auctions')}
            note={auctionsOn ? undefined : t('admin.group.auctionsOff')}
            open={drawers.auctions}
            onToggle={() => toggleDrawer('auctions')}
            isRTL={isRTL}
          >
            <DashRow
              isRTL={isRTL}
              title={t('admin.manageAuctions')}
              sub={t('admin.manageAuctionsSub')}
              onPress={() => navigation.navigate('AdminAuctions')}
            />
            <DashRow
              isRTL={isRTL}
              title={t('admin.consignments')}
              sub={t('admin.consignmentsSub')}
              badge={counts.consignments}
              onPress={() => navigation.navigate('AdminAuctionSubmissions')}
            />
          </Drawer>

          <Text style={styles.sectionLabel}>{t('admin.security.title')}</Text>

          <Text style={styles.fieldLabel}>{t('admin.security.autoLock')}</Text>
          <View style={styles.durationRow}>
            {LOCK_DURATION_OPTIONS.map((mins) => (
              <Pressy
                key={mins}
                onPress={() => chooseLockTime(mins)}
                style={[styles.durationChip, (lockSaving ?? lockDurationMinutes) === mins && styles.durationChipActive]}
              >
                <Text style={[styles.durationChipText, (lockSaving ?? lockDurationMinutes) === mins && styles.durationChipTextActive]}>
                  {mins < 60 ? t('admin.security.minutes', { n: mins }) : t('admin.security.hours', { n: mins / 60 })}
                </Text>
              </Pressy>
            ))}
          </View>
          {!!lockError && <Text style={styles.error}>{lockError}</Text>}
          <Text style={styles.note}>{t('admin.security.autoLockNote')}</Text>

          <Pressy onPress={() => adminSignOut()} style={styles.signOutBtn}>
            <Icon name="close" size={15} color={colors.danger} />
            <Text style={styles.signOutText}>{t('admin.signOut')}</Text>
          </Pressy>
        </ScrollView>
      </Screen>
    );
  }

  if (mode === 'mfaEnroll' || mode === 'mfaChallenge') {
    return (
      <Screen maxWidth={480}>
        {topBar}
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.dashboardTitle}>
            {mode === 'mfaEnroll' ? t('admin.mfaEnrollTitle') : t('admin.mfaChallengeTitle')}
          </Text>
          <Text style={styles.note}>
            {mode === 'mfaEnroll' ? t('admin.mfaEnrollNote') : t('admin.mfaChallengeNote')}
          </Text>

          {mode === 'mfaEnroll' && !!mfaQrCode && (
            <View style={styles.qrWrap}>
              <Image
                source={{ uri: `data:image/svg+xml;utf8,${encodeURIComponent(mfaQrCode)}` }}
                style={styles.qrImage}
              />
              {!!mfaSecret && <Text style={styles.mfaSecret}>{mfaSecret}</Text>}
            </View>
          )}

          <Text style={styles.fieldLabel}>{t('admin.mfaCodeLabel')}</Text>
          <TextInput
            value={mfaCode}
            onChangeText={setMfaCode}
            placeholder="123456"
            placeholderTextColor={colors.inkSoft}
            keyboardType="number-pad"
            maxLength={6}
            style={styles.input}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <Button
            label={mode === 'mfaEnroll' ? t('admin.mfaEnrollCta') : t('admin.verify')}
            onPress={submitMfa}
            loading={busy}
            disabled={mfaCode.trim().length < 6}
            style={{ marginTop: 18 }}
          />

          <Pressy onPress={() => { setMode('signIn'); setError(null); setMfaCode(''); }} style={styles.switchLink}>
            <Text style={styles.switchLinkText}>{t('admin.backToSignIn')}</Text>
          </Pressy>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen maxWidth={480}>
      {topBar}
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.dashboardTitle}>{t('admin.signInTitle')}</Text>
        <Text style={styles.note}>{t('admin.signInNote')}</Text>

        <Text style={styles.fieldLabel}>{t('admin.emailLabel')}</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@example.com"
          placeholderTextColor={colors.inkSoft}
          style={styles.input}
        />
        <Text style={styles.fieldLabel}>{t('admin.passwordLabel')}</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor={colors.inkSoft}
          style={styles.input}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Button
          label={t('admin.signIn')}
          onPress={submit}
          loading={busy}
          disabled={!email.trim() || !password}
          style={{ marginTop: 18 }}
        />
      </ScrollView>
    </Screen>
  );
}

// A collapsible group of dashboard rows. Shut, the head IS an ordinary
// bordered row and the container adds nothing -- because Pressy scales the
// element it is on, so a border left on the container would stay put while
// the pressed head shrank away from it and the bar would visibly hollow out.
// Open, the container takes the border over and the head gives up its own,
// at 47 rather than 48: a border sits INSIDE the box in React Native, so a
// shut head is 48 with 47 of content, and matching that keeps the bar the
// same height through the tap instead of nudging the page down a pixel.
// Same construction as Profile's "My business" drawer, for the same reasons.
function Drawer({ title, note, open, onToggle, isRTL, children }: {
  title: string; note?: string; open: boolean; onToggle: () => void;
  isRTL: boolean; children: React.ReactNode;
}) {
  return (
    <View style={styles.drawerWrap}>
      <View style={open ? styles.drawerBox : null}>
        <Pressy
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={title}
          style={[open ? [styles.drawerHead, styles.drawerHeadOpen] : styles.drawerHeadShut, mirrorRow(isRTL)]}
        >
          <Text style={styles.drawerTitle}>{title}</Text>
          {!!note && (
            <View style={styles.offPill}>
              <Text style={styles.offPillText}>{note}</Text>
            </View>
          )}
          <View style={styles.spacer} />
          <View style={[styles.drawerChevron, open && styles.drawerChevronOpen]}>
            <Icon name="chevronRight" size={14} color={colors.inkSoft} />
          </View>
        </Pressy>
        {open && children}
      </View>
    </View>
  );
}

// One row inside a drawer. The count is the same figure the strip at the top
// uses, repeated here so a drawer opened directly still says which of its
// pages has work in it.
function DashRow({ title, sub, onPress, badge, isRTL }: {
  title: string; sub: string; onPress: () => void; badge?: number; isRTL: boolean;
}) {
  return (
    <Pressy onPress={onPress} accessibilityRole="button" style={[styles.drawerRow, mirrorRow(isRTL)]}>
      {/* minWidth 0: on react-native-web a flex item keeps min-width auto, so
          a long subtitle beside the fixed chevron pushes the row past the
          card instead of wrapping inside it. */}
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      {!!badge && (
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{badge}</Text>
        </View>
      )}
      <Icon name="chevronRight" size={16} color={colors.inkSoft} />
    </Pressy>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Content padding for the ScrollViews below (renamed from a plain View
  // this used to be -- see the render sites). Screen.tsx never scrolls on
  // its own (every wrapper in that chain is just flex:1), so a dashboard
  // this long -- 8 section rows plus the whole Security block -- had no
  // way to reach anything past roughly the Users row on a phone-height
  // viewport or in the native app, where there's no page-level scroll to
  // fall back on the way a wide desktop browser window has. Every other
  // admin screen (AdminBrandingScreen, AdminCollectionsScreen, ...)
  // already wraps its content in a ScrollView; this one just hadn't been
  // updated to match as rows were added to it over time.
  scroll: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 40 },
  dashboardTitle: { ...type.title, fontSize: 21, marginBottom: 16 },
  note: { ...type.soft, lineHeight: 18, marginBottom: 20 },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 46, fontSize: 14.5, color: colors.ink,
  },
  error: { color: colors.danger, fontSize: 13, marginTop: 14 },
  switchLink: { marginTop: 16, alignItems: 'center' },
  switchLinkText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  // A flex spacer child, never marginStart/paddingStart: those resolve
  // against I18nManager.isRTL, which this app never flips, so they would
  // indent from the outside edge in Arabic. A flex child is turned around by
  // whatever is mirroring the row, so it cannot disagree with the row.
  spacer: { flex: 1, minWidth: 0 },

  // ---- the strip
  needs: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accentRing,
    borderRadius: radius.md, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4,
    marginBottom: 18,
  },
  needsTitle: {
    ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5,
    color: colors.accentDeep, marginBottom: 4,
  },
  needsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  needsCount: {
    minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6,
    backgroundColor: colors.accentTint, alignItems: 'center', justifyContent: 'center',
  },
  needsCountText: { fontSize: 12.5, fontWeight: '700', color: colors.accentDeep },
  needsLabel: { fontSize: 14, fontWeight: '600', color: colors.ink },
  allClear: { ...type.soft, fontSize: 14.5, marginBottom: 18 },

  // ---- the drawers
  drawerWrap: { marginBottom: 12 },
  drawerBox: {
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, overflow: 'hidden',
  },
  drawerHeadShut: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16,
    height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
  },
  drawerHead: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, height: 47,
  },
  drawerHeadOpen: { backgroundColor: colors.surface },
  drawerTitle: { ...type.h3, fontSize: 15 },
  drawerChevron: {
    width: 16, height: 16, alignItems: 'center', justifyContent: 'center',
    transform: [{ rotate: '0deg' }],
  },
  drawerChevronOpen: { transform: [{ rotate: '90deg' }] },
  offPill: {
    paddingHorizontal: 7, height: 19, borderRadius: radius.pill,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  offPillText: { fontSize: 10.5, fontWeight: '700', color: colors.inkSoft },

  drawerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 13,
    borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.card,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { ...type.h3 },
  rowSub: { ...type.soft, marginTop: 2 },
  countBadge: {
    minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  countBadgeText: { fontSize: 11.5, fontWeight: '700', color: colors.white },
  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, marginTop: 24,
  },
  signOutText: { fontSize: 14.5, fontWeight: '600', color: colors.danger },
  sectionLabel: {
    ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: 28, marginBottom: 6,
  },
  durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  durationChip: {
    height: 34, paddingHorizontal: 14, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
  },
  durationChipActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  durationChipText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  durationChipTextActive: { color: colors.white },
  qrWrap: { alignItems: 'center', marginTop: 16, marginBottom: 4 },
  qrImage: { width: 200, height: 200 },
  mfaSecret: {
    marginTop: 10, fontSize: 12.5, color: colors.inkSoft, letterSpacing: 1,
    textAlign: 'center',
  },
});
