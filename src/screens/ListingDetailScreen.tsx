import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Image, Modal, TextInput, Linking } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import Button from '../components/Button';
import LanguageSwitch from '../components/LanguageSwitch';
import ConfirmDialog from '../components/ConfirmDialog';
import PhotoGallery, { PhotoGalleryHandle } from '../components/PhotoGallery';
import CarouselArrows from '../components/CarouselArrows';
import { useGoBack } from '../hooks/useGoBack';
import SpinViewer from '../components/SpinViewer';
import VideoPlayer from '../components/VideoPlayer';
import { nudgeVideoStatus } from '../lib/bunnyVideo';
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
import { listingTitle, listingDescription, listingDistrict } from '../lib/listingText';
import { absoluteDate, relativeTimeFrom } from '../lib/relativeTime';
import { useRtlCarousel } from '../lib/useRtlCarousel';

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

  // RTL swipe direction via reversed order + viewport parked at the far end,
  // rather than a scaleX(-1) mirror on the scroller -- see useRtlCarousel.
  const {
    ordered: orderedRelated,
    scrollRef: relatedScrollRef,
    onContentSizeChange: onRelatedContentSizeChange,
  } = useRtlCarousel(relatedListings, isRTL);

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

  const spinSets = listing.spinSets ?? [];
  const hasSpin = spinSets.length > 0;

  // Only the seller ever sees this (ctaSection already returns null for
  // isOwner, and RLS hides a non-active listing from everyone else) -- a
  // small heads-up about where their own listing stands in the moderation
  // pipeline, right where they'd otherwise expect the price/edit row.
  const ownerModerationNotice = isOwner && listing.status === 'pending_review' && (
    <View style={styles.ownerModerationNotice}>
      <Icon name="rotate" size={14} color={colors.inkSoft} />
      <Text style={styles.ownerModerationNoticeText}>{t('listingDetail.pendingReviewNotice')}</Text>
    </View>
  );
  const ownerRejectedNotice = isOwner && listing.status === 'rejected' && (
    <View style={[styles.ownerModerationNotice, styles.ownerRejectedNotice]}>
      <Icon name="flag" size={14} color={colors.danger} />
      <Text style={styles.ownerModerationNoticeText}>
        {listing.moderationReason ? `${t('listingDetail.rejectedNotice')} ${listing.moderationReason}` : t('listingDetail.rejectedNotice')}
      </Text>
    </View>
  );

  const details = (
    <>
      <View style={[styles.priceRow, isRTL && styles.priceRowRTL]}>
        <Text style={styles.price}>${listing.price.toLocaleString()}</Text>
        {editButton}
      </View>
      {ownerModerationNotice}
      {ownerRejectedNotice}
      <Text style={[styles.title, isRTL && styles.rtlText]}>{listingTitle(listing, language)}</Text>
      {/* Category, area and age, in the body rather than only in the top
          bar. The bar has the same chain in it, but it's one truncated line
          competing with the back and share buttons, and it scrolls away --
          so from inside a listing there was no reliable way to answer
          "what section is this in?". These are also the three things a
          buyer weighs before messaging: what it is filed under, how far
          away it is, and whether it has been sitting unsold. */}
      <View style={styles.metaBlock}>
        {cat && (
          // Tappable: seeing what section something is in immediately
          // raises "what else is in there?", and the answer was three
          // navigations away. Goes to the top-level category page, which is
          // what HomeCategory takes -- the leaf shows up as its
          // subcategory filter once you're there.
          <Pressy
            onPress={() =>
              navigation.navigate('MainTabs', {
                screen: 'HomeTab',
                params: { screen: 'HomeCategory', params: { cat: catAncestors[0]?.id ?? listing.cat } },
              } as any)
            }
            style={[styles.metaRow, isRTL && styles.metaRowRTL]}
          >
            <Icon name={(cat.icon as any) || 'bag'} size={13} color={colors.inkSoft} />
            <Text style={[type.soft, styles.categoryLink]}>
              {[...catAncestors, cat].map((c) => (language === 'ar' ? c.nameAr : c.nameEn)).join(' › ')}
            </Text>
            <Icon name="chevronRight" size={12} color={colors.inkSoft} />
          </Pressy>
        )}
        <View style={[styles.metaRow, isRTL && styles.metaRowRTL]}>
          <Icon name="location" size={13} color={colors.inkSoft} />
          <Text style={type.soft}>
            {[listingDistrict(listing, language), listing.caza, listing.governorate]
              .filter((v, i, arr) => !!v && arr.indexOf(v) === i)
              .join(isRTL ? '، ' : ', ')}
          </Text>
        </View>
        <View style={[styles.metaRow, isRTL && styles.metaRowRTL]}>
          <Icon name="check" size={13} color={colors.inkSoft} />
          <Text style={type.soft}>{t('listingDetail.postedOn', { date: absoluteDate(listing.createdAt, language) })} · {relativeTimeFrom(listing.createdAt, language)}</Text>
        </View>
      </View>

      {listing.aiGenerated && (
        <View style={[styles.aiTag, isRTL && styles.aiTagRTL]}>
          <Icon name="sparkle" size={12} color={colors.ink} />
          <Text style={styles.aiTagText}>{t('listingDetail.aiTag')}</Text>
        </View>
      )}

      <Text style={[styles.sectionLabel, isRTL && styles.rtlText]}>{t('listingDetail.description')}</Text>
      <Text style={[styles.desc, isRTL && styles.rtlText]}>{listingDescription(listing, language) || t('listingDetail.noDescription')}</Text>

      {specs.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, isRTL && styles.rtlText]}>{t('listingDetail.specs')}</Text>
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

      <Text style={[styles.sectionLabel, isRTL && styles.rtlText]}>{t('listingDetail.seller')}</Text>
      <Pressy
        onPress={() => navigation.push('SellerProfile', { sellerId: listing.sellerId })}
        style={[styles.sellerRow, isRTL && styles.sellerRowRTL]}
        accessibilityLabel="View seller profile"
      >
        <View style={styles.sellerAvatar}>
          <Icon name="user" size={18} color={colors.inkSoft} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={[styles.sellerNameRow, isRTL && styles.sellerNameRowRTL]}>
            <Text style={type.h3}>{listing.sellerName}</Text>
            {listing.sellerVerified && (
              <View style={styles.verifiedBadge}>
                <Icon name="checkCircle" size={11} color={colors.success} />
                <Text style={styles.verifiedBadgeText}>{t('listingDetail.verifiedSeller')}</Text>
              </View>
            )}
          </View>
          <View style={[styles.metaRow, isRTL && styles.metaRowRTL]}>
            <Icon name="star" size={12} color={colors.inkSoft} />
            <Text style={type.tiny}>{listing.rating.toFixed(1)} {t('listingDetail.rating')}</Text>
          </View>
          <Text style={[styles.memberSince, isRTL && styles.rtlText]}>
            {t('listingDetail.memberSince', { date: formatMemberSince(listing.sellerMemberSince, language) })}
          </Text>
        </View>
        <View style={isRTL && styles.chevronRTL}>
          <Icon name="chevronRight" size={16} color={colors.inkSoft} />
        </View>
      </Pressy>

    </>
  );

  // Split out from `details` above so it can render AFTER the CTA button
  // on desktop (see the isDesktop render below) -- ctaSection used to come
  // after this, which buried "Contact & Buy" beneath a whole row of other
  // listings. Mobile keeps the original order (this right after `details`,
  // same position it held before the split), since its CTA already lives
  // in its own pinned footer rather than in the scroll flow.
  const relatedSection = relatedListings.length > 0 && (
    <>
      <Text style={[styles.sectionLabel, isRTL && styles.rtlText]}>{t('listingDetail.relatedListings')}</Text>
      <ScrollView
        ref={relatedScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        // flexGrow:0 matters here the same way it does on the home screen's
        // category slider (see catSlider's comment there for the full
        // story): a horizontal ScrollView with no height of its own
        // stretches to fill whatever vertical space its flex parent has to
        // give -- on desktop that parent is desktopInfo (flex:1, stretched
        // tall to match the media column), so without this every card in
        // the row got stretched into a tall sliver instead of staying a
        // normal 3:4 thumbnail.
        style={styles.relatedScroll}
        contentContainerStyle={styles.relatedRow}
        onContentSizeChange={onRelatedContentSizeChange}
        // Nests inside this screen's outer vertical ScrollView -- same
        // Android nested-scroll gesture-ownership gap as the home
        // screen's carousels (see that comment for the full story).
        nestedScrollEnabled
      >
        {orderedRelated.map((item) => (
          <ListingCard
            key={item.id}
            listing={item}
            width={140}
            onPress={() => navigation.push('ListingDetail', { listingId: item.id })}
          />
        ))}
      </ScrollView>
    </>
  );

  // Optional chaining here is deliberate defense-in-depth: a listing
  // loaded from an older on-device cache (pre-dating this field, or still
  // carrying the old flat spinPhotos shape) should never crash the render
  // -- see the normalizeListing comment in AppStore.tsx for the full story
  // on why this actually happened once.
  // Refreshing on a listing leaves no history to go back to, so the arrow
  // falls back to the category this listing sits in -- the screen it would
  // have come from, and more useful than dropping someone at the home
  // feed with their place lost.
  const goBack = useGoBack(
    listing
      ? () =>
          navigation.navigate('MainTabs', {
            screen: 'HomeTab',
            params: { screen: 'HomeCategory', params: { cat: ancestorsOf(listing.cat)[0]?.id ?? listing.cat } },
          } as any)
      : undefined
  );
  const galleryRef = useRef<PhotoGalleryHandle>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [spinIndex, setSpinIndex] = useState(0);
  // Back to a tab switcher (Phase after the below-description/split-box
  // experiment), now with a third tab and a much harder-to-miss header --
  // the earlier "spread across the page" layouts were themselves a fix for
  // an easy-to-miss tab, but the user preferred tabs back once the tab
  // strip itself couldn't be missed. The Videos tab was built as an empty
  // slot ahead of the feature; it now shows the listing's real video.
  const [mediaTab, setMediaTab] = useState<'photos' | 'spin' | 'video'>('photos');
  const [mediaExpanded, setMediaExpanded] = useState(true);

  // Only a finished video is playable. RLS already hides anyone else's
  // unfinished video, so a non-ready one here belongs to the seller looking
  // at their own listing while it encodes -- worth telling them so, rather
  // than showing the same "no videos" state a stranger sees.
  const video = listing.video;
  const playableVideo = video && video.status === 'ready' ? video : null;

  // A listing opened while its video is still encoding asks once for the
  // current state, so the seller isn't left refreshing. The answer lands on
  // the next sync rather than instantly, which is fine -- this is a nudge,
  // not a subscription.
  useEffect(() => {
    if (video && video.status !== 'ready' && video.status !== 'failed') {
      nudgeVideoStatus(video.guid);
    }
  }, [video?.guid, video?.status]);

  const mediaHeader = (
    <Pressy onPress={() => setMediaExpanded((e) => !e)} style={styles.mediaHeader}>
      <Text style={styles.mediaHeaderText}>{t('listingDetail.media')}</Text>
      {/* No dedicated chevron-down glyph in the icon set -- chevronRight
          rotated 90° points down (expanded); its unrotated resting
          position already points the right direction for collapsed, same
          reuse trick as chevronRTL elsewhere in this file. */}
      <View style={[styles.mediaChevron, mediaExpanded && styles.mediaChevronExpanded]}>
        <Icon name="chevronRight" size={13} color={colors.ink} strokeWidth={2.2} />
      </View>
    </Pressy>
  );

  const mediaTabsRow = (
    <View style={styles.mediaTabsRow}>
      <Pressy
        onPress={() => setMediaTab('photos')}
        style={[styles.mediaTab, mediaTab === 'photos' && styles.mediaTabActive]}
      >
        <Icon name="image" size={14} color={mediaTab === 'photos' ? colors.white : colors.inkSoft} />
        <Text style={[styles.mediaTabText, mediaTab === 'photos' && styles.mediaTabTextActive]} numberOfLines={1}>
          {t('listingDetail.photosTab')}
        </Text>
        <Text style={[styles.mediaTabCount, mediaTab === 'photos' && styles.mediaTabTextActive]}>
          {listing.photos.length}
        </Text>
      </Pressy>
      <Pressy
        onPress={() => setMediaTab('spin')}
        style={[styles.mediaTab, mediaTab === 'spin' && styles.mediaTabActive]}
      >
        <Icon name="rotate" size={14} color={mediaTab === 'spin' ? colors.white : colors.inkSoft} />
        <Text style={[styles.mediaTabText, mediaTab === 'spin' && styles.mediaTabTextActive]} numberOfLines={1}>
          {t('listingDetail.spinViewTab')}
        </Text>
        <Text style={[styles.mediaTabCount, mediaTab === 'spin' && styles.mediaTabTextActive]}>
          {spinSets.length}
        </Text>
      </Pressy>
      <Pressy
        onPress={() => setMediaTab('video')}
        style={[styles.mediaTab, mediaTab === 'video' && styles.mediaTabActive]}
      >
        <Icon name="camera" size={14} color={mediaTab === 'video' ? colors.white : colors.inkSoft} />
        <Text style={[styles.mediaTabText, mediaTab === 'video' && styles.mediaTabTextActive]} numberOfLines={1}>
          {t('listingDetail.videosTab')}
        </Text>
        <Text style={[styles.mediaTabCount, mediaTab === 'video' && styles.mediaTabTextActive]}>
          {playableVideo ? 1 : 0}
        </Text>
      </Pressy>
    </View>
  );

  // An empty state for the spin/video tabs, styled to sit inside the same
  // box as a real photo or spin would -- so switching to a tab that
  // happens to have nothing in it doesn't collapse the layout, just swaps
  // what's inside it.
  const mediaEmptyState = (iconName: 'rotate' | 'camera', label: string) => (
    <View style={styles.mediaEmptyState}>
      <View style={styles.mediaEmptyIconCircle}>
        <Icon name={iconName} size={22} color={colors.inkSoft} />
      </View>
      <Text style={styles.mediaEmptyText}>{label}</Text>
    </View>
  );

  // Arrows wrap the box from OUTSIDE, so they sit in the page beside the
  // frame rather than on top of the photograph/spin. Wrapped
  // unconditionally regardless of tab or item count -- CarouselArrows is a
  // no-op on mobile/touch anyway (see its own Platform.OS check), and on
  // desktop it reserves the same 34px gutter on each side whether or not a
  // button actually shows in it. That's what keeps the header and tab
  // strip above it from shifting width as you switch between a tab with
  // arrows and one without (e.g. 3 photos vs. Videos, which never has
  // any) -- every tab renders the same overall box width, canScrollBack/
  // canScrollForward just decide whether either arrow button is visible.
  const mediaBox = (extraStyle: any) => {
    if (mediaTab === 'video') {
      // Wrapped in CarouselArrows with both arrows off for the same reason
      // the empty states are: every tab has to render the same overall box
      // width, or the header and tab strip above it visibly jump as you
      // switch tabs.
      return (
        <CarouselArrows onScrollBy={() => {}} step={1} canScrollBack={false} canScrollForward={false}>
          <View style={extraStyle}>
            {playableVideo ? (
              <VideoPlayer guid={playableVideo.guid} resolutions={playableVideo.resolutions} />
            ) : video && video.status === 'failed' ? (
              mediaEmptyState('camera', t('listingDetail.videoFailed'))
            ) : video ? (
              mediaEmptyState('camera', t('listingDetail.videoProcessing'))
            ) : (
              mediaEmptyState('camera', t('listingDetail.noVideos'))
            )}
          </View>
        </CarouselArrows>
      );
    }
    if (mediaTab === 'spin') {
      if (!hasSpin) {
        return (
          <CarouselArrows onScrollBy={() => {}} step={1} canScrollBack={false} canScrollForward={false}>
            <View style={extraStyle}>{mediaEmptyState('rotate', t('listingDetail.noSpin'))}</View>
          </CarouselArrows>
        );
      }
      const activeSet = spinSets[spinIndex] ?? spinSets[0];
      return (
        <CarouselArrows
          onScrollBy={(d) => setSpinIndex((i) => Math.min(Math.max(i + d, 0), spinSets.length - 1))}
          step={1}
          canScrollBack={spinIndex > 0}
          canScrollForward={spinIndex < spinSets.length - 1}
        >
          <View style={extraStyle}>
            <SpinViewer frames={activeSet.frames} />
          </View>
        </CarouselArrows>
      );
    }
    return (
      <CarouselArrows
        onScrollBy={(d) => galleryRef.current?.page(d)}
        step={1}
        canScrollBack={photoIndex > 0}
        canScrollForward={photoIndex < listing.photos.length - 1}
      >
        <View style={extraStyle}>
          <PhotoGallery
            ref={galleryRef}
            photos={listing.photos}
            fallbackIconName={(cat?.icon as any) || 'bag'}
            onIndexChange={setPhotoIndex}
          />
        </View>
      </CarouselArrows>
    );
  };

  // Which named spin set is active, shown as tappable chips above the box
  // -- only when there's more than one to tell apart (e.g. "Exterior" vs.
  // "Interior"); with just one, the 360° View tab itself already says all
  // there is to say. Chips rather than plain text because they're also
  // the ONLY way to switch spin sets on mobile/touch: the arrows in
  // mediaBox come from CarouselArrows, which is a deliberate no-op off
  // desktop web (a spin set isn't swipeable the way a photo gallery page
  // is -- see PhotoGallery -- so without this a multi-spin listing would
  // have no way to reach its second spin set on a phone at all). Desktop
  // gets both: the arrows for a mouse, these chips as a direct jump.
  const mediaSpinChips = mediaTab === 'spin' && hasSpin && spinSets.length > 1 && (
    <View style={styles.spinChipsRow}>
      {spinSets.map((set, i) => (
        <Pressy
          key={set.id}
          onPress={() => setSpinIndex(i)}
          style={[styles.spinChip, i === spinIndex && styles.spinChipActive]}
        >
          <Text style={[styles.spinChipText, i === spinIndex && styles.spinChipTextActive]} numberOfLines={1}>
            {set.label || t('listingDetail.spinTabDefaultName', { n: i + 1 })}
          </Text>
        </Pressy>
      ))}
    </View>
  );

  // boxStyle: the fixed-size frame (styles.photo on mobile, styles.desktopPhoto
  // on desktop). chromeStyle: extra spacing for the header/tabs only, since
  // unlike the box (which carries its own marginHorizontal on mobile) they
  // have no width of their own to inherit it from -- see styles.photo's
  // comment for why mobile needs it and desktop doesn't.
  const mediaSection = (boxStyle: any, chromeStyle?: any) => (
    <View>
      <View style={chromeStyle}>{mediaHeader}</View>
      {mediaExpanded && (
        <>
          <View style={chromeStyle}>
            {mediaTabsRow}
            {mediaSpinChips}
          </View>
          {mediaBox(boxStyle)}
        </>
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
      <Pressy onPress={goBack} style={styles.iconBtn}>
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
      <Screen maxWidth={1040}>
        {topBar}
        <ScrollView contentContainerStyle={styles.desktopScroll}>
          <View style={styles.desktopRow}>
            <View style={styles.desktopMediaCol}>
              {mediaSection(styles.desktopPhoto)}
            </View>
            <View style={styles.desktopInfo}>
              {details}
              {ctaSection({ marginTop: 26 })}
              {relatedSection}
            </View>
          </View>
        </ScrollView>
        {confirmDialog}
        {reportModal}
      </Screen>
    );
  }

  return (
    <Screen>
      {topBar}

      <ScrollView contentContainerStyle={styles.scroll}>
        {mediaSection(styles.photo, styles.mediaChromeMobile)}
        <View style={styles.card}>
          {details}
          {relatedSection}
        </View>
      </ScrollView>

      <View style={styles.footer}>
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

  // ---- Media accordion (header + Photos/360° View/Videos tabs) ----
  // A deliberately heavy header -- large, bold, uppercase, sitting on a
  // 3px rule -- unlike every other section label in this file
  // (styles.sectionLabel: tiny, thin, easy to skim past). That contrast is
  // the actual fix for the complaint that started this: a spin buyers
  // could miss entirely under the old thin Photos/360° toggle. Tapping it
  // collapses the whole panel (tabs + box) -- useful once a listing has
  // enough media that a buyer who only wants the price/description would
  // rather scroll past it collapsed.
  mediaHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: 12, marginBottom: 14,
    borderBottomWidth: 3, borderBottomColor: colors.ink,
  },
  mediaHeaderText: { fontSize: 20, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  mediaChevron: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
    transform: [{ rotate: '0deg' }],
  },
  // Points down while expanded (content visible below); its unrotated
  // resting state already points the collapsed direction, so only the
  // expanded case needs an explicit transform.
  mediaChevronExpanded: { transform: [{ rotate: '90deg' }] },
  // Mobile only -- the header/tabs have no width of their own to inherit
  // page-edge spacing from the way the box below them does (styles.photo
  // carries its own marginHorizontal since it sits directly in the
  // unpadded scroll view). Desktop needs no equivalent: its box is
  // CarouselArrows-wrapped and stretch-sized, so the header/tabs -- with
  // no margin of their own -- naturally line up with it already.
  mediaChromeMobile: { marginHorizontal: 18 },
  mediaTabsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  mediaTab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 42, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line,
  },
  mediaTabActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  mediaTabText: { fontSize: 13, fontWeight: '700', color: colors.inkSoft },
  mediaTabCount: { fontSize: 12, fontWeight: '600', color: colors.inkSoft, opacity: 0.8 },
  mediaTabTextActive: { color: colors.white },
  mediaEmptyState: { alignItems: 'center', gap: 10 },
  mediaEmptyIconCircle: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(20,20,22,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  mediaEmptyText: { ...type.soft, fontWeight: '600', color: colors.inkSoft },
  // Tappable spin-set chips (only shown with more than one) -- see
  // mediaSpinChips' comment for why these exist beyond just labeling.
  spinChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  spinChip: {
    paddingHorizontal: 12, height: 30, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  spinChipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  spinChipText: { ...type.tiny, fontWeight: '600', color: colors.inkSoft },
  spinChipTextActive: { color: colors.white },

  card: { padding: 18 },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  // With a single child (the price, whenever this isn't the owner's own
  // listing and editButton is null) justify-content: space-between still
  // resolves to flex-start of the row -- i.e. the LEFT edge, even in
  // Arabic. row-reverse flips which edge "flex-start" actually is, so the
  // price (and, for the owner, the edit actions alongside it) anchors to
  // the right instead.
  priceRowRTL: { flexDirection: 'row-reverse' },
  ownerModerationNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
    padding: 10, borderRadius: radius.sm, backgroundColor: colors.warnBg,
  },
  ownerRejectedNotice: { backgroundColor: '#f5e4e2' },
  ownerModerationNoticeText: { ...type.soft, flex: 1, fontSize: 12.5 },
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
  metaBlock: { gap: 5, marginTop: 2 },
  categoryLink: { textDecorationLine: 'underline' },
  title: { ...type.h2, marginTop: 4, marginBottom: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  // This app doesn't do a global RTL flip (see LanguageContext's
  // applyDocumentDirection, which is a web-only no-op on native) --
  // instead, each row-based layout mirrors itself explicitly via isRTL,
  // same pattern TabBar.tsx/Screen.tsx already use. Icon-then-text reads
  // backwards in Arabic; row-reverse puts the text first, icon trailing.
  metaRowRTL: { flexDirection: 'row-reverse' },
  // Correction to the theme.ts `textAlign: 'auto'` fix: 'auto' turns out
  // to resolve via I18nManager.isRTL on real native Android/iOS, NOT by
  // inspecting the string's own Unicode script the way a browser's CSS
  // engine does (that per-content detection only actually verified on
  // the web build, via Playwright, since I18nManager.isRTL is never
  // flipped in this app -- see LanguageContext's applyDocumentDirection,
  // which is web-only). So 'auto' silently stayed 'left' on device
  // regardless of Arabic content, which is exactly the "still LTR" bug
  // reported after installing that fix. This explicit isRTL-driven
  // override is what actually works on native.
  rtlText: { textAlign: 'right', writingDirection: 'rtl' },
  aiTag: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: colors.warnBg, borderRadius: radius.pill, paddingHorizontal: 10, height: 28, marginTop: 12,
  },
  // row-reverse alone would still leave the pill itself hugging the LEFT
  // edge of the screen (alignSelf: 'flex-start' from aiTag above) -- flip
  // that too, or the badge ends up mirrored internally but stranded on
  // the wrong side entirely.
  aiTagRTL: { flexDirection: 'row-reverse', alignSelf: 'flex-end' },
  aiTagText: { fontSize: 11.5, fontWeight: '600', color: colors.ink },
  // Plain left-aligned uppercase labels ("Description", "Details &
  // Specs", "Seller", "Similar listings") -- like every other bare Text
  // in this file, these need the same explicit isRTL override as
  // `rtlText` above; type.tiny's theme-level `textAlign: 'auto'` doesn't
  // actually flip on native (see the rtlText comment).
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
  sellerRowRTL: { flexDirection: 'row-reverse' },
  sellerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  sellerNameRowRTL: { flexDirection: 'row-reverse' },
  // Mirrors chevronRight (there's no separate chevronLeft glyph in the
  // icon set) so it still reads as "this row navigates further" pointing
  // toward the row's own leading edge once sellerRowRTL has flipped which
  // side that is.
  chevronRTL: { transform: [{ scaleX: -1 }] },
  sellerAvatar: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#e3efe8', borderRadius: radius.pill, paddingHorizontal: 8, height: 20,
  },
  verifiedBadgeText: { fontSize: 10.5, fontWeight: '700', color: colors.success },
  memberSince: { ...type.tiny, marginTop: 3 },
  // flexGrow:0 on the ScrollView itself, same as home's catRowDesktopScroll
  // -- see the render-side comment where this style is used.
  relatedScroll: { flexGrow: 0 },
  // alignItems:'flex-start' opts the row out of RN's default row-children
  // stretch -- without it, every ListingCard in the row got stretched to
  // match whatever height the ScrollView ended up with, warping each
  // thumbnail from its normal 3:4 shape into a tall sliver.
  relatedRow: { gap: 12, paddingTop: 2, paddingBottom: 4, alignItems: 'flex-start' },
  // Plain paddingBottom now -- the Android nav-bar inset is reserved once,
  // globally, by Screen's 'bottom' edge, so adding insets.bottom here too
  // would double-pad.
  footer: {
    paddingHorizontal: 18, paddingTop: 12, paddingBottom: 18,
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
