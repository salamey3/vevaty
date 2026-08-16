import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import ConfirmDialog from '../components/ConfirmDialog';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useSettings } from '../store/SettingsStore';
import { TIER_THRESHOLDS } from '../data/points';
import { RootStackParamList } from '../navigation/types';
import { useLanguage } from '../i18n/LanguageContext';
import { TIER_LABELS } from '../i18n/translations';
import { listingTitle } from '../lib/listingText';
import { supabase } from '../lib/supabase';

const DAY_MS = 1000 * 60 * 60 * 24;

export default function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { profile, listings, pointsHistory, signOut, deleteAccount, isVerified, extendListing, republishListing } = useAppStore();
  // isAdmin only ever becomes true by signing in with admin (email+password)
  // credentials through the same Auth screen regular users see -- there is
  // no separate admin-login entry point anywhere in the UI anymore, so the
  // "Admin" row below stays invisible to every ordinary user.
  const { isAdmin } = useSettings();
  const { t, language, setLanguage } = useLanguage();
  const myListings = useMemo(() => listings.filter((l) => l.sellerId === profile.id), [listings, profile.id]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  // The phone column has SELECT revoked on myazar.profiles -- get_my_phone
  // (SECURITY DEFINER) is the only sanctioned way to read it back, and
  // only makes sense to call once there's a real verified session.
  const [myPhone, setMyPhone] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    if (!isVerified) { setMyPhone(null); return; }
    supabase.rpc('get_my_phone').then(({ data }) => setMyPhone(data || null));
  }, [isVerified]);

  const nextTier = TIER_THRESHOLDS.find((tier) => tier.min > profile.points);

  const handleLogOut = async () => {
    await signOut();
    navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteAccount();
      setDeleteConfirmOpen(false);
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    } catch (e: any) {
      setDeleteError(e?.message || t('profile.deleteAccountFailed'));
    } finally {
      setDeleting(false);
    }
  };

  const runExtend = async (id: string) => {
    setBusyId(id);
    setRowErrors((e) => ({ ...e, [id]: '' }));
    try {
      await extendListing(id);
    } catch {
      setRowErrors((e) => ({ ...e, [id]: t('profile.extendFailed') }));
    } finally {
      setBusyId(null);
    }
  };

  const runRepublish = async (id: string) => {
    setBusyId(id);
    setRowErrors((e) => ({ ...e, [id]: '' }));
    try {
      await republishListing(id);
    } catch {
      setRowErrors((e) => ({ ...e, [id]: t('profile.republishFailed') }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen reserveSidebar maxWidth={1180}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <LinearGradient colors={[colors.heroA, colors.heroB]} style={styles.hero}>
          <View style={styles.avatar}>
            <Icon name="user" size={24} color={colors.white} />
          </View>
          <Text style={styles.name}>{profile.name && profile.name !== 'You' ? profile.name : t('profile.yourProfile')}</Text>
          {isVerified && !!myPhone && <Text style={styles.district}>{myPhone}</Text>}
          {!!profile.district && <Text style={styles.district}>{profile.district}</Text>}
          <View style={styles.pointsRow}>
            <Icon name="trophy" size={16} color={colors.white} />
            <Text style={styles.pointsBig}>{profile.points} {t('profile.points')}</Text>
            <View style={styles.tierPill}><Text style={styles.tierPillText}>{TIER_LABELS[language][profile.tier]}</Text></View>
          </View>
          {nextTier && (
            <Text style={styles.nextTier}>
              {t('profile.pointsToTier', { points: nextTier.min - profile.points, tier: TIER_LABELS[language][nextTier.tier] })}
            </Text>
          )}
        </LinearGradient>

        {isVerified && (
          <View style={[styles.section, { marginTop: 18 }]}>
            <Pressy onPress={() => navigation.navigate('Favorites')} style={styles.adminBtn}>
              <Icon name="heart" size={15} color={colors.inkSoft} />
              <Text style={styles.adminBtnText}>{t('profile.savedListings')}</Text>
            </Pressy>
          </View>
        )}

        {isAdmin && (
          <View style={[styles.section, { marginTop: isVerified ? 10 : 18 }]}>
            <Pressy onPress={() => navigation.navigate('Admin')} style={styles.adminBtn}>
              <Icon name="gear" size={15} color={colors.inkSoft} />
              <Text style={styles.adminBtnText}>{t('profile.admin')}</Text>
            </Pressy>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>{t('profile.language')}</Text>
          </View>
          <View style={styles.langRow}>
            <Pressy onPress={() => setLanguage('en')} style={[styles.langOption, language === 'en' && styles.langOptionActive]}>
              <Text style={[styles.langLabel, language === 'en' && styles.langLabelActive]}>{t('language.english')}</Text>
            </Pressy>
            <Pressy onPress={() => setLanguage('ar')} style={[styles.langOption, language === 'ar' && styles.langOptionActive]}>
              <Text style={[styles.langLabel, language === 'ar' && styles.langLabelActive]}>{t('language.arabic')}</Text>
            </Pressy>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('profile.myListings', { count: myListings.length })}</Text>
          {myListings.length === 0 ? (
            <Text style={type.soft}>{t('profile.noListings')}</Text>
          ) : (
            myListings.map((l) => {
              const daysLeft = Math.max(0, Math.ceil((l.expiresAt - Date.now()) / DAY_MS));
              const expiringSoon = l.status === 'active' && l.expiresAt - Date.now() <= DAY_MS;
              return (
                <Pressy
                  key={l.id}
                  onPress={() => navigation.navigate('ListingDetail', { listingId: l.id })}
                  style={styles.listingRow}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listingTitle} numberOfLines={1}>{listingTitle(l, language)}</Text>

                    {l.status === 'expired' && (
                      <>
                        <View style={styles.unpublishedBadge}>
                          <Text style={styles.unpublishedBadgeText}>{t('profile.unpublished')}</Text>
                        </View>
                        <Text style={styles.republishHint}>{t('profile.republishHint')}</Text>
                      </>
                    )}
                    {l.status === 'active' && (
                      <Text style={styles.expiryCaption}>
                        {daysLeft <= 0 ? t('profile.expiresToday') : t('profile.expiresIn', { n: daysLeft })}
                      </Text>
                    )}
                    {!!rowErrors[l.id] && <Text style={styles.rowError}>{rowErrors[l.id]}</Text>}
                  </View>

                  {l.status === 'expired' && (
                    <Pressy
                      onPress={(e: any) => { e?.stopPropagation?.(); runRepublish(l.id); }}
                      style={styles.rowActionBtn}
                      disabled={busyId === l.id}
                    >
                      <Text style={styles.rowActionBtnText}>
                        {busyId === l.id ? t('common.loading') : t('profile.republish')}
                      </Text>
                    </Pressy>
                  )}
                  {expiringSoon && (
                    <Pressy
                      onPress={(e: any) => { e?.stopPropagation?.(); runExtend(l.id); }}
                      style={styles.rowActionBtn}
                      disabled={busyId === l.id}
                    >
                      <Text style={styles.rowActionBtnText}>
                        {busyId === l.id ? t('common.loading') : t('profile.extendListing')}
                      </Text>
                    </Pressy>
                  )}
                </Pressy>
              );
            })
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('profile.pointsActivity')}</Text>
          {pointsHistory.length === 0 ? (
            <Text style={type.soft}>{t('profile.noPointsActivity')}</Text>
          ) : (
            pointsHistory.slice(0, 8).map((e) => (
              <View key={e.id} style={styles.historyRow}>
                <Text style={type.body} numberOfLines={1}>{e.label}</Text>
                <Text style={styles.historyAmount}>+{e.amount}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          {isVerified ? (
            <Pressy onPress={handleLogOut} style={styles.logOutBtn}>
              <Icon name="close" size={16} color={colors.danger} />
              <Text style={styles.logOutLabel}>{t('common.logOut')}</Text>
            </Pressy>
          ) : (
            <Pressy onPress={() => navigation.navigate('Auth')} style={styles.logInBtn}>
              <Icon name="user" size={16} color={colors.white} />
              <Text style={styles.logInLabel}>{t('profile.logIn')}</Text>
            </Pressy>
          )}
        </View>

        {isVerified && (
          <View style={styles.section}>
            <Pressy onPress={() => { setDeleteError(''); setDeleteConfirmOpen(true); }} style={styles.deleteAccountRow}>
              <Text style={styles.deleteAccountLabel}>{t('profile.deleteAccount')}</Text>
            </Pressy>
            {!!deleteError && <Text style={styles.rowError}>{deleteError}</Text>}
          </View>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={deleteConfirmOpen}
        title={t('profile.deleteAccountConfirmTitle')}
        message={t('profile.deleteAccountConfirmMessage')}
        confirmLabel={t('profile.deleteAccountConfirmLabel')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={deleting}
        onConfirm={handleDeleteAccount}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 110 },
  hero: { marginHorizontal: 18, borderRadius: radius.xl, padding: 22, alignItems: 'center', marginTop: 8 },
  avatar: {
    width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  name: { fontSize: 19, fontWeight: '700', color: colors.white },
  district: { fontSize: 12.5, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  pointsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  pointsBig: { fontSize: 16, fontWeight: '700', color: colors.white },
  tierPill: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: radius.pill, paddingHorizontal: 10, height: 22, justifyContent: 'center' },
  tierPillText: { fontSize: 11, fontWeight: '700', color: colors.white },
  nextTier: { fontSize: 11.5, color: 'rgba(255,255,255,0.55)', marginTop: 8 },
  section: { paddingHorizontal: 18, marginTop: 26 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  listingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 14, marginBottom: 10,
  },
  listingTitle: { fontSize: 14.5, fontWeight: '600', color: colors.ink },
  expiryCaption: { fontSize: 12, color: colors.inkSoft, marginTop: 4 },
  unpublishedBadge: {
    alignSelf: 'flex-start', backgroundColor: colors.warnBg, borderRadius: radius.pill,
    paddingHorizontal: 10, height: 22, justifyContent: 'center', marginTop: 6,
  },
  unpublishedBadgeText: { fontSize: 11, fontWeight: '700', color: colors.ink },
  republishHint: { fontSize: 12, color: colors.inkSoft, marginTop: 6 },
  rowError: { fontSize: 12, color: colors.danger, marginTop: 6 },
  rowActionBtn: {
    height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.ink,
    paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center',
  },
  rowActionBtnText: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  historyRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  historyAmount: { fontSize: 13.5, fontWeight: '700', color: colors.success },
  langRow: { flexDirection: 'row', gap: 10 },
  langOption: {
    flex: 1, height: 44, borderRadius: radius.md, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center',
  },
  langOptionActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  langLabel: { fontSize: 14, fontWeight: '600', color: colors.ink },
  langLabelActive: { color: colors.white },
  adminBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
  },
  adminBtnText: { fontSize: 14.5, fontWeight: '600', color: colors.inkSoft },
  logOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
  },
  logOutLabel: { fontSize: 14.5, fontWeight: '600', color: colors.danger },
  logInBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, borderRadius: radius.md, backgroundColor: colors.ink,
  },
  logInLabel: { fontSize: 14.5, fontWeight: '600', color: colors.white },
  deleteAccountRow: { height: 32, alignItems: 'center', justifyContent: 'center' },
  deleteAccountLabel: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, textDecorationLine: 'underline' },
});
