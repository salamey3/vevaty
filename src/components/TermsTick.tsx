import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';
import { mirrorRow } from '../lib/mirrorRow';
import { useLanguage } from '../i18n/LanguageContext';
import { RootStackParamList } from '../navigation/types';
import { LegalDocument, LegalSlug, acceptLegalDocument, fetchLegalDocument } from '../lib/legal';

// Three states, not two. A boolean forced the parent to answer a FAILED
// load with "tick the box to agree" -- pointing at a box that was not on
// screen, and giving an instruction that could not be followed.
export type TermsState = 'accepted' | 'pending' | 'unavailable';

// The row that says "I have read and agree to ...", on the two screens
// where agreeing is a precondition.
//
// Ticking it RECORDS the agreement immediately rather than holding it
// until the form is submitted. That is not a shortcut: an agreement is a
// thing a person did at a moment, and "they ticked it at 14:32" is the
// answer if it is ever disputed. It also means an abandoned form does not
// lose the agreement, and a returning consignor sees it already settled.
//
// Which makes it one-way, deliberately. There is no untick, because you
// cannot un-agree to something -- if somebody changes their mind they
// simply do not submit. Once recorded the row shows the date instead of a
// checkbox.

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function TermsTick({
  slug,
  context,
  onChange,
  refreshToken = 0,
}: {
  slug: LegalSlug;
  // Where the person was standing when they agreed. Stored with the
  // acceptance -- the slug alone does not carry it, and it is the detail
  // that makes the record mean something later.
  context: string;
  onChange: (state: TermsState) => void;
  // Bumped by the parent when the SERVER says the terms were not accepted
  // after this row said they were -- which happens when a new version is
  // published while the screen is open. Without it the row sat there
  // ticked, disabled and showing a date, under an error telling the reader
  // to tick a box they could not reach: a dead end with no way out but
  // guessing that the document link would fix it.
  refreshToken?: number;
}) {
  const navigation = useNavigation<Nav>();
  const { t, isRTL } = useLanguage();
  const [doc, setDoc] = useState<LegalDocument | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `alive` is threaded through because backing out mid-fetch otherwise
  // writes state into an unmounted parent through onChange.
  const load = useCallback(async (alive: () => boolean = () => true) => {
    try {
      const d = await fetchLegalDocument(slug);
      if (!alive()) return;
      if (d === null) {
        setPhase('failed');
        // A row that could not load must not read as "not agreed". The
        // parent refuses to proceed either way, but it is told WHICH
        // refusal this is so it can say something true about it.
        onChange('unavailable');
        return;
      }
      setDoc(d);
      setPhase('ready');
      onChange(d.accepted ? 'accepted' : 'pending');
    } catch {
      // fetchLegalDocument converts a RETURNED error; a thrown one -- a
      // dropped connection, a malformed reply -- used to reject
      // unhandled and leave this row spinning for good, with no retry
      // because the retry only exists in the failed branch.
      if (!alive()) return;
      setPhase('failed');
      onChange('unavailable');
    }
  }, [slug, onChange]);

  // On focus, not just on mount: the reader screen has its own agree
  // button, and coming back from it must settle this row. refreshToken is
  // in the deps so a parent can force the same reload without a focus
  // change, which is the superseded-version case.
  useFocusEffect(useCallback(() => {
    let live = true;
    load(() => live);
    return () => { live = false; };
  }, [load, refreshToken]));

  const agree = async () => {
    if (!doc || doc.accepted) return;
    setSaving(true);
    setError(null);
    try {
      // The SERVER's timestamp. Substituting the device clock here put a
      // date on screen that could disagree with the record it describes.
      const { acceptedAt } = await acceptLegalDocument(doc.slug, doc.version, context);
      setDoc({ ...doc, accepted: true, acceptedAt });
      onChange('accepted');
      setSaving(false);
    } catch (e: any) {
      setSaving(false);
      const code = e?.code;
      if (code === 'version_superseded') {
        // The document changed while this screen was open, so what they
        // were about to agree to is not what is now in force. The reload
        // brings the new version in and puts the tick back.
        setError(t('legal.superseded'));
        load();
      } else {
        setError(code === 'not_signed_in' ? t('legal.signInToAgree') : t('legal.agreeFailed'));
      }
    }
  };

  if (phase === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={colors.inkSoft} />
      </View>
    );
  }

  if (phase === 'failed' || !doc) {
    return (
      <View style={styles.failed}>
        {/* `error` first: when a superseded-version reload is what failed,
            its explanation is the more useful of the two and used to be
            thrown away by this early return. */}
        <Text style={[styles.failedText, isRTL && styles.rtl]}>
          {error || t('legal.loadFailed')}
        </Text>
        <Pressy onPress={() => { setPhase('loading'); setError(null); load(); }} style={styles.retry}>
          <Text style={styles.retryText}>{t('common.retry')}</Text>
        </Pressy>
      </View>
    );
  }

  const title = isRTL ? doc.titleAr : doc.titleEn;

  return (
    <View style={styles.wrap}>
      <View style={[styles.row, mirrorRow(isRTL)]}>
        <Pressy
          onPress={agree}
          disabled={saving || doc.accepted}
          style={styles.boxTap}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: doc.accepted, disabled: saving || doc.accepted, busy: saving }}
          accessibilityLabel={t('legal.agreeTo', { title })}
        >
          <View style={[styles.box, doc.accepted && styles.boxOn]}>
            {saving ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : doc.accepted ? (
              <Icon name="check" size={13} color={colors.white} />
            ) : null}
          </View>
        </Pressy>

        <View style={styles.textCol}>
          <Text style={[styles.label, isRTL && styles.rtl]}>
            {t('legal.iAgreeTo')}{' '}
            <Text
              style={styles.link}
              accessibilityRole="link"
              onPress={() => navigation.navigate('LegalDocument', { slug })}
            >
              {title}
            </Text>
          </Text>
          <Text style={[styles.meta, isRTL && styles.rtl]}>
            {!doc.accepted
              ? t('legal.readFirst')
              : doc.acceptedAt
                ? t('legal.agreedOn', { date: new Date(doc.acceptedAt).toLocaleDateString() })
                // Agreed, but the server did not say when. Today's date
                // would be a guess stated as a fact, on the one screen
                // where the date is the point.
                : t('legal.agreedNoDate')}
          </Text>
        </View>
      </View>

      {error ? <Text style={[styles.error, isRTL && styles.rtl]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 6 },
  loading: { paddingVertical: 22, alignItems: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 11,
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, padding: 13,
  },
  boxTap: { paddingTop: 1 },
  box: {
    width: 22, height: 22, borderRadius: 5, borderWidth: 1.5,
    borderColor: colors.line, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card,
  },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  textCol: { flex: 1, gap: 3 },
  label: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  link: { color: colors.primary, fontWeight: '800', textDecorationLine: 'underline' },
  meta: { ...type.tiny, lineHeight: 16 },
  error: { ...type.tiny, color: colors.danger, lineHeight: 17, marginTop: 8 },

  failed: {
    backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, padding: 13, gap: 9, alignItems: 'flex-start',
  },
  failedText: { fontSize: 13.5, color: colors.ink, lineHeight: 19 },
  retry: {
    height: 34, paddingHorizontal: 14, justifyContent: 'center',
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card,
  },
  retryText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
});
