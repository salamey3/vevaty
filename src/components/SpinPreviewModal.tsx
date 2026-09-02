import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import SpinViewer from './SpinViewer';
import SystemBottomStrip from './SystemBottomStrip';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';

type Props = {
  visible: boolean;
  frames: string[];
  // The name for this spin (e.g. "Exterior", "Kitchen") -- lifted up to
  // CreateListingScreen rather than kept as local state here, so Continue
  // can commit both the frames and whatever label the seller typed/picked
  // in one shot. Optional: a blank label just falls back to "Spin N" in
  // the spin-step list.
  label: string;
  onChangeLabel: (v: string) => void;
  // Quick-pick chips for the current category (e.g. "Exterior"/"Interior"
  // for a vehicle, "Living room"/"Kitchen"/... for a property) -- tapping
  // one fills the label field, same as typing it. Empty for categories
  // with no obvious preset labels; free typing always still works.
  labelSuggestions: string[];
  onRetake: () => void;
  onContinue: () => void;
  onClose: () => void;
};

// Shown immediately after CameraCapture finishes a 360° spin capture, and
// re-openable from the Spin step afterwards -- an instant, interactive
// preview of the assembled spin (drag to rotate, the same SpinViewer used
// on the live listing detail page) so the seller can judge the actual
// result -- lighting, framing, a frame that's out of order or blurry --
// before moving on, instead of only seeing a flat grid of thumbnails.
//
// A listing can have more than one spin (see SpinSet in types/index.ts --
// e.g. "Exterior"/"Interior" for a car, one per room for a property), so
// this also carries a name field for the spin being previewed. "Retake"
// hands back to the CALLER and does not itself decide what happens, so the
// two callers differ: the seller's Spin step always discards the frames
// and reopens the guided camera, while the admin auction screen returns to
// whichever surface the frames came from -- the camera for a captured set,
// the library for a picked one, keeping those frames until a replacement
// actually arrives so a cancelled picker does not cost a selection. Both
// keep whatever label is currently typed. "Continue" commits this set (frames + label)
// into the seller's list of spins on the Spin step -- it does NOT by
// itself advance the wizard to the next step anymore now that there can be
// more than one spin to add; the seller uses the step's own Continue
// button down in the footer once they're done adding spins. The close (X)
// discards this capture/edit entirely without committing it, for a seller
// who decides they don't want this particular spin after all.
export default function SpinPreviewModal({
  visible,
  frames,
  label,
  onChangeLabel,
  labelSuggestions,
  onRetake,
  onContinue,
  onClose,
}: Props) {
  const { t } = useLanguage();
  // Same story as CameraCapture: Android draws this modal edge to edge, so
  // without these the X sits under the clock and -- the one that actually
  // cost the seller their capture -- Continue and Retake sit under the
  // navigation bar, where they cannot be tapped at all.
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.topBar, { paddingTop: insets.top + 14 }]}>
          <Pressy onPress={onClose} style={styles.iconBtn} accessibilityLabel="Close">
            <Icon name="close" size={18} color={colors.white} />
          </Pressy>
          <Text style={styles.title}>{t('createListing.spinPreviewTitle')}</Text>
          <View style={styles.iconBtn} />
        </View>

        <View style={styles.labelRow}>
          <TextInput
            value={label}
            onChangeText={onChangeLabel}
            placeholder={t('createListing.spinSetLabelPlaceholder')}
            placeholderTextColor="rgba(255,255,255,0.5)"
            style={styles.labelInput}
          />
          {labelSuggestions.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {labelSuggestions.map((s) => (
                <Pressy key={s} onPress={() => onChangeLabel(s)} style={[styles.chip, label === s && styles.chipActive]}>
                  <Text style={[styles.chipText, label === s && styles.chipTextActive]}>{s}</Text>
                </Pressy>
              ))}
            </ScrollView>
          )}
        </View>

        <View style={styles.viewerWrap}>
          <SpinViewer frames={frames} />
        </View>

        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 18 }]}>
          <Text style={styles.hintText}>{t('createListing.spinPreviewHint')}</Text>
          <Pressy onPress={onRetake} style={styles.retakeBtn} accessibilityLabel="Retake photos">
            <Icon name="rotate" size={14} color={colors.white} />
            <Text style={styles.retakeBtnText}>{t('createListing.spinPreviewRetake')}</Text>
          </Pressy>
          <Pressy onPress={onContinue} style={styles.continueBtn} accessibilityLabel="Continue">
            <Text style={styles.continueBtnText}>{t('createListing.spinPreviewContinue')}</Text>
          </Pressy>
        </View>
        <SystemBottomStrip />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 6,
  },
  iconBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { ...type.soft, color: colors.white, fontWeight: '600' },
  labelRow: { paddingHorizontal: 14, paddingTop: 8, gap: 8 },
  labelInput: {
    height: 40, borderRadius: radius.sm, paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.12)', color: colors.white, fontSize: 14.5,
  },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    height: 30, paddingHorizontal: 13, borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.white },
  chipText: { ...type.tiny, color: colors.white, fontWeight: '600' },
  chipTextActive: { color: colors.ink },
  viewerWrap: { flex: 1, position: 'relative', overflow: 'hidden', margin: 14, borderRadius: radius.md },
  bottomBar: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 18, gap: 10, alignItems: 'center' },
  hintText: { ...type.tiny, color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  retakeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 16,
  },
  retakeBtnText: { ...type.soft, color: colors.white, fontWeight: '600' },
  continueBtn: {
    alignSelf: 'stretch', backgroundColor: colors.white, borderRadius: radius.pill,
    paddingHorizontal: 22, paddingVertical: 14, alignItems: 'center',
  },
  continueBtnText: { ...type.body, fontWeight: '700' },
});
