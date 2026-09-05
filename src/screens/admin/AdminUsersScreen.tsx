import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import { colors, type, radius } from '../../theme/theme';
import { supabase } from '../../lib/supabase';
import { RootStackParamList } from '../../navigation/types';

// Find a user, then open them. Editing lives on AdminUserDetailScreen --
// this screen's whole job is getting to the right person.
//
// The search runs on the SERVER (myazar.admin_search_users), not over a
// list fetched here, for two reasons. Phone and email cannot be read by a
// client at all -- `authenticated` has no column grant on them, deliberately,
// because profiles' SELECT policy is `true` and a grant would publish every
// user's number to every signed-in account. And a client-side filter can
// only search what it has already downloaded, which stops being every user
// the moment there are more than a few hundred.
//
// The guest split is server-side for that second reason specifically: the
// search returns at most fifty rows, so hiding guests after the fact would
// show fewer than fifty registered accounts while looking like the whole
// answer. The counts come from their own query over the whole table.

type AdminUserRow = {
  id: string;
  fullName: string;
  phone: string | null;
  district: string | null;
  points: number;
  tier: string;
  tierOverride: string | null;
  isSuspended: boolean;
  // Registered = got through phone OTP. A guest is an anonymous browsing
  // session: it cannot post, chat, or be contacted, so there is nothing an
  // admin can do to it -- but it used to sit in this list looking exactly
  // like a member. is_phone_verified is written by verifyCode's
  // upsertOwnProfile the instant an OTP is accepted, before anything else
  // in signup can fail, which is what makes it a safe test for "real
  // account" rather than a guess from the name or the listing count.
  isRegistered: boolean;
};

export default function AdminUsersScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Guests are OFF by default. They outnumbered the real accounts roughly
  // fifty to one, all of them called "Vevaty user", so the two accounts
  // that actually matter were two rows in a hundred.
  const [showGuests, setShowGuests] = useState(false);
  const [guestCount, setGuestCount] = useState(0);

  // Guards against a slow early request landing on top of a later, faster
  // one and repainting the list with results for words the admin has
  // already finished deleting.
  const seqRef = useRef(0);

  const search = useCallback(async (q: string, includeGuests: boolean) => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc('admin_search_users', {
        p_query: q,
        p_limit: 50,
        p_include_guests: includeGuests,
      });
      if (err) throw err;
      if (seq !== seqRef.current) return;
      setRows(
        (data || []).map((row: any) => ({
          id: row.id,
          fullName: row.full_name || 'Vevaty user',
          phone: row.phone,
          district: row.district,
          points: row.points ?? 0,
          tier: row.tier || 'bronze',
          tierOverride: row.tier_override,
          isSuspended: !!row.is_suspended,
          isRegistered: !!row.is_phone_verified,
        }))
      );
    } catch (e: any) {
      if (seq !== seqRef.current) return;
      setError(e?.message === 'not_admin' ? 'This account is not an admin.' : e?.message || String(e));
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  // Whole-table, so the "N guest sessions" line is a fact about the
  // marketplace rather than about the fifty rows that came back.
  const loadCounts = useCallback(async () => {
    const { data } = await supabase.rpc('admin_user_counts');
    const row = Array.isArray(data) ? data[0] : data;
    if (row) setGuestCount(row.guests ?? 0);
  }, []);

  // Debounced: an admin typing a phone number should not fire nine queries.
  useEffect(() => {
    const handle = setTimeout(() => search(query.trim(), showGuests), query.trim() ? 300 : 0);
    return () => clearTimeout(handle);
  }, [query, showGuests, search]);

  // Coming back from the detail screen after an edit should not show the
  // values from before it. Deliberately reads the current query and toggle
  // from refs rather than depending on them: this fires on every focus, and
  // depending on them would duplicate the debounced search above on every
  // keystroke.
  const liveRef = useRef({ query, showGuests });
  liveRef.current = { query, showGuests };
  useFocusEffect(
    useCallback(() => {
      search(liveRef.current.query.trim(), liveRef.current.showGuests);
      loadCounts();
    }, [search, loadCounts])
  );

  return (
    <Screen maxWidth={720}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>Users</Text>
        <Pressy onPress={() => { search(query.trim(), showGuests); loadCounts(); }} style={styles.iconBtn}>
          <Icon name="rotate" size={16} />
        </Pressy>
      </View>

      <View style={styles.searchWrap}>
        <Icon name="search" size={15} color={colors.inkSoft} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Name, phone number, email or district"
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <Pressy onPress={() => setQuery('')} style={styles.clearBtn}>
            <Icon name="close" size={13} color={colors.inkSoft} />
          </Pressy>
        )}
      </View>
      <Text style={styles.hint}>
        A phone number matches however it is written -- "70 529 123", "70529123" and "+96170529123" all find the
        same account.
      </Text>

      {/* Nothing is hidden -- the guests are counted in plain sight and one
          tap away -- but they do not get to bury the members. */}
      {!error && guestCount > 0 && (
        <Pressy onPress={() => setShowGuests((g) => !g)} style={styles.guestToggle}>
          <Icon name={showGuests ? 'eye' : 'eyeOff'} size={14} color={colors.inkSoft} />
          <Text style={styles.guestToggleText}>
            {guestCount} guest {guestCount === 1 ? 'session' : 'sessions'} (not registered) ·{' '}
            {showGuests ? 'hide' : 'show'}
          </Text>
        </Pressy>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.ink} /></View>
      ) : error ? (
        <View style={styles.center}><Text style={type.soft}>{error}</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {rows.length === 0 && (
            <Text style={styles.emptyText}>
              {query.trim() ? 'No users match this search.' : 'No registered users yet.'}
            </Text>
          )}
          {rows.map((row) => (
            <Pressy
              key={row.id}
              onPress={() => navigation.navigate('AdminUserDetail', { userId: row.id })}
              style={styles.card}
            >
              <View style={styles.avatar}>
                <Icon name="user" size={18} color={colors.inkSoft} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>{row.fullName}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {row.phone || 'No phone'} · {row.district || 'No district'}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {row.tier}{row.tierOverride ? ' (set by admin)' : ''} · {row.points} pts
                </Text>
              </View>
              {!row.isRegistered && (
                <View style={styles.guestBadge}>
                  <Text style={styles.guestBadgeText}>Guest</Text>
                </View>
              )}
              {row.isSuspended && (
                <View style={styles.suspendedBadge}>
                  <Text style={styles.suspendedBadgeText}>Suspended</Text>
                </View>
              )}
              <Icon name="chevronRight" size={16} color={colors.inkSoft} />
            </Pressy>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 18, marginTop: 4,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 40,
  },
  searchInput: { flex: 1, fontSize: 13.5, color: colors.ink, height: '100%' },
  clearBtn: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  hint: { ...type.tiny, textTransform: 'none', letterSpacing: 0, lineHeight: 16, marginHorizontal: 18, marginTop: 8 },
  guestToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 18, paddingVertical: 8 },
  guestToggleText: { ...type.tiny, color: colors.inkSoft },
  scroll: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 60 },
  emptyText: { ...type.soft, textAlign: 'center', marginTop: 30 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, marginBottom: 10,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { ...type.h3 },
  rowSub: { ...type.soft, marginTop: 2 },
  suspendedBadge: { paddingHorizontal: 8, height: 20, borderRadius: radius.pill, backgroundColor: '#f5e4e2', alignItems: 'center', justifyContent: 'center' },
  suspendedBadgeText: { fontSize: 10.5, fontWeight: '700', color: colors.danger, textTransform: 'uppercase' },
  // Deliberately quiet -- a guest is not a problem to flag, just a row
  // that is not a member, so it reads as grey information rather than as
  // the red Suspended badge beside it.
  guestBadge: {
    paddingHorizontal: 8, height: 20, borderRadius: radius.pill,
    backgroundColor: colors.line, alignItems: 'center', justifyContent: 'center',
  },
  guestBadgeText: { fontSize: 10.5, fontWeight: '700', color: colors.inkSoft, textTransform: 'uppercase' },
});
