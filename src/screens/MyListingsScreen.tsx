import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import ConfirmDialog from '../components/ConfirmDialog';
import ActionSheet from '../components/ActionSheet';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/types';
import { useLanguage } from '../i18n/LanguageContext';
import { listingActionMessage } from '../lib/listingActionMessage';
import { useSettings } from '../store/SettingsStore';
import { listingTitle } from '../lib/listingText';
import { useGoBack } from '../hooks/useGoBack';

const DAY_MS = 1000 * 60 * 60 * 24;

// Everything the seller can do with one of their own listings, pulled out
// of ProfileScreen into its own screen -- see the "Listings Manager" nav
// row on Profile (originally shipped as "My Listings", renamed once Edit/
// Delete/Item Sold/Hide landed on ListingDetailScreen too). Previously this
// was one section mixed in among Browse storefronts/Language/About/Points
// activity/Log out, which only had room to grow as a cramped list; now
// it's the whole screen, same as Favorites and My Storefront before it.
//
// New here (the reason this screen exists, not just a relocation): every
// listing gets a manage row below whatever it already had -- Edit and
// Delete always, plus Item Sold and Hide Listing once it's actually live.
// Delete and Item Sold both prompt first (a ConfirmDialog, an ActionSheet);
// Hide does not -- it's a one-tap "take this off the market for now" that a
// seller can always undo later by resuming the resulting draft, same as any
// other draft. Edit here replaces the old status-specific "Edit & resubmit"
// row action for rejected listings -- both did the exact same
// navigation.navigate('CreateListing', { editListingId }), so a single
// uniform Edit pill covers every status without a redundant second control.
export default function MyListingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const goBack = useGoBack();
  const { t, language } = useLanguage();
  const { listings, profile, extendListing, republishListing, deleteListing, hideListing, markListingSold, restoreAutoHiddenListing } =
    useAppStore();
  // The Extend button used to promise "another 15 days" to everyone. A
  // lifetime is per-category now, so a ticket's button has to say 3 and a
  // property's 45 -- a button that names the wrong number is worse than
  // one that names none.
  const { lifetimeDaysForCategory } = useSettings();
  const myListings = useMemo(() => listings.filter((l) => l.sellerId === profile.id), [listings, profile.id]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [soldSheetId, setSoldSheetId] = useState<string | null>(null);

  const runExtend = async (id: string) => {
    setBusyId(id);
    setRowErrors((e) => ({ ...e, [id]: '' }));
    try {
      await extendListing(id);
    } catch (err: any) {
      setRowErrors((e) => ({ ...e, [id]: listingActionMessage(err, t, 'profile.extendFailed') }));
    } finally {
      setBusyId(null);
    }
  };

  const runRepublish = async (id: string) => {
    setBusyId(id);
    setRowErrors((e) => ({ ...e, [id]: '' }));
    try {
      await republishListing(id);
    } catch (err: any) {
      setRowErrors((e) => ({ ...e, [id]: listingActionMessage(err, t, 'profile.republishFailed') }));
    } finally {
      setBusyId(null);
    }
  };

  const runRestore = async (id: string) => {
    setBusyId(id);
    setRowErrors((e) => ({ ...e, [id]: '' }));
    try {
      await restoreAutoHiddenListing(id);
    } catch (err: any) {
      setRowErrors((e) => ({ ...e, [id]: listingActionMessage(err, t, 'myListings.restoreFailed') }));
    } finally {
      setBusyId(null);
    }
  };

  const runHide = async (id: string) => {
    setBusyId(id);
    setRowErrors((e) => ({ ...e, [id]: '' }));
    try {
      await hideListing(id);
    } catch (err: any) {
      setRowErrors((e) => ({ ...e, [id]: listingActionMessage(err, t, 'myListings.hideFailed') }));
    } finally {
      setBusyId(null);
    }
  };

  const runMarkSold = async (id: string, soldVia: 'vevaty' | 'elsewhere') => {
    setSoldSheetId(null);
    setBusyId(id);
    setRowErrors((e) => ({ ...e, [id]: '' }));
    try {
      await markListingSold(id, soldVia);
    } catch (err: any) {
      setRowErrors((e) => ({ ...e, [id]: listingActionMessage(err, t, 'myListings.markSoldFailed') }));
    } finally {
      setBusyId(null);
    }
  };

  const runDelete = async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteListing(confirmDeleteId);
      setConfirmDeleteId(null);
    } catch (e: any) {
      // Never e.message -- see listingActionMessage. A refused delete used
      // to print PostgREST's own English diagnostic into the seller's
      // confirmation sheet.
      setDeleteError(listingActionMessage(e, t, 'listingDetail.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Screen maxWidth={1180}>
      <View style={styles.header}>
        <Pressy onPress={goBack} style={styles.backBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.title}>{t('myListings.title')}</Text>
      </View>

      {myListings.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.iconWrap}>
            <Icon name="bag" size={24} color={colors.inkSoft} />
          </View>
          <Text style={[type.soft, styles.emptyText]}>{t('profile.noListings')}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {myListings.map((l) => {
            const daysLeft = Math.max(0, Math.ceil((l.expiresAt - Date.now()) / DAY_MS));
            const expiringSoon = l.status === 'active' && l.expiresAt - Date.now() <= DAY_MS;
            // Item Sold / Hide Listing only make sense for something
            // currently live -- a draft/pending/rejected/expired listing
            // isn't on the market to begin with, so those two actions stay
            // off its row; Delete (now a soft-remove, see AppStore's
            // deleteListing) always applies regardless of status.
            const isActive = l.status === 'active';
            return (
              <Pressy
                key={l.id}
                onPress={() =>
                  l.status === 'draft'
                    ? navigation.navigate('CreateListing', { editListingId: l.id })
                    : navigation.navigate('ListingDetail', { listingId: l.id })
                }
                style={styles.listingRow}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.listingTitle} numberOfLines={1}>
                    {l.status === 'draft' && !listingTitle(l, language) ? t('profile.draftUntitled') : listingTitle(l, language)}
                  </Text>

                  {/* A draft the seller parked and a listing buyers hid
                      are both status 'draft', and they must not read the
                      same: "resume this draft" is bewildering on a
                      listing you finished weeks ago. autoHiddenAt is what
                      tells them apart. See LIFECYCLE.md. */}
                  {l.status === 'draft' && (
                    <>
                      <View style={l.autoHiddenAt ? styles.autoHiddenBadge : styles.draftBadge}>
                        <Text style={l.autoHiddenAt ? styles.autoHiddenBadgeText : styles.draftBadgeText}>
                          {l.autoHiddenAt ? t('myListings.autoHidden') : t('profile.draft')}
                        </Text>
                      </View>
                      <Text style={styles.republishHint}>
                        {l.autoHiddenAt ? t('myListings.autoHiddenHint') : t('profile.resumeHint')}
                      </Text>
                    </>
                  )}
                  {l.status === 'expired' && (
                    <>
                      <View style={styles.unpublishedBadge}>
                        <Text style={styles.unpublishedBadgeText}>{t('profile.unpublished')}</Text>
                      </View>
                      <Text style={styles.republishHint}>{t('profile.republishHint')}</Text>
                    </>
                  )}
                  {l.status === 'pending_review' && (
                    <View style={styles.pendingReviewBadge}>
                      <Text style={styles.pendingReviewBadgeText}>{t('profile.underReview')}</Text>
                    </View>
                  )}
                  {l.status === 'rejected' && (
                    <>
                      <View style={styles.rejectedBadge}>
                        <Text style={styles.rejectedBadgeText}>{t('profile.changesNeeded')}</Text>
                      </View>
                      {!!l.moderationReason && <Text style={styles.republishHint}>{l.moderationReason}</Text>}
                    </>
                  )}
                  {l.status === 'sold' && (
                    <View style={styles.soldBadge}>
                      <Text style={styles.soldBadgeText}>{t('profile.sold')}</Text>
                    </View>
                  )}
                  {l.status === 'active' && (
                    <Text style={styles.expiryCaption}>
                      {daysLeft <= 0 ? t('profile.expiresToday') : t('profile.expiresIn', { n: daysLeft })}
                    </Text>
                  )}
                  {!!rowErrors[l.id] && <Text style={styles.rowError}>{rowErrors[l.id]}</Text>}

                  {/* Restore is its own action, not Republish: it also has
                      to void the reports that hid the listing, or the
                      next buyer's answer re-hides it on a count the
                      seller has already answered for.
                      Gated on 'draft' as well as autoHiddenAt: editing
                      and resubmitting clears the auto-hide state
                      server-side, and this button beside a live listing
                      leads only to a dead end -- the RPC finds no hidden
                      listing and the seller is told to try again forever. */}
                  {l.status === 'draft' && !!l.autoHiddenAt && (
                    <Pressy
                      onPress={(e: any) => { e?.stopPropagation?.(); runRestore(l.id); }}
                      style={[styles.rowActionBtn, styles.rowActionSpacing]}
                      disabled={busyId === l.id}
                    >
                      <Text style={styles.rowActionBtnText}>
                        {busyId === l.id ? t('common.loading') : t('myListings.restore')}
                      </Text>
                    </Pressy>
                  )}
                  {l.status === 'expired' && (
                    <Pressy
                      onPress={(e: any) => { e?.stopPropagation?.(); runRepublish(l.id); }}
                      style={[styles.rowActionBtn, styles.rowActionSpacing]}
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
                      style={[styles.rowActionBtn, styles.rowActionSpacing]}
                      disabled={busyId === l.id}
                    >
                      <Text style={styles.rowActionBtnText}>
                        {busyId === l.id
                          ? t('common.loading')
                          : t('profile.extendListing', { n: lifetimeDaysForCategory(l.cat) })}
                      </Text>
                    </Pressy>
                  )}

                  <Text style={styles.manageLabel}>{t('myListings.manageLabel')}</Text>
                  <View style={styles.manageRow}>
                    <Pressy
                      onPress={(e: any) => { e?.stopPropagation?.(); navigation.navigate('CreateListing', { editListingId: l.id }); }}
                      disabled={busyId === l.id}
                      style={styles.actionPill}
                    >
                      <Icon name="edit" size={15} color={colors.ink} />
                      <Text style={styles.actionPillLabel}>{t('myListings.edit')}</Text>
                    </Pressy>
                    <Pressy
                      onPress={(e: any) => { e?.stopPropagation?.(); setDeleteError(''); setConfirmDeleteId(l.id); }}
                      disabled={busyId === l.id}
                      style={[styles.actionPill, styles.actionDelete]}
                    >
                      <Icon name="trash" size={15} color={colors.danger} />
                      <Text style={[styles.actionPillLabel, { color: colors.danger }]}>{t('myListings.delete')}</Text>
                    </Pressy>
                    {isActive && (
                      <>
                        <Pressy
                          onPress={(e: any) => { e?.stopPropagation?.(); setSoldSheetId(l.id); }}
                          disabled={busyId === l.id}
                          style={[styles.actionPill, styles.actionSold]}
                        >
                          <Icon name="banknote" size={15} color={colors.success} />
                          <Text style={[styles.actionPillLabel, { color: colors.success }]}>{t('myListings.itemSold')}</Text>
                        </Pressy>
                        <Pressy
                          onPress={(e: any) => { e?.stopPropagation?.(); runHide(l.id); }}
                          disabled={busyId === l.id}
                          style={styles.actionPill}
                        >
                          <Icon name="eyeOff" size={15} color={colors.ink} />
                          <Text style={styles.actionPillLabel}>{t('myListings.hide')}</Text>
                        </Pressy>
                      </>
                    )}
                  </View>
                </View>
              </Pressy>
            );
          })}
        </ScrollView>
      )}

      <ConfirmDialog
        visible={!!confirmDeleteId}
        title={t('listingDetail.deleteConfirmTitle')}
        message={deleteError || t('listingDetail.deleteConfirmMessage')}
        confirmLabel={t('listingDetail.deleteListing')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={deleting}
        onConfirm={runDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />

      <ActionSheet
        visible={!!soldSheetId}
        title={t('myListings.markSoldTitle')}
        options={[
          { label: t('myListings.soldOnVevaty'), icon: 'banknote', onPress: () => soldSheetId && runMarkSold(soldSheetId, 'vevaty') },
          { label: t('myListings.soldElsewhere'), icon: 'bag', onPress: () => soldSheetId && runMarkSold(soldSheetId, 'elsewhere') },
        ]}
        cancelLabel={t('common.cancel')}
        onCancel={() => setSoldSheetId(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 8 },
  iconWrap: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  emptyText: { textAlign: 'center', lineHeight: 18 },
  scroll: { paddingHorizontal: 18, paddingBottom: 110 },
  listingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 14, marginBottom: 12,
  },
  listingTitle: { fontSize: 14.5, fontWeight: '600', color: colors.ink },
  expiryCaption: { fontSize: 12, color: colors.inkSoft, marginTop: 4 },
  unpublishedBadge: {
    alignSelf: 'flex-start', backgroundColor: colors.warnBg, borderRadius: radius.pill,
    paddingHorizontal: 10, height: 22, justifyContent: 'center', marginTop: 6,
  },
  unpublishedBadgeText: { fontSize: 11, fontWeight: '700', color: colors.ink },
  pendingReviewBadge: {
    alignSelf: 'flex-start', backgroundColor: colors.warnBg, borderRadius: radius.pill,
    paddingHorizontal: 10, height: 22, justifyContent: 'center', marginTop: 6,
  },
  pendingReviewBadgeText: { fontSize: 11, fontWeight: '700', color: colors.ink },
  draftBadge: {
    alignSelf: 'flex-start', backgroundColor: colors.surface, borderRadius: radius.pill,
    paddingHorizontal: 10, height: 22, justifyContent: 'center', marginTop: 6,
  },
  draftBadgeText: { fontSize: 11, fontWeight: '700', color: colors.inkSoft },
  autoHiddenBadge: { alignSelf: 'flex-start', backgroundColor: colors.warnBg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3, marginTop: 4 },
  autoHiddenBadgeText: { ...type.tiny, color: colors.accentDeep, fontWeight: '700' },
  rejectedBadge: {
    alignSelf: 'flex-start', backgroundColor: '#f5e4e2', borderRadius: radius.pill,
    paddingHorizontal: 10, height: 22, justifyContent: 'center', marginTop: 6,
  },
  rejectedBadgeText: { fontSize: 11, fontWeight: '700', color: colors.danger },
  soldBadge: {
    alignSelf: 'flex-start', backgroundColor: colors.primaryTint, borderRadius: radius.pill,
    paddingHorizontal: 10, height: 22, justifyContent: 'center', marginTop: 6,
  },
  soldBadgeText: { fontSize: 11, fontWeight: '700', color: colors.success },
  republishHint: { fontSize: 12, color: colors.inkSoft, marginTop: 6 },
  rowError: { fontSize: 12, color: colors.danger, marginTop: 6 },
  rowActionBtn: {
    height: 36, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.ink,
    paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start',
  },
  rowActionSpacing: { marginTop: 10 },
  rowActionBtnText: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  manageLabel: {
    ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line,
  },
  manageRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionPill: {
    flex: 1, height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 4,
  },
  actionDelete: { borderColor: '#E3C4C1' },
  actionSold: { borderColor: colors.primaryTint, backgroundColor: colors.primaryTint },
  actionPillLabel: { fontSize: 10.5, fontWeight: '700', color: colors.ink },
});
