import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useLanguage } from '../i18n/LanguageContext';
import { TIER_LABELS } from '../i18n/translations';
import { TIER_THRESHOLDS } from '../data/points';
import { relativeTimeFrom } from '../lib/relativeTime';
import { useGoBack } from '../hooks/useGoBack';
import { DESKTOP_CONTENT_MAX_WIDTH } from '../hooks/useResponsive';

// The full points/rewards ledger -- ProfileScreen's hero shows the
// balance and tier, and its own "Points activity" section shows the last
// few entries with a "See all" row that lands here (same split as My
// Listings/Favorites off Profile). Backed by AppStore's pointsHistory,
// which is myazar.points_transactions itself (see fetchPointsHistory) --
// every row here is a real database record, not something built on
// device, so it's the same list whether opened on this phone or another.
export default function PointsActivityScreen() {
  const goBack = useGoBack();
  const { t, language } = useLanguage();
  const { profile, pointsHistory, fetchPointsHistory } = useAppStore();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      fetchPointsHistory();
    }, [fetchPointsHistory])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchPointsHistory();
    } finally {
      setRefreshing(false);
    }
  };

  const nextTier = TIER_THRESHOLDS.find((tier) => tier.min > profile.points);

  return (
    <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
      <View style={styles.header}>
        <Pressy onPress={goBack} style={styles.backBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.title}>{t('profile.pointsActivity')}</Text>
      </View>

      <View style={styles.balanceCard}>
        <View style={styles.balanceRow}>
          <Icon name="trophy" size={18} color={colors.accentDeep} />
          <Text style={styles.balanceNumber}>{profile.points}</Text>
          <Text style={styles.balanceUnit}>{t('profile.points')}</Text>
        </View>
        <View style={styles.tierPill}>
          <Text style={styles.tierPillText}>{TIER_LABELS[language][profile.tier]}</Text>
        </View>
        {nextTier && (
          <Text style={styles.nextTier}>
            {t('profile.pointsToTier', { points: nextTier.min - profile.points, tier: TIER_LABELS[language][nextTier.tier] })}
          </Text>
        )}
      </View>

      {pointsHistory.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.iconWrap}>
            <Icon name="trophy" size={24} color={colors.inkSoft} />
          </View>
          <Text style={type.h3}>{t('profile.pointsActivity')}</Text>
          <Text style={[type.soft, styles.emptySub]}>{t('pointsActivity.emptySub')}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {pointsHistory.map((e) => {
            const spent = e.amount < 0;
            return (
              <View key={e.id} style={styles.row}>
                <View style={[styles.rowIconWrap, spent && styles.rowIconWrapSpent]}>
                  <Icon name={spent ? 'sparkle' : 'trophy'} size={14} color={spent ? colors.accentDeep : colors.success} />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowLabel} numberOfLines={2}>{e.label}</Text>
                  <Text style={styles.rowDate}>{relativeTimeFrom(e.createdAt, language)}</Text>
                </View>
                <Text style={[styles.rowAmount, { color: spent ? colors.accentDeep : colors.success }]}>
                  {spent ? '' : '+'}{e.amount}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  balanceCard: {
    marginHorizontal: 18, marginBottom: 8, padding: 16, borderRadius: radius.md,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: 'center', gap: 4,
  },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  balanceNumber: { fontSize: 24, fontWeight: '800', color: colors.ink },
  balanceUnit: { fontSize: 13, color: colors.inkSoft },
  tierPill: {
    marginTop: 6, backgroundColor: colors.accentTint, borderRadius: radius.pill,
    paddingHorizontal: 12, height: 24, justifyContent: 'center',
  },
  tierPillText: { fontSize: 12, fontWeight: '700', color: colors.accentDeep },
  nextTier: { fontSize: 12, color: colors.inkSoft, marginTop: 4, textAlign: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 8 },
  iconWrap: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  emptySub: { textAlign: 'center', lineHeight: 18 },
  scroll: { paddingHorizontal: 18, paddingBottom: 110, gap: 10 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 12,
  },
  rowIconWrap: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primaryTint,
  },
  rowIconWrapSpent: { backgroundColor: colors.accentTint },
  rowInfo: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 13.5, fontWeight: '600', color: colors.ink },
  rowDate: { fontSize: 11.5, color: colors.inkSoft },
  rowAmount: { fontSize: 15, fontWeight: '800' },
});
