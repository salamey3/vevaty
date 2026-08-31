import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { mirrorRow } from '../lib/mirrorRow';
import { useAppStore } from '../store/AppStore';
import { useLanguage } from '../i18n/LanguageContext';
import { ContactOutcome, ContactPrompt } from '../types';

// "Did you reach the seller?" -- the one question that closes the loop on
// a conversation Vevaty cannot see.
//
// A buyer who called a seller and was told the item sold three days ago is
// the only person who knows that. The seller who forgot to remove the
// listing is, by definition, not going to tell us; the phone call left no
// trace; and the listing looks perfectly healthy from every angle until
// the next buyer wastes their afternoon on it. So we ask the person who
// found out. See LIFECYCLE.md.
//
// Shown in two places from one component and one answer: a card above the
// feed (where every buyer reliably returns) and on the listing itself if
// they happen to revisit it. Answering in either place removes it from
// both, because the answer lives in AppStore, not here.
export default function ContactOutcomePrompt({
  prompt,
  compact,
}: {
  prompt: ContactPrompt;
  // The listing-page variant: no thumbnail and no title, because the
  // buyer is already looking at both.
  compact?: boolean;
}) {
  const { answerContactPrompt } = useAppStore();
  const { t, language, isRTL } = useLanguage();
  const [busy, setBusy] = useState<ContactOutcome | null>(null);
  const [failed, setFailed] = useState(false);

  const title = (language === 'ar' ? prompt.titleAr : prompt.titleEn) || t('createListing.untitled');
  const daysAgo = Math.max(1, Math.round((Date.now() - prompt.contactedAt) / (24 * 60 * 60 * 1000)));

  const answer = async (outcome: ContactOutcome) => {
    if (busy) return;
    setBusy(outcome);
    setFailed(false);
    try {
      await answerContactPrompt(prompt.listingId, outcome);
    } catch {
      // The card is put back by the store on failure, so all this has to
      // do is explain why it is still here.
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const label = (outcome: ContactOutcome, key: string) => (
    <Pressy
      key={outcome}
      onPress={() => answer(outcome)}
      disabled={!!busy}
      style={[styles.choice, busy === outcome && styles.choiceBusy]}
    >
      <Text style={styles.choiceText}>{t(key)}</Text>
    </Pressy>
  );

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      {/* mirrorRow, not a bare row: this app never flips
          I18nManager.isRTL, so on Android/iOS a row is NOT reversed for
          Arabic and textAlign 'auto' resolves to left. Web gets it free
          from document.dir. See mirrorRow's own comment. */}
      <View style={[styles.head, mirrorRow(isRTL)]}>
        {!compact && prompt.photoUrl ? (
          <Image source={{ uri: prompt.photoUrl }} style={styles.thumb} />
        ) : null}
        <View style={styles.headText}>
          <Text style={[styles.question, isRTL && styles.rtl]}>{t('contactPrompt.question')}</Text>
          {!compact && (
            <Text style={[styles.subject, isRTL && styles.rtl]} numberOfLines={1}>
              {title}
            </Text>
          )}
          <Text style={[styles.meta, isRTL && styles.rtl]}>{t('contactPrompt.contactedAgo', { n: daysAgo })}</Text>
        </View>
        {/* Dismiss is a real answer, not an escape hatch -- it records
            that they were asked and chose not to say, which is what stops
            the same card coming back tomorrow. */}
        <Pressy onPress={() => answer('dismissed')} disabled={!!busy} style={styles.dismiss}>
          <Icon name="close" size={14} color={colors.inkSoft} />
        </Pressy>
      </View>

      <View style={[styles.choices, mirrorRow(isRTL)]}>
        {label('available', 'contactPrompt.stillAvailable')}
        {label('sold', 'contactPrompt.theySaidSold')}
        {label('no_answer', 'contactPrompt.noAnswer')}
      </View>

      {failed && <Text style={[styles.failed, isRTL && styles.rtl]}>{t('contactPrompt.failed')}</Text>}
      <Text style={[styles.why, isRTL && styles.rtl]}>{t('contactPrompt.why')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    gap: 10,
  },
  cardCompact: { borderRadius: radius.md, padding: 12 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  thumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surface },
  headText: { flex: 1, gap: 1 },
  question: { ...type.h3 },
  subject: { ...type.soft, color: colors.ink },
  meta: { ...type.tiny },
  // No marginEnd: mirrorRow flips the row for Arabic on native, but
  // marginEnd still resolves to marginRight there (I18nManager.isRTL is
  // never flipped), so a directional outdent points the wrong way in
  // exactly the layout it was meant for.
  dismiss: { padding: 4, marginTop: -2 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choice: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
    borderRadius: radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  choiceBusy: { opacity: 0.5 },
  choiceText: { ...type.tiny, color: colors.ink, fontWeight: '600' },
  failed: { ...type.tiny, color: colors.danger },
  why: { ...type.tiny, lineHeight: 15 },
  rtl: { textAlign: 'right' },
});
