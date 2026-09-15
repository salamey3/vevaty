import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Image, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import ConfirmDialog from '../components/ConfirmDialog';
import BuildStamp from '../components/BuildStamp';
import { colors, type, radius } from '../theme/theme';
import { mirrorRow } from '../lib/mirrorRow';
import { leaveShop, shopName, staffErrorKey } from '../lib/shopStaff';
import { useAppStore } from '../store/AppStore';
import { useSettings } from '../store/SettingsStore';
import { TIER_THRESHOLDS } from '../data/points';
import { RootStackParamList } from '../navigation/types';
import { useLanguage } from '../i18n/LanguageContext';
import { TIER_LABELS } from '../i18n/translations';
import { supabase } from '../lib/supabase';
import { uploadPhoto } from '../lib/photoUpload';
import { Alert } from '../lib/alertShim';
import { openLegalPage } from '../lib/legalLinks';
import { shareLink } from '../lib/share';
import ImageCropModal from '../components/ImageCropModal';
import ActionSheet from '../components/ActionSheet';
import { DESKTOP_CONTENT_MAX_WIDTH } from '../hooks/useResponsive';

export default function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { profile, listings, pointsHistory, fetchPointsHistory, signOut, deleteAccount, isVerified, myShop, workShop, refreshWork, updateAvatar, testerStatus } = useAppStore();
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  // The picked-but-not-yet-cropped avatar, queued for ImageCropModal -- see
  // confirmAvatarCrop below (shared component with MyStorefrontScreen's
  // logo picker).
  const [avatarCropUri, setAvatarCropUri] = useState<string | null>(null);
  // Tapping an EXISTING avatar opens this (Delete photo / Upload a new
  // photo) instead of jumping straight to the picker -- there was
  // previously no way to remove a photo once set, only replace it. A
  // fresh/no-photo avatar has nothing to delete, so it skips the menu
  // entirely and behaves as it always did (see the Pressy below).
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  // Shut on arrival. The point of the fold is that Profile reads as a short
  // list again, and the one thing a shop opens daily -- its morning -- is
  // already reachable from the card on Home whenever something is waiting.
  const [businessOpen, setBusinessOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    // No allowsEditing/aspect here -- ImageCropModal is the crop step now
    // (it also covers web, where expo-image-picker has no editing UI at
    // all; see ImageCropModal's own comment).
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    setAvatarCropUri(result.assets[0].uri);
  };

  const confirmAvatarCrop = async (croppedUri: string) => {
    setAvatarCropUri(null);
    setUploadingAvatar(true);
    try {
      const hosted = await uploadPhoto(croppedUri);
      await updateAvatar(hosted);
    } catch {
      Alert.alert(t('profile.avatarUploadFailedTitle'), t('profile.avatarUploadFailedMessage'));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const deleteAvatar = async () => {
    setUploadingAvatar(true);
    try {
      await updateAvatar(null);
    } catch {
      Alert.alert(t('profile.avatarDeleteFailedTitle'), t('profile.avatarDeleteFailedMessage'));
    } finally {
      setUploadingAvatar(false);
    }
  };
  // The Admin row is the only way to the admin panel from inside the app, and
  // it shows for an account that IS an admin -- isAdmin once signed in to the
  // panel, testerStatus.isAdmin (my_tester_status) before that, so the admin
  // can find the sign-in without a browser. It opens the same email,
  // password and authenticator-code sign-in as vevaty.com/control-room (or the
  // panel itself on a device already signed in to it); being signed in with
  // the phone does not shorten it (see AdminGateScreen). Every other account
  // sees nothing: no admin sign-in anywhere a member can see.
  const { isAdmin } = useSettings();
  const showAdminEntry = isAdmin || (isVerified && testerStatus.isAdmin);
  // Testers Reports, for the same accounts the Report a problem tab shows
  // to (TESTERS.md). The form itself takes any member who has the link.
  const showTesterReport = isVerified && (testerStatus.roles.length > 0 || testerStatus.isAdmin || isAdmin);
  const { t, language, isRTL, setLanguage } = useLanguage();
  // Icon swaps to a checkmark briefly after a successful clipboard copy
  // (web desktop, where there's no native share sheet to give its own
  // feedback) -- see handleShare. Native's Share.share and web's
  // navigator.share both present their own UI, so 'shared'/'dismissed'
  // outcomes never touch this at all.
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle');
  const handleShareProfile = async () => {
    const outcome = await shareLink({
      path: `/seller/${profile.id}`,
      title: profile.name && profile.name !== 'You' ? profile.name : t('profile.yourProfile'),
      text: t('sellerProfile.shareText', { name: profile.name && profile.name !== 'You' ? profile.name : t('profile.yourProfile') }),
    });
    if (outcome === 'copied') {
      setShareState('copied');
      setTimeout(() => setShareState('idle'), 2000);
    } else if (outcome === 'error') {
      Alert.alert(t('sellerProfile.shareFailed'));
    }
  };
  // Only the count is still needed here -- the listings themselves moved
  // to MyListingsScreen (see the "My Listings" nav row below).
  const myListings = useMemo(() => listings.filter((l) => l.sellerId === profile.id), [listings, profile.id]);
  // A storefront submitted and not yet reviewed. The only thing inside the
  // business group urgent enough to show on the shut row.
  const shopPending = !!myShop && !myShop.verifiedAt;
  // Owning the place and working in it are the same drawer with different
  // rows in it. workShop answers "is there a counter I stand at", myShop
  // answers "is it mine" -- and only the second one opens the storefront.
  const runsTheShop = !!workShop?.isOwner;
  const tradingShop = !!workShop?.verifiedAt;
  // The phone column has SELECT revoked on myazar.profiles -- get_my_phone
  // (SECURITY DEFINER) is the only sanctioned way to read it back, and
  // only makes sense to call once there's a real verified session.
  const [myPhone, setMyPhone] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  // "Edit your profile" reveals the three things a verified user can
  // change about themselves -- name and location update in place here,
  // phone number still goes through ChangePhoneScreen's own OTP flow
  // (kept as its own screen rather than folded in here, since it needs a
  // send-code/verify step this menu has no room for).
  const [editMenuOpen, setEditMenuOpen] = useState(false);

  // useFocusEffect rather than a plain mount-only effect: this screen stays
  // mounted underneath ChangePhoneScreen (a stack push, not a replace), so
  // coming back from a successful number change needs a real re-fetch --
  // isVerified itself doesn't change, so an effect keyed only on it would
  // never re-run and the old number would keep showing.
  useFocusEffect(
    useCallback(() => {
      if (!isVerified) { setMyPhone(null); return; }
      supabase.rpc('get_my_phone').then(({ data }) => setMyPhone(data || null));
    }, [isVerified])
  );

  // Same reasoning as the phone refetch above: this screen stays mounted
  // underneath PointsActivityScreen, so a boost redeemed there (or a
  // listing sold/posted from a screen reached some other way) should show
  // up in this section's last-few preview the moment the seller comes
  // back, not only after the next app launch.
  useFocusEffect(
    useCallback(() => {
      if (isVerified) fetchPointsHistory();
    }, [isVerified, fetchPointsHistory])
  );

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

  return (
    <Screen reserveSidebar maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <LinearGradient colors={[colors.heroA, colors.heroB]} style={styles.hero}>
          {/* Corner button rather than a labeled pill (compare
              SellerProfileScreen's shareBtn) -- this hero is a centered
              vertical stack with no header row to put a pill in, and the
              request was specifically for an icon. Absolute + isRTL-
              swapped side so it sits in the same reading-direction-
              appropriate corner as icon buttons elsewhere (e.g.
              ListingDetailScreen's topBar). */}
          <Pressy
            onPress={handleShareProfile}
            style={[styles.shareProfileBtn, isRTL ? { left: 14 } : { right: 14 }]}
            accessibilityLabel={t('sellerProfile.shareProfile')}
          >
            <Icon name={shareState === 'copied' ? 'checkCircle' : 'share'} size={16} color={colors.white} />
          </Pressy>
          {isVerified ? (
            <Pressy
              onPress={profile.avatarUrl ? () => setAvatarMenuOpen(true) : pickAvatar}
              disabled={uploadingAvatar}
              style={styles.avatar}
              accessibilityLabel={t('profile.changePhoto')}
            >
              {uploadingAvatar ? (
                <ActivityIndicator color={colors.white} />
              ) : profile.avatarUrl ? (
                <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImg} />
              ) : (
                <Icon name="user" size={24} color={colors.white} />
              )}
              <View style={styles.avatarEditBadge}>
                <Icon name="camera" size={11} color={colors.white} />
              </View>
            </Pressy>
          ) : (
            <View style={styles.avatar}>
              {profile.avatarUrl ? (
                <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImg} />
              ) : (
                <Icon name="user" size={24} color={colors.white} />
              )}
            </View>
          )}
          <Text style={styles.name}>{profile.name && profile.name !== 'You' ? profile.name : t('profile.yourProfile')}</Text>
          {isVerified && <Text style={styles.profileHint}>{t('profile.yourProfileHint')}</Text>}
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
          <View style={[styles.section, { marginTop: 14 }]}>
            <Pressy onPress={() => setEditMenuOpen(true)} style={styles.adminBtn}>
              <Icon name="edit" size={15} color={colors.inkSoft} />
              <Text style={styles.adminBtnText}>{t('profile.editProfile')}</Text>
            </Pressy>
          </View>
        )}

        <View style={[styles.section, { marginTop: 18 }]}>
          <Pressy onPress={() => navigation.navigate('Shops')} style={styles.adminBtn}>
            <Icon name="building" size={15} color={colors.inkSoft} />
            <Text style={styles.adminBtnText}>{t('profile.browseStorefronts')}</Text>
          </Pressy>
        </View>

        {/* Your listings, your morning and your storefront were three
            sibling rows here, and they are one thing: everything on this
            screen to do with selling. Three rows that belong together read
            as three unrelated destinations, so they fold into one that
            opens.

            Only once there IS a business. A member who has never sold
            anything would otherwise find "Create a storefront" -- the one
            row on this screen whose job is to turn them into a seller --
            behind a row labelled "My business", which presupposes the very
            thing it is offering to set up. They keep the two flat rows they
            had.

            With a storefront the group always holds two rows or three
            (Listings Manager and the storefront row are both unconditional
            here), so it never folds a lone row away behind a tap. Anything
            added here that can be absent on its own should keep that
            true. */}
        {isVerified && !!workShop && (
          <View style={styles.section}>
            <View style={businessOpen ? styles.group : null}>
              <Pressy
                onPress={() => setBusinessOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: businessOpen }}
                accessibilityLabel={t('profile.myBusiness')}
                style={[businessOpen ? [styles.groupHead, styles.groupHeadOpen] : styles.adminBtn, mirrorRow(isRTL)]}
              >
                <Icon name="briefcase" size={15} color={colors.inkSoft} />
                <Text style={styles.adminBtnText}>{t('profile.myBusiness')}</Text>
                {/* A storefront still waiting on review is the one signal
                    in here that cannot wait to be tapped open for. Shown
                    only while shut, because the row itself carries it once
                    you can see the row. */}
                {!businessOpen && shopPending && <View style={styles.pendingDot} />}
                <View style={[styles.groupChevron, businessOpen && styles.groupChevronOpen]}>
                  <Icon name="chevronRight" size={14} color={colors.inkSoft} />
                </View>
              </Pressy>

              {businessOpen && (
                <>
                  {/* Was its own section further down the screen, mixed in
                      among Language/About/Points activity. The listings
                      themselves -- and the Delete/Item Sold/Hide actions --
                      live on their own screen. See MyListingsScreen. */}
                  <Pressy onPress={() => navigation.navigate('MyListings')} style={[styles.groupRow, mirrorRow(isRTL)]}>
                    <Icon name="bag" size={15} color={colors.inkSoft} />
                    <Text style={styles.adminBtnText}>{t('profile.myListings', { count: myListings.length })}</Text>
                  </Pressy>

                  {/* Only for a shop that is actually trading. A storefront
                      still waiting on verification has no listings in it
                      yet, so its morning is always empty and the row is
                      only a dead end. */}
                  {tradingShop && (
                    <Pressy onPress={() => navigation.navigate('ShopDay')} style={[styles.groupRow, mirrorRow(isRTL)]}>
                      <Icon name="checkCircle" size={15} color={colors.inkSoft} />
                      <Text style={styles.adminBtnText}>{t('profile.shopDay')}</Text>
                    </Pressy>
                  )}

                  {/* Taking somebody on, and the storefront itself, belong
                      to whoever owns the place. The database refuses them
                      to anybody else; these are just not offered. */}
                  {runsTheShop && tradingShop && (
                    <Pressy onPress={() => navigation.navigate('Staff')} style={[styles.groupRow, mirrorRow(isRTL)]}>
                      <Icon name="user" size={15} color={colors.inkSoft} />
                      <Text style={styles.adminBtnText}>{t('profile.staff')}</Text>
                    </Pressy>
                  )}

                  {runsTheShop && (
                    <Pressy onPress={() => navigation.navigate('MyStorefront')} style={[styles.groupRow, mirrorRow(isRTL)]}>
                      <Icon name="building" size={15} color={colors.inkSoft} />
                      <Text style={styles.adminBtnText}>{t('profile.myStorefront')}</Text>
                      {shopPending && <View style={styles.pendingDot} />}
                    </Pressy>
                  )}

                  {/* The way out, for somebody who works here rather than
                      owning it. Deliberately inside the drawer and not a
                      red button on the front of the screen. */}
                  {!runsTheShop && (
                    <Pressy onPress={() => setLeaving(true)} style={[styles.groupRow, mirrorRow(isRTL)]}>
                      <Icon name="back" size={15} color={colors.inkSoft} />
                      <Text style={styles.adminBtnText}>
                        {t('profile.leaveShop', { shop: shopName(workShop!, language) })}
                      </Text>
                    </Pressy>
                  )}
                </>
              )}
            </View>
          </View>
        )}

        {isVerified && !workShop && (
          <View style={styles.section}>
            <Pressy onPress={() => navigation.navigate('MyListings')} style={[styles.adminBtn, mirrorRow(isRTL)]}>
              <Icon name="bag" size={15} color={colors.inkSoft} />
              <Text style={styles.adminBtnText}>{t('profile.myListings', { count: myListings.length })}</Text>
            </Pressy>
          </View>
        )}

        {isVerified && !workShop && (
          <View style={styles.section}>
            <Pressy onPress={() => navigation.navigate('MyStorefront')} style={[styles.adminBtn, mirrorRow(isRTL)]}>
              <Icon name="building" size={15} color={colors.inkSoft} />
              <Text style={styles.adminBtnText}>{t('profile.createStorefront')}</Text>
            </Pressy>
          </View>
        )}

        {/* Stays outside the fold: what you saved is a buyer's shelf, not
            part of the business. */}
        {isVerified && (
          <View style={styles.section}>
            <Pressy onPress={() => navigation.navigate('Favorites')} style={styles.adminBtn}>
              <Icon name="heart" size={15} color={colors.inkSoft} />
              <Text style={styles.adminBtnText}>{t('profile.savedListings')}</Text>
            </Pressy>
          </View>
        )}

        {showTesterReport && (
          <View style={styles.section}>
            <Pressy onPress={() => navigation.navigate('TesterReport')} style={styles.adminBtn}>
              <Icon name="flag" size={15} color={colors.inkSoft} />
              <Text style={styles.adminBtnText}>{t('profile.testerReport')}</Text>
            </Pressy>
          </View>
        )}

        {showAdminEntry && (
          <View style={[styles.section, { marginTop: isVerified ? 10 : 26 }]}>
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

        {/* About Us / Privacy Policy / Terms & Conditions are static HTML
            pages, not app screens (see legalLinks.ts) -- this is the one
            place they're reachable from the mobile and native UI, since the
            equivalent site-wide footer (TabBar.tsx) is desktop-web only. */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('profile.aboutSection')}</Text>
          <View style={styles.aboutList}>
            <Pressy onPress={() => openLegalPage('about', language)} style={styles.adminBtn}>
              <Icon name="globe" size={15} color={colors.inkSoft} />
              <Text style={styles.adminBtnText}>{t('nav.aboutUs')}</Text>
            </Pressy>
            <Pressy onPress={() => openLegalPage('privacy', language)} style={styles.adminBtn}>
              <Icon name="lock" size={15} color={colors.inkSoft} />
              <Text style={styles.adminBtnText}>{t('nav.privacyPolicy')}</Text>
            </Pressy>
            <Pressy onPress={() => openLegalPage('terms', language)} style={styles.adminBtn}>
              <Icon name="checkCircle" size={15} color={colors.inkSoft} />
              <Text style={styles.adminBtnText}>{t('nav.termsOfUse')}</Text>
            </Pressy>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>{t('profile.pointsActivity')}</Text>
            {pointsHistory.length > 0 && (
              <Pressy onPress={() => navigation.navigate('PointsActivity')}>
                <Text style={styles.seeAll}>{t('profile.pointsSeeAll')}</Text>
              </Pressy>
            )}
          </View>
          {pointsHistory.length === 0 ? (
            <Text style={type.soft}>{t('profile.noPointsActivity')}</Text>
          ) : (
            pointsHistory.slice(0, 8).map((e) => {
              // A boost redemption is the one negative amount in this
              // list -- everything else (posting/selling awards) is
              // always positive. Its own `-` prints itself; a positive
              // amount needs the `+` added, same rendering rule as
              // PointsActivityScreen's full list.
              const spent = e.amount < 0;
              return (
                <View key={e.id} style={styles.historyRow}>
                  <Text style={type.body} numberOfLines={1}>{e.label}</Text>
                  <Text style={[styles.historyAmount, { color: spent ? colors.accentDeep : colors.success }]}>
                    {spent ? '' : '+'}{e.amount}
                  </Text>
                </View>
              );
            })
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

        {/* Which bundle this phone is actually running -- see BuildStamp. */}
        <BuildStamp />
      </ScrollView>

      {/* Leaving is instant on the server, so the only thing standing
          between a mis-tap and losing the counter is this. */}
      <ConfirmDialog
        visible={leaving}
        title={t('profile.leaveShopTitle')}
        message={t('profile.leaveShopBody', { shop: workShop ? shopName(workShop, language) : '' })}
        confirmLabel={t('profile.leaveShopConfirm')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={async () => {
          setLeaving(false);
          try {
            await leaveShop();
          } catch (e: any) {
            Alert.alert(t('staff.failedTitle'), t(staffErrorKey(e)));
          }
          // Either way: the server is the only thing that knows where this
          // person works now, and a stale drawer offering a counter they
          // have left is worse than a spinner.
          await refreshWork();
        }}
        onCancel={() => setLeaving(false)}
      />

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

      <ImageCropModal
        visible={!!avatarCropUri}
        uri={avatarCropUri}
        shape="circle"
        title={t('profile.changePhoto')}
        onCancel={() => setAvatarCropUri(null)}
        onConfirm={confirmAvatarCrop}
      />

      <ActionSheet
        visible={editMenuOpen}
        options={[
          {
            label: t('profile.editProfileChangeName'),
            icon: 'user',
            onPress: () => {
              setEditMenuOpen(false);
              navigation.navigate('EditName');
            },
          },
          {
            label: t('profile.editProfileChangePhone'),
            icon: 'phone',
            onPress: () => {
              setEditMenuOpen(false);
              navigation.navigate('ChangePhone');
            },
          },
          {
            label: t('profile.editProfileChangeLocation'),
            icon: 'location',
            onPress: () => {
              setEditMenuOpen(false);
              navigation.navigate('EditLocation');
            },
          },
          {
            label: t('profile.editProfileContactDetails'),
            icon: 'mail',
            onPress: () => {
              setEditMenuOpen(false);
              navigation.navigate('EditContact');
            },
          },
        ]}
        cancelLabel={t('common.cancel')}
        onCancel={() => setEditMenuOpen(false)}
      />

      <ActionSheet
        visible={avatarMenuOpen}
        options={[
          {
            label: t('profile.uploadNewPhoto'),
            icon: 'camera',
            onPress: () => {
              setAvatarMenuOpen(false);
              pickAvatar();
            },
          },
          {
            label: t('profile.deletePhoto'),
            icon: 'trash',
            destructive: true,
            onPress: () => {
              setAvatarMenuOpen(false);
              deleteAvatar();
            },
          },
        ]}
        cancelLabel={t('common.cancel')}
        onCancel={() => setAvatarMenuOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 110 },
  hero: { marginHorizontal: 18, borderRadius: radius.xl, padding: 22, alignItems: 'center', marginTop: 8 },
  // top/right(or left) rather than a flex row -- every View is an implicit
  // positioning context in RN (unlike web, no position:'relative' needed
  // on `hero` itself), and this needs to sit in the hero's corner without
  // disturbing the centered avatar/name/points stack below it.
  shareProfileBtn: {
    position: 'absolute',
    top: 14,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  avatar: {
    width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  avatarImg: { width: 54, height: 54, borderRadius: 27 },
  avatarEditBadge: {
    position: 'absolute', bottom: 6, right: -2, width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.heroA,
  },
  name: { fontSize: 19, fontWeight: '700', color: colors.white },
  profileHint: { fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  district: { fontSize: 12.5, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  pointsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  pointsBig: { fontSize: 16, fontWeight: '700', color: colors.white },
  tierPill: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: radius.pill, paddingHorizontal: 10, height: 22, justifyContent: 'center' },
  tierPillText: { fontSize: 11, fontWeight: '700', color: colors.white },
  nextTier: { fontSize: 11.5, color: 'rgba(255,255,255,0.55)', marginTop: 8 },
  section: { paddingHorizontal: 18, marginTop: 26 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  seeAll: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft },
  rowError: { fontSize: 12, color: colors.danger, marginTop: 6 },
  historyRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  historyAmount: { fontSize: 13.5, fontWeight: '700', color: colors.success },
  aboutList: { gap: 10 },
  langRow: { flexDirection: 'row', gap: 10 },
  langOption: {
    flex: 1, height: 44, borderRadius: radius.md, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center',
  },
  langOptionActive: { backgroundColor: colors.primary, borderColor: colors.ink },
  langLabel: { fontSize: 14, fontWeight: '600', color: colors.ink },
  langLabelActive: { color: colors.white },
  adminBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
  },
  // The business group. Shut, it IS an adminBtn and nothing else -- the
  // container adds nothing and the head wears the ordinary row's border, so
  // the press-scale takes the border down with it exactly like every
  // neighbouring row. A border sitting on the container instead would stay
  // put while its contents shrank, which is the one way this row could
  // announce that it is a different kind of thing. Open, the container
  // takes over the border and grows into a card.
  group: {
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    overflow: 'hidden',
  },
  // 47, not 48. A border sits INSIDE the box in React Native, so a shut
  // adminBtn is 48 with 47 of content; the open head has no border of its
  // own and sits under the group's, so 47 keeps the band the same height
  // through the tap instead of nudging everything below it down a pixel.
  groupHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 47,
  },
  // Tinted only once it is heading something.
  groupHeadOpen: { backgroundColor: colors.surface },
  groupRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, borderTopWidth: 1, borderTopColor: colors.line,
  },
  groupChevron: {
    width: 16, height: 16, alignItems: 'center', justifyContent: 'center',
    transform: [{ rotate: '0deg' }],
  },
  groupChevronOpen: { transform: [{ rotate: '90deg' }] },
  adminBtnText: { fontSize: 14.5, fontWeight: '600', color: colors.inkSoft },
  // Unobtrusive "still pending review" signal on the My Storefront row --
  // a small dot rather than a text badge, since the full status (pending
  // vs. declined-with-reason vs. live) is already spelled out on
  // MyStorefrontScreen itself once tapped.
  pendingDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.accentRing },
  logOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
  },
  logOutLabel: { fontSize: 14.5, fontWeight: '600', color: colors.danger },
  logInBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, borderRadius: radius.md, backgroundColor: colors.primary,
  },
  logInLabel: { fontSize: 14.5, fontWeight: '600', color: colors.white },
  deleteAccountRow: { height: 32, alignItems: 'center', justifyContent: 'center' },
  deleteAccountLabel: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, textDecorationLine: 'underline' },
});
