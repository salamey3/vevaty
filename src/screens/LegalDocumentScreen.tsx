import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import LegalDocumentView from '../components/LegalDocumentView';
import { Alert } from '../lib/alertShim';
import { colors, radius, type } from '../theme/theme';
import { mirrorRow } from '../lib/mirrorRow';
import { useLanguage } from '../i18n/LanguageContext';
import { useAppStore } from '../store/AppStore';
import { useIsDesktop, DESKTOP_CONTENT_MAX_WIDTH } from '../hooks/useResponsive';
import { useGoBack } from '../hooks/useGoBack';
import { RootStackParamList } from '../navigation/types';
import { LegalDocument, acceptLegalDocument, bodyFor, fetchLegalDocument } from '../lib/legal';

// Reading one of the conditions documents in full.
//
// Reachable from the tick on the two screens that require agreement, and
// on its own -- anyone may read the terms, signed in or not. A contract you
// can only read after committing to it is not one, which is why the fetch
// is granted to anonymous callers and this screen never gates the reading,
// only the agreeing.

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'LegalDocument'>;

export default function LegalDocumentScreen() {
  const navigation = useNavigation<Nav>();
  // Not navigation.goBack(): a shared /terms/:slug link opens this screen
  // as the only entry in the stack, where goBack does nothing at all.
  const goBack = useGoBack();
  const route = useRoute<R>();
  const { slug } = route.params;
  const { t, isRTL, language } = useLanguage();
  // authChecked as well as isVerified: this route is deep-linkable as
  // /terms/:slug, and isVerified starts false on every cold load. Reading
  // it alone told a verified person arriving from a shared link to sign in.
  const { isVerified, authChecked } = useAppStore();
  const isDesktop = useIsDesktop();

  const [doc, setDoc] = useState<LegalDocument | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase('loading');
    (async () => {
      try {
        const d = await fetchLegalDocument(slug);
        if (!alive) return;
        if (d === null) { setPhase('failed'); return; }
        setDoc(d);
        setPhase('ready');
      } catch {
        if (alive) setPhase('failed');
      }
    })();
    return () => { alive = false; };
  }, [slug, reload]);

  const agree = useCallback(async () => {
    if (!doc) return;
    setSaving(true);
    setError(null);
    try {
      const { acceptedAt } = await acceptLegalDocument(doc.slug, doc.version, 'document_reader');
      setDoc({ ...doc, accepted: true, acceptedAt });
      // Cleared BEFORE navigating. It used to rely on goBack unmounting
      // the screen, which does not happen when this is the only route in
      // the stack -- and the back arrow is disabled while saving, so the
      // screen became a room with no door.
      setSaving(false);
      // Back to whatever asked for the agreement. That screen re-checks on
      // focus, so the tick there is already settled.
      goBack();
    } catch (e: any) {
      setSaving(false);
      if (e?.code === 'version_superseded') {
        // Alerted rather than only written at the foot of the page: the
        // reload remounts the ScrollView at the top, and an explanation
        // below the fold is one the person who just tapped agree never
        // sees.
        Alert.alert(t('legal.title'), t('legal.superseded'));
        setError(t('legal.superseded'));
        setReload((n) => n + 1);
      } else {
        setError(t('legal.agreeFailed'));
      }
    }
  }, [doc, goBack, t]);

  const bar = (title: string) => (
    <View style={[styles.topBar, mirrorRow(isRTL)]}>
      <Pressy onPress={goBack} style={styles.iconBtn} disabled={saving}>
        <Icon name="back" size={18} />
      </Pressy>
      <Text style={type.h3} numberOfLines={1}>{title}</Text>
      <View style={styles.iconBtn} />
    </View>
  );

  if (phase === 'loading') {
    return (
      <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
        {bar(t('legal.title'))}
        <ActivityIndicator style={{ marginTop: 50 }} color={colors.primary} />
      </Screen>
    );
  }

  if (phase === 'failed' || !doc) {
    return (
      <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
        {bar(t('legal.title'))}
        <View style={styles.gate}>
          <Icon name="rotate" size={26} color={colors.inkSoft} />
          <Text style={[type.body, { marginTop: 12, textAlign: 'center' }]}>
            {t('legal.loadFailed')}
          </Text>
          <Pressy onPress={() => setReload((n) => n + 1)} style={styles.agreeBtn}>
            <Text style={styles.agreeText}>{t('common.retry')}</Text>
          </Pressy>
        </View>
      </Screen>
    );
  }

  const { body, title, isFallback } = bodyFor(doc, language === 'ar');

  return (
    <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
      {bar(title)}
      <ScrollView contentContainerStyle={[styles.body, isDesktop && styles.bodyDesktop]}>
        <Text style={[styles.version, isRTL && styles.rtl]}>
          {t('legal.version', { n: String(doc.version) })}
        </Text>

        {/* Said rather than hidden. English text appearing inside an
            otherwise Arabic app looks like a bug unless the page says it
            is not one. */}
        {isFallback ? (
          <View style={styles.fallback}>
            <Text style={styles.fallbackText}>{t('legal.englishOnly')}</Text>
          </View>
        ) : null}

        <LegalDocumentView body={body} />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {doc.accepted ? (
          <View style={[styles.agreed, mirrorRow(isRTL)]}>
            <Icon name="checkCircle" size={16} color={colors.success} />
            <Text style={styles.agreedText}>
              {doc.acceptedAt
                ? t('legal.agreedOn', { date: new Date(doc.acceptedAt).toLocaleDateString() })
                : t('legal.agreedNoDate')}
            </Text>
          </View>
        ) : authChecked && isVerified ? (
          <Pressy onPress={agree} disabled={saving} style={[styles.agreeBtn, saving && styles.dim]}>
            {saving ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.agreeText}>{t('legal.agreeCta')}</Text>
            )}
          </Pressy>
        ) : (
          <Text style={[styles.meta, isRTL && styles.rtl]}>{t('legal.signInToAgree')}</Text>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, height: 48,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 18, paddingBottom: 120 },
  bodyDesktop: { paddingHorizontal: 0, paddingBottom: 60 },
  version: { ...type.tiny, marginBottom: 16, letterSpacing: 0.3 },
  fallback: {
    backgroundColor: colors.surface, borderRadius: radius.sm,
    padding: 11, marginBottom: 18,
  },
  fallbackText: { fontSize: 13, color: colors.inkSoft, lineHeight: 18 },
  error: { ...type.tiny, color: colors.danger, lineHeight: 17, marginTop: 10 },
  agreeBtn: {
    marginTop: 20, height: 50, borderRadius: radius.pill, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24,
  },
  agreeText: { fontSize: 15, fontWeight: '800', color: colors.white },
  dim: { opacity: 0.5 },
  agreed: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20,
    padding: 13, borderRadius: radius.sm, backgroundColor: colors.primaryTint,
  },
  agreedText: { fontSize: 13.5, fontWeight: '700', color: colors.success },
  meta: { ...type.tiny, marginTop: 18, lineHeight: 17 },
  gate: { alignItems: 'center', paddingTop: 50, paddingHorizontal: 30 },
  rtl: { textAlign: 'right', writingDirection: 'rtl' },
});
