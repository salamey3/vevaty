import React from 'react';
import { ActivityIndicator, Image, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Pressy from './Pressy';
import Button from './Button';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';
import { useIsDesktop } from '../hooks/useResponsive';

// Photo collection for the Magic Listing path.
//
// Why a minimum of three: one photo identifies the shape of a thing, and
// that is where the AI's usefulness stops. What turns "a laptop" into "a
// 2021 MacBook Pro 14-inch" is a second angle and, above all, a shot of a
// label, badge, or model number. Three is the smallest number that
// reliably gets one of those in the set without turning the fast path into
// a chore -- which would defeat the point of a button whose whole promise
// is that it saves you work.
//
// The guidance below is deliberately about WHICH three rather than just
// how many, because a third photo of the same angle adds nothing.
export const MAGIC_MIN_PHOTOS = 3;
export const MAGIC_MAX_PHOTOS = 6;

export default function MagicListingModal({
  visible,
  photos,
  busy,
  error,
  onTakePhoto,
  onGuidedCapture,
  onPickPhotos,
  onRemovePhoto,
  onAnalyze,
  onClose,
}: {
  visible: boolean;
  photos: string[];
  busy: boolean;
  error: string | null;
  onTakePhoto: () => void;
  onGuidedCapture?: () => void;
  onPickPhotos: () => void;
  onRemovePhoto: (uri: string) => void;
  onAnalyze: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  // A Modal renders outside the screen's SafeAreaView, so it gets none of
  // its insets -- which is why the primary button sat underneath Android's
  // navigation bar. Reserve that strip here.
  const insets = useSafeAreaInsets();
  const isDesktop = useIsDesktop();
  const enough = photos.length >= MAGIC_MIN_PHOTOS;
  // Native always has a camera. On the web it depends on the device: a
  // phone browser has one and is exactly where someone would photograph
  // the thing they're selling, while a desktop browser's webcam points at
  // the person, not the item. So offer it on a small viewport and not on a
  // large one -- the camera itself works in both (expo-camera uses
  // getUserMedia on web), this is about whether it's any use.
  const canUseCamera = Platform.OS !== 'web' || !isDesktop;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(18, insets.bottom + 12) }]}>
          <View style={styles.headerRow}>
            <View style={styles.titleRow}>
              <Icon name="wand" size={18} color={colors.ink} />
              <Text style={type.h3}>{t('createListing.magicButton')}</Text>
            </View>
            <Pressy onPress={onClose} disabled={busy} style={styles.iconBtn}>
              <Icon name="close" size={18} />
            </Pressy>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={type.soft}>{t('createListing.magicIntro')}</Text>

            <View style={styles.shotList}>
              {[
                t('createListing.magicShotWhole'),
                t('createListing.magicShotLabel'),
                t('createListing.magicShotDetail'),
              ].map((s) => (
                <View key={s} style={styles.shotItem}>
                  <Icon name="check" size={13} color={colors.inkSoft} />
                  <Text style={type.soft}>{s}</Text>
                </View>
              ))}
            </View>

            <View style={styles.photoGrid}>
              {photos.map((uri) => (
                <View key={uri} style={styles.thumbWrap}>
                  <Image source={{ uri }} style={styles.thumb} />
                  {!busy && (
                    <Pressy onPress={() => onRemovePhoto(uri)} style={styles.removeBadge}>
                      <Icon name="close" size={12} color={colors.white} />
                    </Pressy>
                  )}
                </View>
              ))}
              {photos.length < MAGIC_MAX_PHOTOS && !busy && (
                <>
                  {canUseCamera && (
                    <Pressy onPress={onGuidedCapture || onTakePhoto} style={styles.addTile}>
                      <Icon name="camera" size={20} color={colors.inkSoft} />
                      <Text style={[type.tiny, styles.addLabel]}>{t('createListing.takePhoto')}</Text>
                    </Pressy>
                  )}
                  <Pressy onPress={onPickPhotos} style={styles.addTile}>
                    <Icon name="image" size={20} color={colors.inkSoft} />
                    <Text style={[type.tiny, styles.addLabel]}>{t('createListing.addFromGallery')}</Text>
                  </Pressy>
                </>
              )}
            </View>

            {/* Progress toward the minimum, stated as a count rather than a
                disabled button with no explanation -- the commonest reason
                a primary button does nothing is that nobody said why. */}
            <Text style={[type.tiny, styles.counter]}>
              {enough
                ? t('createListing.magicPhotosReady', { count: photos.length })
                : t('createListing.magicPhotosNeeded', { count: MAGIC_MIN_PHOTOS - photos.length })}
            </Text>

            {!!error && <Text style={styles.error}>{error}</Text>}

            {busy ? (
              <View style={styles.busyRow}>
                <ActivityIndicator color={colors.ink} />
                <Text style={type.soft}>{t('createListing.magicWorking')}</Text>
              </View>
            ) : (
              <Button
                label={t('createListing.magicAnalyze')}
                onPress={onAnalyze}
                disabled={!enough}
                style={styles.cta}
              />
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,20,22,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '90%',
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 16, paddingBottom: 8 },
  shotList: { marginTop: 12, gap: 6 },
  shotItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  thumbWrap: { width: 84, height: 112 },
  thumb: { width: 84, height: 112, borderRadius: radius.sm, backgroundColor: colors.surface },
  removeBadge: {
    position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(20,20,22,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  addTile: {
    width: 84, height: 112, borderRadius: radius.sm, borderWidth: 1, borderStyle: 'dashed',
    borderColor: colors.line, alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: colors.card,
  },
  addLabel: { color: colors.inkSoft, textAlign: 'center', paddingHorizontal: 4 },
  counter: { color: colors.inkSoft, marginTop: 12 },
  error: { ...type.soft, color: colors.danger, marginTop: 10 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  cta: { marginTop: 18 },
});
