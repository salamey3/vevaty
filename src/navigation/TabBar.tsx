import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Text, ViewStyle } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import Pressy from '../components/Pressy';
import BrandMark from '../components/BrandMark';
import Icon, { IconName } from '../icons/Icon';
import { colors, radius } from '../theme/theme';
import { useIsDesktop, SIDEBAR_WIDTH } from '../hooks/useResponsive';
import { useLanguage } from '../i18n/LanguageContext';
import { useScrollChrome } from '../store/ScrollChromeContext';

const ICONS: Record<string, IconName> = {
  HomeTab: 'home',
  SellTab: 'plus',
  ChatTab: 'chat',
  ProfileTab: 'user',
};

const LABEL_KEYS: Record<string, string> = {
  HomeTab: 'nav.home',
  SellTab: 'nav.sell',
  ChatTab: 'nav.messages',
  ProfileTab: 'nav.profile',
};

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const isDesktop = useIsDesktop();
  const { t, isRTL } = useLanguage();
  // Mobile-only auto-hide, shared with HomeScreen's category slider via
  // ScrollChromeContext (this component can't see another screen's scroll
  // events directly -- see that file's own comment for why). Whichever tab
  // is focused changes, always snap back to visible: only HomeScreen wires
  // up onChromeScroll today, so without this reset, leaving Home mid-
  // scroll-down would strand the bar hidden on Chat/Sell/Profile with no
  // way to bring it back.
  const { chromeVisible, showChrome } = useScrollChrome();
  const focusedIndex = state.index;
  const lastIndexRef = useRef(focusedIndex);
  useEffect(() => {
    if (lastIndexRef.current !== focusedIndex) {
      lastIndexRef.current = focusedIndex;
      showChrome();
    }
  }, [focusedIndex, showChrome]);

  if (isDesktop) {
    return (
      <View style={[styles.sidebar, isRTL ? styles.sidebarRTL : styles.sidebarLTR]}>
        <View style={styles.brandRow}>
          <BrandMark variant="sidebar" />
        </View>

        <View style={styles.navList}>
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const isSell = route.name === 'SellTab';
            const onPress = () => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name as never);
              }
            };
            return (
              <Pressy
                key={route.key}
                onPress={onPress}
                style={[styles.navItem, isSell && styles.navItemSell, focused && !isSell && styles.navItemActive]}
              >
                <Icon
                  name={ICONS[route.name]}
                  size={18}
                  color={isSell ? colors.white : focused ? colors.ink : colors.inkSoft}
                  strokeWidth={focused ? 2 : 1.6}
                />
                <Text style={[styles.navLabel, isSell && styles.navLabelSell, focused && !isSell && styles.navLabelActive]}>
                  {t(LABEL_KEYS[route.name])}
                </Text>
              </Pressy>
            );
          })}
        </View>

        <Text style={[styles.footerNote, isRTL ? styles.footerNoteRTL : styles.footerNoteLTR]}>{t('nav.footer')}</Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.wrap, !chromeVisible && styles.wrapHidden]}
      pointerEvents={chromeVisible ? 'box-none' : 'none'}
    >
      <View style={styles.pillShadow}>
        <BlurView intensity={55} tint="light" style={StyleSheet.absoluteFill} />
        <View style={styles.pill}>
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const isSell = route.name === 'SellTab';
            const onPress = () => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name as never);
              }
            };
            if (isSell) {
              return (
                <Pressy key={route.key} onPress={onPress} style={styles.sellBtn}>
                  <Icon name="plus" size={22} color={colors.white} />
                </Pressy>
              );
            }
            return (
              <Pressy key={route.key} onPress={onPress} style={styles.tabItem}>
                <Icon name={ICONS[route.name]} size={21} color={focused ? colors.ink : colors.inkSoft} strokeWidth={focused ? 2 : 1.6} />
                <View style={[styles.dot, focused && styles.dotActive]} />
              </Pressy>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Mobile: floating bottom pill (unchanged from before).
  // Auto-hide transition (see ScrollChromeContext) -- web-only CSS
  // transition props rather than RN's Animated API, same reasoning as
  // Pressy.tsx's press-scale motion (this app is web-only and Animated's
  // web fallback has real, previously-hit bugs).
  wrap: {
    position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingBottom: 20,
    transform: [{ translateY: 0 }],
    opacity: 1,
    transitionProperty: 'transform, opacity',
    transitionDuration: '220ms',
    transitionTimingFunction: 'ease-out',
  } as ViewStyle,
  wrapHidden: {
    transform: [{ translateY: 120 }],
    opacity: 0,
  },
  pillShadow: {
    borderRadius: radius.pill,
    overflow: 'hidden',
    shadowColor: '#18181a',
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    height: 66,
    gap: 4,
  },
  tabItem: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center', gap: 4 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent' },
  dotActive: { backgroundColor: colors.ink },
  sellBtn: {
    width: 50, height: 50, borderRadius: 25, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center', marginHorizontal: 2,
  },

  // Desktop: persistent sidebar instead of a floating bottom pill. Sits on
  // the left in LTR (English) and flips to the right in RTL (Arabic) --
  // see sidebarLTR/sidebarRTL below, picked based on useLanguage().isRTL.
  sidebar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: SIDEBAR_WIDTH,
    backgroundColor: 'rgba(255,255,255,0.75)',
    paddingTop: 30,
    paddingHorizontal: 16,
  },
  sidebarLTR: { left: 0, borderRightWidth: 1, borderRightColor: colors.line },
  sidebarRTL: { right: 0, borderLeftWidth: 1, borderLeftColor: colors.line },
  brandRow: { paddingHorizontal: 6, marginBottom: 34 },
  navList: { gap: 4 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 44, borderRadius: radius.md, paddingHorizontal: 12 },
  navItemActive: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  navItemSell: { backgroundColor: colors.ink, marginTop: 10, marginBottom: 10 },
  navLabel: { fontSize: 14, fontWeight: '600', color: colors.inkSoft },
  navLabelActive: { color: colors.ink },
  navLabelSell: { color: colors.white },
  footerNote: { position: 'absolute', bottom: 20, fontSize: 10.5, color: colors.inkSoft },
  footerNoteLTR: { left: 22, right: 16 },
  footerNoteRTL: { right: 22, left: 16 },
});
