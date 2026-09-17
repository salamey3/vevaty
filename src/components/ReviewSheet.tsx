import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, type, radius } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';
import { leaveReview, ReviewError, ReviewGate } from '../lib/reviews';
import { mirrorRow } from '../lib/mirrorRow';

// Rating a seller after dealing with them: five stars and, optionally, a
// sentence. Nothing more, on purpose -- the thing a buyer will actually
// finish on a phone in a doorway is one tap and a close, and a form that
// asks for a title, a photo and three sub-scores gets abandoned.
//
// The comment is optional and the stars are not. A rating with no words is
// a real answer; words with no rating is not a review, it is a message,
// and there is a chat for that.

const MAX_COMMENT = 1000;

type Props = {
  visible: boolean;
  onClose: () => void;
  listingId: string;
  sellerName: string;
  // What the gate said. Carries the existing review when there is one, so
  // the sheet opens on what they wrote rather than on a blank form.
  gate: ReviewGate;
  onSaved: (result: { wasNew: boolean; pointsAwarded: number }) => void;
};

export default function ReviewSheet({
  visible, onClose, listingId, sellerName, gate, onSaved,
}: Props) {
  const { t, isRTL } = useLanguage();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reseeded every time it opens, not once on mount: the same sheet is
  // reused for a different listing, and a stale four stars from the last
  // one would be a rating this buyer never gave.
  useEffect(() => {
    if (!visible) return;
    setRating(gate.rating ?? 0);
    setComment(gate.comment ?? '');
    setError(null);
    setSaving(false);
  }, [visible, gate.rating, gate.comment]);

  const editing = gate.reason === 'already_reviewed';

  const save = async () => {
    if (rating < 1) {
      setError(t('reviews.pickStars'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await leaveReview(listingId, rating, comment);
      setSaving(false);
      onSaved(result);
      onClose();
    } catch (e) {
      setSaving(false);
      const code = (e as ReviewError)?.code;
      // Each refusal has its own sentence. 'no_contact' is the one a buyer
      // will actually hit, and it has to explain the rule rather than
      // sounding like a fault.
      setError(
        code === 'no_contact' ? t('reviews.errNoContact')
          : code === 'own_listing' ? t('reviews.errOwnListing')
          : code === 'not_verified' ? t('reviews.errNotVerified')
          : code === 'not_signed_in' ? t('reviews.errNotSignedIn')
          : code === 'comment_too_long' ? t('reviews.errTooLong')
          : code === 'rating_invalid' ? t('reviews.pickStars')
          // Both of these used to fall through to "try again", which is
          // advice that can never work: the listing is gone, or the review
          // already exists and this sheet is out of date.
          : code === 'listing_not_found' ? t('reviews.errListingGone')
          : code === 'already_reviewed' ? t('reviews.errAlreadyReviewed')
          : t('reviews.errGeneric')
      );
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={[styles.head, mirrorRow(isRTL)]}>
            <Text style={styles.title} numberOfLines={2}>
              {editing ? t('reviews.editTitle', { name: sellerName })
                       : t('reviews.title', { name: sellerName })}
            </Text>
            <Pressy onPress={onClose} style={styles.closeBtn} disabled={saving}>
              <Icon name="close" size={17} color={colors.inkSoft} />
            </Pressy>
          </View>

          <View
            style={styles.stars}
            accessibilityRole="adjustable"
            accessibilityLabel={t('reviews.starsLabel')}
            // Omitted until something is chosen: `now: 0` against `min: 1`
            // is a value outside its own range, which a screen reader
            // announces as nonsense.
            accessibilityValue={rating > 0 ? { min: 1, max: 5, now: rating } : undefined}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressy
                key={n}
                onPress={() => setRating(n)}
                disabled={saving}
                style={styles.starBtn}
                // The word, not "{n} stars" -- which read "1 stars" in
                // English and needed a dual form in Arabic. These are the
                // labels on the whole rating control for a non-sighted
                // user, so they have to be sentences that work.
                accessibilityLabel={t(`reviews.word${n}` as any)}
              >
                <Icon
                  name="star"
                  size={34}
                  filled={n <= rating}
                  color={n <= rating ? colors.accent : colors.line}
                />
              </Pressy>
            ))}
          </View>
          <Text style={styles.starWord}>
            {rating === 0 ? t('reviews.noRatingYet') : t(`reviews.word${rating}` as any)}
          </Text>

          <TextInput
            value={comment}
            onChangeText={(v) => setComment(v.slice(0, MAX_COMMENT))}
            placeholder={t('reviews.commentPlaceholder')}
            placeholderTextColor={colors.inkSoft}
            multiline
            editable={!saving}
            style={styles.input}
          />
          <Text style={styles.counter}>
            {t('reviews.optional')}
            {comment.length > MAX_COMMENT - 100 ? ` · ${MAX_COMMENT - comment.length}` : ''}
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={[styles.actions, mirrorRow(isRTL)]}>
            <Pressy onPress={onClose} style={styles.cancelBtn} disabled={saving}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressy>
            {/* Only `saving` disables it. Adding `rating < 1` here made the
                button inert on the first-time path -- Pressy has no
                disabled styling, so it looked live, did nothing on tap,
                and the "choose a rating" sentence inside save() could
                never be reached. It is dimmed instead, and the tap still
                explains itself. */}
            <Pressy
              onPress={save}
              style={[styles.saveBtn, (saving || rating < 1) && styles.saveBtnIdle]}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.saveText}>
                  {editing ? t('reviews.update') : t('reviews.submit')}
                </Text>
              )}
            </Pressy>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(18, 24, 21, 0.55)',
    alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  sheet: {
    width: '100%', maxWidth: 460, backgroundColor: colors.card,
    borderRadius: radius.lg, padding: 20, gap: 10,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { flex: 1, ...type.h3 },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

  stars: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginTop: 4 },
  starBtn: { padding: 4 },
  starWord: {
    textAlign: 'center', fontSize: 13, fontWeight: '700',
    color: colors.inkSoft, minHeight: 18,
  },

  input: {
    minHeight: 88, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm,
    padding: 11, color: colors.ink, backgroundColor: colors.bg,
    fontSize: 14.5, textAlignVertical: 'top', marginTop: 6,
  },
  counter: { ...type.tiny, color: colors.inkSoft },
  error: { ...type.tiny, color: colors.danger, lineHeight: 17 },

  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 6 },
  cancelBtn: { height: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 14.5, fontWeight: '700', color: colors.inkSoft },
  saveBtn: {
    height: 44, minWidth: 132, paddingHorizontal: 20, borderRadius: radius.pill,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  saveBtnIdle: { opacity: 0.4 },
  saveText: { fontSize: 14.5, fontWeight: '800', color: colors.white },
  // The app never flips I18nManager, so mirrored rows are spelled out.
});
