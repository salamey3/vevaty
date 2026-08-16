import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Image, Modal, TextInput, Linking } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import Button from '../components/Button';
import LanguageSwitch from '../components/LanguageSwitch';
import ConfirmDialog from '../components/ConfirmDialog';
import PhotoGallery from '../components/PhotoGallery';
import SpinViewer from '../components/SpinViewer';
import ListingCard from '../components/ListingCard';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useChat } from '../store/ChatStore';
import { useFavorites } from '../store/FavoritesStore';
import { useSettings } from '../store/SettingsStore';
import { supabase } from '../lib/supabase';
import { RootStackParamList } from '../navigation/types';
import { useIsDesktop } from '../hooks/useResponsive';
import { useLanguage } from '../i18n/LanguageContext';
import { attrHasValue, formatAttrValue } from '../lib/attributeFormat';
import { listingTitle, listingDescription } from '../lib/listingText';

// Phase 4 item 16 -- "Member since Month Year", derived from the seller's
// join-date timestamp already carried on the listing (see AppStore's
// dbListingToLocal). Deliberately coarse (month + year, not a full date) --
// matches how every marketplace app shows this, and avoids implying a
// precision ("member since Aug 14") the data isn't meant to convey.
function formatMemberSince(ts: number, language: 'en' | 'ar'): string {
  return new Date(ts).toLocaleDateString(language === 'ar' ? 'ar' : 'en-US', { month: 'long', year: 'numeric' });
}

const REPORT_REASONS = ['spam', 'prohibited', 'scam', 'other'] as const;
type ReportReason = (typeof REPORT_REASONS)[number];

type Props = NativeStackScreenProps<RootStackParamList, 'ListingDetail'>;

export default function ListingDetailScreen({ route, navigation }: Props) {
  const { listings, profile, deleteListing, isVerified } = useAppStore();
  const { categoryById, ancestorsOf, categoryMatches, resolveAttributesForCategory, isServiceCategory } = useSettings();
  const { getOrCreateThread } = useChat();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { t, language, isRTL } = useLanguage();
  // Same fixed-bottom-bar-over-Android's-nav-bar issue TabBar.tsx and
  // CreateListingScreen's footer had -- the mobile-only "Contact & Buy"
  // footer below is pinned to the bottom of the screen too.
  const insets = useSafeAreaInsets();
  const [favBusy, setFavBusy] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [reportVisible, setReportVisible] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>('spam');
  const [reportNote, setReportNote] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  // 'photos', or the id of one of the listing's spinSets (there can be
  // more than one -- e.g. "Exterior"/"Interior" for a car, one per room
  // for a property -- see the SpinSet type and viewToggle below).
  const [viewMode, setViewMode] = useState<string>('photos');
  // Seller contact reveal (gated behind login -- see AppStore's
  // isVerified). Fetched lazily, only once the buyer actually taps the
  // CTA button, via the get_seller_phone RPC -- the phone column itself
  // has SELECT revoked on myazar.profiles for anon/authenticated roles,
  // so this RPC (SECURITY DEFINER) is the only way to ever read it back.
  const [contactPhone, setContactPhone] = useState<string | null>(null);
  const [contactLoading, setContactLoading] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const listing = useMemo(() => listings.find((l) => l.id === route.params.listingId), [listings, route.params.listingId]);
  const cat = listing ? categoryById(listing.cat) : undefined;
  const catAncestors = listing ? ancestorsOf(listing.cat) : [];
  const specs = useMemo(() => {
    if (!listing) return [];
    return resolveAttributesForCategory(listing.cat).filter((a) => attrHasValue(listing.attributes[a.slug]));
  }, [listing, resolveAttributesForCategory]);
  const isDesktop = useIsDesktop();
  const isOwner = !!listing && listing.sellerId === profile.id;
  const favorited = !!listing && isFavorite(listing.id);

  // Phase 4 item 18 -- other active listings in the same top-level
  // category, nearest-price-first. Same-category-first (rather than pure
  // recency) is what makes this feel like "similar items" instead of just
  // another copy of the home feed.
  const relatedListings = useMemo(() => {
    if (!listing) return [];
    const topId = catAncestors[0]?.id ?? listing.cat;
    return listings
      .filter((l) => l.id !== listing.id && l.status === 'active' && categoryMatches(l.cat, topId))
      .sort((a, b) => Math.abs(a.price - listing.price) - Math.abs(b.price - listing.price))
      .slice(0, 10);
  }, [listing, listings, catAncestors, categoryMatches]);

  const handleToggleFavorite = async () => {
    if (!listing) return;
    if (!isVerified) {
      navigation.navigate('Auth');
      return;
    }
    if (favBusy) return;
    setFavBusy(true);
    try {
      await toggleFavorite(listing.id);
    } catch {
      // Best-effort -- nothing else to show for a single heart tap failing.
    } finally {
      setFavBusy(false);
    }
  };

  const runDelete = async () => {
    if (!listing) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteListing(listing.id);
      navigation.popToTop();
    } catch (e: any) {
      setDeleting(false);
      setConfirmingDelete(false);
      setDeleteError(e?.message || t('listingDetail.deleteFailed'));
    }
  };

  // The call-to-action shouldn't say "buy" for something posted for rent,
  // or for a service that isn't bought/rented at all -- e.g. a plumber is
  // "hired", not "bought".
  const ctaLabel = useMemo(() => {
    if (!listing) return t('listingDetail.contactToBuy');
    if (isServiceCategory(listing.cat)) return t('listingDetail.contactToHire');
    if (listing.attributes['listing_purpose'] === 'rent') return t('listingDetail.contactToRent');
    return t('listingDetail.contactToBuy');
  }, [listing, isServiceCategory, t]);

  const revealContact = async () => {
    if (!listing) return;
    setContactLoading(true);
    setContactError(null);
    try {
      const { data, error } = await supabase.rpc('get_seller_phone', { p_listing_id: listing.id });
      if (error) throw error;
      if (!data) throw new Error('No phone on file for this seller');
      setContactPhone(data);
    } catch (e: any) {
      setContactError(t('listingDetail.contactLoadFailed'));
    } finally {
      setContactLoading(false);
    }
  };

  // Phase 4 item 11 -- unlike the phone reveal above, chat needs no
  // separate "reveal" step: there's no sensitive data to protect, so the
  // button just opens (or creates) the thread directly.
  const openChat = async () => {
    if (!listing) return;
    setChatLoading(true);
    setChatError(null);
    try {
      const threadId = await getOrCreateThread(listing.id, listing.sellerId);
      navigation.navigate('ChatThread', { threadId });
    } catch (e: any) {
      setChatError(t('listingDetail.chatFailed'));
    } finally {
      setChatLoading(false);
    }
  };

  const whatsappUrl = useMemo(() => {
    if (!listing || !contactPhone) return null;
    const digits = contactPhone.replace(/[^\d]/g, '');
    const text = t('listingDetail.whatsappMessage', { title: listingTitle(listing, language) });
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  }, [listing, contactPhone, language, t]);

  if (!listing) {
    return (
      <Screen>
        <View style={styles.center}><Text style={type.body}>{t('listingDetail.unavailable')}</Text></View>
      </Screen>
    );
  }

  const openReport = () => {
    setReportReason('spam');
    setReportNote('');
    setReportError(null);
    setReportSubmitted(false);
    setReportVisible(true);
  };

  const submitReport = async () => {
    if (profile.id === 'me') {
      setReportError(t('listingDetail.reportFailed'));
      return;
    }
    setReportSubmitting(true);
    setReportError(null);
    try {
      const label = t(`listingDetail.reportReason.${reportReason}` as any);
      const reason = reportNote.trim() ? `${label} — ${reportNote.trim()}` : label;
      const { error } = await supabase.from('reports').insert({
        reporter_id: profile.id,
        reported_listing_id: listing.id,
        reported_user_id: listing.sellerId,
        reason,
      });
      if (error) throw error;
      setReportSubmitted(true);
    } catch (e: any) {
      setReportError(e?.message || t('listingDetail.reportFailed'));
    } finally {
      setReportSubmitting(false);
    }
  };

  const reportModal = (
    <Modal transparent visible={reportVisible} animationType="fade" onRequestClose={() => setReportVisible(false)}>
      <View style={styles.reportBackdrop}>
        <Pressy onPress={() => setReportVisible(false)} style={StyleSheet.absoluteFill} />
        <View style={styles.reportCard}>
          {reportSubmitted ? (
            <>
              <Text style={type.h3}>{t('listingDetail.reportSubmitted')}</Text>
              <Button label={t('common.close')} onPress={() => setReportVisible(false)} style={{ marginTop: 16 }} />
            </>
          ) : (
            <>
              <Text style={type.h3}>{t('listingDetail.reportTitle')}</Text>
              <View style={styles.reportReasonRow}>
                {REPORT_REASONS.map((r) => (
                  <Pressy
                    key={r}
                    onPress={() => setReportReason(r)}
                    style={[styles.reportChip, reportReason === r && styles.reportChipActive]}
                  >
                    <Text style={[styles.reportChipText, reportReason === r && styles.reportChipTextActive]}>
                      {t(`listingDetail.reportReason.${r}` as any)}
                    </Text>
                  </Pressy>
                ))}
              </View>
              <TextInput
                value={reportNote}
                onChangeText={setReportNote}
                placeholder={t('listingDetail.reportNotePlaceholder')}
                multiline
                style={styles.reportInput}
              />
              {reportError && <Text style={styles.reportErrorText}>{reportError}</Text>}
              <View style={styles.reportActions}>
                <Pressy onPress={() => setReportVisible(false)} style={styles.reportCancelBtn}>
                  <Text style={styles.reportCancelBtnText}>{t('common.cancel')}</Text>
                </Pressy>
                <Button label={t('listingDetail.reportSubmit')} onPress={submitReport} loading={reportSubmitting} style={{ flex: 1 }} />
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );

  const editButton = isOwner && (
    <View style={styles.ownerActions}>
      <Pressy
        onPress={() => navigation.navigate('CreateListing', { editListingId: listing.id })}
        style={styles.editBtn}
      >
        <Icon name="edit" size={15} color={colors.ink} />
        <Text style={styles.editBtnText}>{t('common.edit')}</Text>
      </Pressy>
      <Pressy onPress={() => setConfirmingDelete(true)} disabled={deleting} style={styles.deleteIconBtn}>
        <Icon name="trash" size={15} color={colors.danger} />
      </Pressy>
    </View>
  );

  const confirmDialog = (
    <ConfirmDialog
      visible={confirmingDelete}
      title={t('listingDetail.deleteConfirmTitle')}
      message={deleteError || t('listingDetail.deleteConfirmMessage')}
      confirmLabel={t('listingDetail.deleteListing')}
      cancelLabel={t('common.cancel')}
      destructive
      loading={deleting}
      onConfirm={runDelete}
      onCancel={() => {
        setConfirmingDelete(false);
        setDeleteError(null);
      }}
    />
  );

  const details = (
    <>
      <View style={styles.priceRow}>
        <Text style={styles.price}>${listing.price.toLocaleString()}</Text>
        {editButton}
      </View>
      <Text style={styles.title}>{listingTitle(listing, language)}</Text>
      <View style={[styles.metaRow, isRTL && styles.metaRowRTL]}>
        <Icon name="location" size={13} color={colors.inkSoft} />
        <Text style={type.soft}>{listing.district}</Text>
      </View>

      {listing.aiGenerated && (
        <View style={styles.aiTag}>
          <Icon name="sparkle" size={12} color={colors.ink} />
          <Text style={styles.aiTagText}>{t('listingDetail.aiTag')}</Text>
        </View>
      )}

      <Text style={styles.sectionLabel}>{t('listingDetail.description')}</Text>
      <Text style={styles.desc}>{listingDescription(listing, language) || t('listingDetail.noDescription')}</Text>

      {specs.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>{t('listingDetail.specs')}</Text>
          <View style={styles.specsGrid}>
            {specs.map((a) => (
              <View key={a.id} style={[styles.specRow, isRTL && styles.specRowRTL]}>
                <Text style={type.soft}>{language === 'ar' ? a.labelAr : a.labelEn}</Text>
                <Text style={type.body}>{formatAttrValue(a, listing.attributes[a.slug], language)}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      <Text style={styles.sectionLabel}>{t('listingDetail.seller')}</Text>
      <Pressy
        onPress={() => navigation.push('SellerProfile', { sellerId: listing.sellerId })}
        style={styles.sellerRow}
        accessibilityLabel="View seller profile"
      >
        <View style={styles.sellerAvatar}>
          <Icon name="user" size={18} color={colors.inkSoft} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.sellerNameRow}>
            <Text style={type.h3}>{listing.sellerName}</Text>
            {listing.sellerVerified && (
              <View style={styles.verifiedBadge}>
                <Icon name="checkCircle" size={11} color={colors.success} />
                <Text style={styles.verifiedBadgeText}>{t('listingDetail.verifiedSeller')}</Text>
              </View>
            )}
          </View>
          <View style={styles.metaRow}>
            <Icon name="star" size={12} color={colors.inkSoft} />
            <Text style={type.tiny}>{listing.rating.toFixed(1)} {t('listingDetail.rating')}</Text>
          </View>
          <Text style={styles.memberSince}>
            {t('listingDetail.memberSince', { date: formatMemberSince(listing.sellerMemberSince, language) })}
          </Text>
        </View>
        <Icon name="chevronRight" size={16} color={colors.inkSoft} />
      </Pressy>

      {relatedListings.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>{t('listingDetail.relatedListings')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.relatedRow}>
            {relatedListings.map((item) => (
              <ListingCard
                key={item.id}
                listing={item}
                width={140}
                onPress={() => navigation.push('ListingDetail', { listingId: item.id })}
              />
            ))}
          </ScrollView>
        </>
      )}
    </>
  );

  // Optional chaining here is deliberate defense-in-depth: a listing
  // loaded from an older on-device cache (pre-dating this field, or still
  // carrying the old flat spinPhotos shape) should never crash the render
  // -- see the normalizeListing comment in AppStore.tsx for the full story
  // on why this actually happened once.
  const spinSets = listing.spinSets ?? [];
  const hasSpin = spinSets.length > 0;
  const activeSpinSet = spinSets.find((s) => s.id === viewMode);

  // A small Photos/360° View toggle, rendered as a sibling ABOVE the photo
  // box (not inside it) -- the box itself (styles.photo/desktopPhoto) is a
  // fixed-size, center-aligned container that PhotoGallery/SpinViewer are
  // meant to fill edge-to-edge, so adding the toggle inside it would fight
  // that sizing. A listing can have more than one named spin (e.g.
  // "Exterior"/"Interior" for a car, one per room for a property), so this
  // is a horizontally-scrollable chip per spin rather than a fixed
  // two-way toggle -- each chip's own tapped-set id becomes viewMode.
  const viewToggle = hasSpin && (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.viewToggleRow}>
      <Pressy
        onPress={() => setViewMode('photos')}
        style={[styles.viewToggleBtn, viewMode === 'photos' && styles.viewToggleBtnActive]}
      >
        <Text style={[styles.viewToggleText, viewMode === 'photos' && styles.viewToggleTextActive]}>
          {t('listingDetail.photosTab')}
        </Text>
      </Pressy>
      {spinSets.map((set, i) => (
        <Pressy
          key={set.id}
          onPress={() => setViewMode(set.id)}
          style={[styles.viewToggleBtn, viewMode === set.id && styles.viewToggleBtnActive]}
        >
          <Icon name="rotate" size={12} color={viewMode === set.id ? colors.white : colors.inkSoft} />
          <Text style={[styles.viewToggleText, viewMode === set.id && styles.viewToggleTextActive]} numberOfLines={1}>
            {set.label || t('listingDetail.spinTabDefaultName', { n: i + 1 })}
          </Text>
        </Pressy>
      ))}
    </ScrollView>
  );

  const photoBox = (extraStyle: any) => (
    <View style={extraStyle}>
      {activeSpinSet ? (
        <SpinViewer frames={activeSpinSet.frames} />
      ) : (
        <PhotoGallery photos={listing.photos} fallbackIconName={(cat?.icon as any) || 'bag'} />
      )}
    </View>
  );

  // Single CTA slot, reused by both the desktop and mobile layouts below.
  // Never shown to the listing's own owner -- there's nothing to contact
  // yourself about (this was a latent gap before Phase 4: the old
  // Call/WhatsApp-only version didn't check isOwner either).
  // Logged out -> tapping it opens AuthScreen (no returnTo -- this same
  // screen just re-renders once isVerified flips true, no navigation
  // needed). Logged in -> which of "Message seller" (Phase 4 item 11) and
  // phone/WhatsApp (items 12-13) actually show is gated by the seller's
  // own per-listing choice (Phase 4 item 14, `listing.contactMethod`) --
  // 'both' is the default for every listing, matching the original
  // always-show-everything behavior these two blocks had before item 14.
  const showChat = listing.contactMethod !== 'phone';
  const showPhone = listing.contactMethod !== 'chat';
  const ctaSection = (extraStyle?: any) => {
    if (isOwner) return null;
    return (
      <View style={extraStyle}>
        {!isVerified ? (
          <Button label={ctaLabel} onPress={() => navigation.navigate('Auth')} />
        ) : (
          <>
            {showChat && (
              <Pressy onPress={openChat} disabled={chatLoading} style={[styles.messageBtn, chatLoading && styles.contactBtnLoading]}>
                <Icon name="chat" size={16} color={colors.white} />
                <Text style={styles.messageBtnText}>
                  {chatLoading ? t('common.loading') : t('listingDetail.messageSeller')}
                </Text>
              </Pressy>
            )}
            {showPhone && (contactPhone ? (
              <View style={styles.contactRow}>
                <Pressy onPress={() => Linking.openURL(`tel:${contactPhone}`)} style={styles.contactBtn}>
                  <Icon name="phone" size={16} color={colors.ink} />
                  <Text style={styles.contactBtnText}>{t('listingDetail.callSeller')}</Text>
                </Pressy>
                <Pressy
                  onPress={() => whatsappUrl && Linking.openURL(whatsappUrl)}
                  style={styles.contactBtn}
                >
                  <Text style={styles.contactBtnText}>{t('listingDetail.whatsappSeller')}</Text>
                </Pressy>
              </View>
            ) : (
              <Pressy onPress={revealContact} disabled={contactLoading} style={styles.showPhoneBtn}>
                <Text style={styles.showPhoneBtnText}>
                  {contactLoading ? t('common.loading') : t('listingDetail.showPhoneNumber')}
                </Text>
              </Pressy>
            ))}
          </>
        )}
        {!!contactError && <Text style={styles.reportErrorText}>{contactError}</Text>}
        {!!chatError && <Text style={styles.reportErrorText}>{chatError}</Text>}
      </View>
    );
  };

  const topBar = (
    <View style={styles.topBar}>
      <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
        <Icon name="back" size={18} />
      </Pressy>
      <Text style={styles.topBarTitle} numberOfLines={1}>
        {cat
          ? [...catAncestors, cat].map((c) => (language === 'ar' ? c.nameAr : c.nameEn)).join(' · ')
          : t('listingDetail.fallbackTitle')}
      </Text>
      <View style={styles.topBarActions}>
        {!isOwner && (
          <Pressy onPress={handleToggleFavorite} disabled={favBusy} style={styles.iconBtn} accessibilityLabel="Save listing">
            <Icon name="heart" size={17} color={favorited ? colors.danger : colors.inkSoft} filled={favorited} />
          </Pressy>
        )}
        {!isOwner && (
          <Pressy onPress={openReport} style={styles.iconBtn} accessibilityLabel="Report listing">
            <Icon name="flag" size={16} color={colors.inkSoft} />
          </Pressy>
        )}
        <LanguageSwitch compact />
      </View>
    </View>
  );

  if (isDesktop) {
    return (
      <Screen edges={['top', 'left', 'right']} maxWidth={1040}>
        {topBar}
        <ScrollView contentContainerStyle={styles.desktopScroll}>
          <View style={styles.desktopRow}>
            <View style={styles.desktopMediaCol}>
              {viewToggle}
              {photoBox(styles.desktopPhoto)}
            </View>
            <View style={styles.desktopInfo}>
              {details}
              {ctaSection({ marginTop: 26 })}
            </View>
          </View>
        </ScrollView>
        {confirmDialog}
        {reportModal}
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'left', 'right']}>
      {topBar}

      <ScrollView contentContainerStyle={styles.scroll}>
        {hasSpin && <View style={styles.viewToggleMobileWrap}>{viewToggle}</View>}
        {photoBox(styles.photo)}
        <View style={styles.card}>{details}</View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: 18 + insets.bottom }]}>
        {ctaSection()}
      </View>
      {confirmDialog}
      {reportModal}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, height: 48,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  topBarActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  topBarTitle: { ...type.h3, flex: 1, textAlign: 'center' },
  scroll: { paddingBottom: 20 },
  photo: {
    // 3:4 (width:height) instead of a fixed pixel height -- tall enough to
    // do right by the vertical photos most sellers actually shoot, while
    // still showing a landscape photo without excessive letterboxing.
    // PhotoGallery/SpinViewer crop to `cover` in this box; the uncropped
    // original is always still reachable by tapping through to the
    // lightbox.
    aspectRatio: 3 / 4, marginHorizontal: 18, borderRadius: radius.lg,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  photoImg: { width: '100%', height: '100%' },
  desktopMediaCol: { flexShrink: 0, gap: 10 },
  viewToggleMobileWrap: { marginHorizontal: 18, marginBottom: 10 },
  viewToggleRow: {
    flexDirection: 'row', gap: 6,
  },
  viewToggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, height: 30, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  viewToggleBtnActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  viewToggleText: { ...type.tiny, fontWeight: '600', color: colors.inkSoft },
  viewToggleTextActive: { color: colors.white },
  card: { padding: 18 },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  ownerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, height: 32, borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
  },
  editBtnText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  deleteIconBtn: {
    width: 32, height: 32, borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  price: { fontSize: 24, fontWeight: '700', color: colors.ink },
  title: { ...type.h2, marginTop: 4, marginBottom: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  // This app doesn't do a global RTL flip (see LanguageContext's
  // applyDocumentDirection, which is a web-only no-op on native) --
  // instead, each row-based layout mirrors itself explicitly via isRTL,
  // same pattern TabBar.tsx/Screen.tsx already use. Icon-then-text reads
  // backwards in Arabic; row-reverse puts the text first, icon trailing.
  metaRowRTL: { flexDirection: 'row-reverse' },
  aiTag: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: colors.warnBg, borderRadius: radius.pill, paddingHorizontal: 10, height: 28, marginTop: 12,
  },
  aiTagText: { fontSize: 11.5, fontWeight: '600', color: colors.ink },
  sectionLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 22, marginBottom: 8 },
  desc: { ...type.body, lineHeight: 21 },
  specsGrid: { gap: 2 },
  specRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  // Label first, value trailing -- correct in LTR (label left, value
  // right) but backwards in Arabic, where the label should lead from the
  // right. row-reverse swaps which side each Text renders on without
  // touching justify-content: space-between.
  specRowRTL: { flexDirection: 'row-reverse' },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sellerAvatar: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  sellerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#e3efe8', borderRadius: radius.pill, paddingHorizontal: 8, height: 20,
  },
  verifiedBadgeText: { fontSize: 10.5, fontWeight: '700', color: colors.success },
  memberSince: { ...type.tiny, marginTop: 3 },
  relatedRow: { gap: 12, paddingTop: 2, paddingBottom: 4 },
  // paddingBottom is applied inline (18 + the live safe-area inset) instead
  // of hardcoded here -- see the insets comment near the top of the
  // component.
  footer: {
    paddingHorizontal: 18, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.bg,
  },
  messageBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: radius.pill, backgroundColor: colors.ink,
  },
  messageBtnText: { fontSize: 15.5, fontWeight: '600', color: colors.white },
  contactBtnLoading: { opacity: 0.7 },
  contactRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  contactBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 44, borderRadius: radius.pill, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line,
  },
  contactBtnText: { fontSize: 13.5, fontWeight: '600', color: colors.ink },
  showPhoneBtn: { alignItems: 'center', justifyContent: 'center', height: 40, marginTop: 6 },
  showPhoneBtnText: { fontSize: 13.5, fontWeight: '600', color: colors.inkSoft, textDecorationLine: 'underline' },

  // Desktop: image and details sit side by side, "Contact & Buy" moves
  // inline instead of pinned to the bottom of the browser window.
  desktopScroll: { paddingTop: 8, paddingBottom: 60 },
  desktopRow: { flexDirection: 'row', gap: 40 },
  desktopPhoto: {
    // Same 3:4 as the mobile photo box (see its comment) -- width stays
    // fixed since this column sits beside the details column, height
    // follows from the ratio.
    width: 440, aspectRatio: 3 / 4, borderRadius: radius.lg, flexShrink: 0,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  desktopInfo: { flex: 1, paddingTop: 4 },

  reportBackdrop: {
    flex: 1, backgroundColor: 'rgba(20,20,22,0.45)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  reportCard: {
    width: '100%', maxWidth: 380, backgroundColor: colors.bg,
    borderRadius: radius.lg, padding: 22, gap: 6,
  },
  reportReasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 4 },
  reportChip: {
    height: 32, paddingHorizontal: 14, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  reportChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  reportChipText: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft },
  reportChipTextActive: { color: colors.white },
  reportInput: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, paddingTop: 10, height: 80,
    textAlignVertical: 'top', fontSize: 13.5, color: colors.ink, marginTop: 10,
  },
  reportErrorText: { fontSize: 12.5, color: colors.danger, marginTop: 8 },
  reportActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  reportCancelBtn: { height: 52, paddingHorizontal: 18, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  reportCancelBtnText: { fontSize: 14.5, fontWeight: '600', color: colors.inkSoft },
});
