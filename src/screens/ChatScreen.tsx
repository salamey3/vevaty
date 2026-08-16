import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import Button from '../components/Button';
import LanguageSwitch from '../components/LanguageSwitch';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useChat } from '../store/ChatStore';
import { supabase } from '../lib/supabase';
import { RootStackParamList } from '../navigation/types';
import { ChatThread } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { listingTitle } from '../lib/listingText';

// Phase 4 item 11 -- replaces the old static placeholder. Lists every
// thread the signed-in user is a participant in (as buyer or seller),
// newest first, and jumps into ChatThreadScreen on tap. Thread rows lean
// on AppStore's already-loaded `listings` array for the listing's title
// and photo rather than re-fetching them -- see ChatStore.tsx for why that
// array already covers every listing this user could have a thread on.
export default function ChatScreen() {
  const { t, language } = useLanguage();
  const { profile, isVerified, listings } = useAppStore();
  const { threads, threadsLoading, loadThreads } = useChat();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // Display names for the "other participant" on threads where the
  // current user is the SELLER -- the buyer's name isn't on the listing
  // object (only the seller's is), so those need one small batch lookup.
  // Explicit column list, not select('*') -- profiles.phone has no SELECT
  // grant for anon/authenticated (see AppStore.tsx's syncFromSupabase for
  // the same pattern and why).
  const [buyerNames, setBuyerNames] = useState<Record<string, string>>({});

  useFocusEffect(
    React.useCallback(() => {
      if (isVerified) loadThreads();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isVerified])
  );

  const myUnknownBuyerIds = useMemo(() => {
    const ids = new Set<string>();
    threads.forEach((th) => {
      if (th.sellerId === profile.id && !buyerNames[th.buyerId]) ids.add(th.buyerId);
    });
    return Array.from(ids);
  }, [threads, profile.id, buyerNames]);

  useEffect(() => {
    if (myUnknownBuyerIds.length === 0) return;
    (async () => {
      const { data } = await supabase.from('profiles').select('id, full_name').in('id', myUnknownBuyerIds);
      if (!data) return;
      setBuyerNames((prev) => {
        const next = { ...prev };
        data.forEach((row: any) => { next[row.id] = row.full_name || t('chat.buyer'); });
        return next;
      });
    })();
  }, [myUnknownBuyerIds, t]);

  const rows = useMemo(() => {
    return threads.map((th: ChatThread) => {
      const listing = listings.find((l) => l.id === th.listingId);
      const iAmSeller = th.sellerId === profile.id;
      const otherName = iAmSeller
        ? (buyerNames[th.buyerId] || t('chat.buyer'))
        : (listing?.sellerName || t('chat.seller'));
      return {
        thread: th,
        listingTitleText: listing ? listingTitle(listing, language) : t('chat.listingRemoved'),
        photo: listing?.photos?.[0] || null,
        otherName,
      };
    });
  }, [threads, listings, profile.id, buyerNames, language, t]);

  const header = (
    <View style={styles.header}>
      <Text style={type.title}>{t('chat.title')}</Text>
      <LanguageSwitch compact />
    </View>
  );

  if (!isVerified) {
    return (
      <Screen reserveSidebar maxWidth={1180}>
        {header}
        <View style={styles.empty}>
          <View style={styles.iconWrap}>
            <Icon name="chat" size={26} color={colors.inkSoft} />
          </View>
          <Text style={type.h3}>{t('chat.loggedOutTitle')}</Text>
          <Text style={[type.soft, styles.sub]}>{t('chat.loggedOutSub')}</Text>
          <Button label={t('profile.logIn')} onPress={() => navigation.navigate('Auth')} style={{ marginTop: 16, width: 200 }} />
        </View>
      </Screen>
    );
  }

  if (!threadsLoading && rows.length === 0) {
    return (
      <Screen reserveSidebar maxWidth={1180}>
        {header}
        <View style={styles.empty}>
          <View style={styles.iconWrap}>
            <Icon name="chat" size={26} color={colors.inkSoft} />
          </View>
          <Text style={type.h3}>{t('chat.emptyTitle')}</Text>
          <Text style={[type.soft, styles.sub]}>{t('chat.emptySub')}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen reserveSidebar maxWidth={1180}>
      {header}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.thread.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressy
            onPress={() => navigation.navigate('ChatThread', { threadId: item.thread.id })}
            style={styles.row}
          >
            <View style={styles.thumbWrap}>
              {item.photo ? (
                <Image source={{ uri: item.photo }} style={styles.thumb} />
              ) : (
                <Icon name="bag" size={18} color={colors.inkSoft} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={type.h3} numberOfLines={1}>{item.otherName}</Text>
              <Text style={type.soft} numberOfLines={1}>{item.listingTitleText}</Text>
            </View>
            <Icon name="chevronRight" size={16} color={colors.inkSoft} />
          </Pressy>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 8,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 8 },
  iconWrap: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  sub: { textAlign: 'center', lineHeight: 18 },
  list: { paddingHorizontal: 18, paddingBottom: 90, gap: 10 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 12,
  },
  thumbWrap: {
    width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%' },
});
