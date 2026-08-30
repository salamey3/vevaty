import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, View, Text, ScrollView, ViewStyle } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Pressy from '../components/Pressy';
import BrandMark from '../components/BrandMark';
import { useGoHome } from '../hooks/useGoHome';
import Icon, { IconName } from '../icons/Icon';
import { colors, radius } from '../theme/theme';
import { useIsDesktop, SIDEBAR_WIDTH } from '../hooks/useResponsive';
import { useLanguage } from '../i18n/LanguageContext';
import { useScrollChrome } from '../store/ScrollChromeContext';
import { openLegalPage } from '../lib/legalLinks';
import { useBanners } from '../store/BannerStore';
import { BannerSlotView } from '../components/BannerSlot';

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
  // Resets one tab's nested stack to its first screen, with a new key so
  // the screen remounts rather than being restored with its old state.
  // Only HomeTab has a nested stack today; the others are single screens,
  // where popToTop is a no-op and this stays harmless.
  const goHome = useGoHome();

  const resetTabToTop = (routeName: string) => {
    navigation.navigate(routeName as never);
    navigation.reset({
      ...navigation.getState(),
      routes: navigation.getState().routes.map((r: any) =>
        r.name === routeName
          ? { name: r.name, key: `${r.name}-${Date.now()}`, state: undefined, params: undefined }
          : r
      ),
    } as any);
  };

  const isDesktop = useIsDesktop();
  const { t, isRTL, language } = useLanguage();
  // On native Android, the system nav bar (3-button or gesture pill) sits
  // right where this floating pill used to be pinned (bottom: 0 + a fixed
  // 20px padding) -- that combo was never a problem on web, where there's
  // no OS chrome to collide with, but on-device the system bar visually
  // overlapped/obscured the tab bar. insets.bottom reports exactly how
  // much the current device's system bar (or iOS home indicator) needs, so
  // add it on top of the existing 20px breathing room instead of the pill
  // sitting flush against -- or under -- the system chrome. Deliberately
  // not attempting to hide the system nav bar itself (immersive mode):
  // that fights the OS, isn't guaranteed to stay hidden across
  // interactions, and removes the user's back/home affordance, which is
  // worse than a slightly taller floating pill.
  const insets = useSafeAreaInsets();
  // Mobile-only auto-hide, shared with HomeScreen's category slider via
  // ScrollChromeContext (this component can't see another screen's scroll
  // events directly -- see that file's own comment for why). Whichever tab
  // is focused changes, always snap back to visible: only HomeScreen wires
  // up onChromeScroll today, so without this reset, leaving Home mid-
  // scroll-down would strand the bar hidden on Chat/Sell/Profile with no
  // way to bring it back.
  const { chromeVisible, chromeAnim, showChrome } = useScrollChrome();
  const focusedIndex = state.index;
  const lastIndexRef = useRef(focusedIndex);
  useEffect(() => {
    if (lastIndexRef.current !== focusedIndex) {
      lastIndexRef.current = focusedIndex;
      showChrome();
    }
  }, [focusedIndex, showChrome]);

  // Sidebar banner (slot 'sidebar_nav'). TabBar isn't a screen -- it's
  // mounted once for the whole session and never remounted by an
  // ordinary tab switch -- so useBannerForSlot's screen-focus signal
  // (useIsFocused) doesn't apply here; see BannerStore.tsx's doc comment.
  // Instead this rerolls on the same two events described in the design
  // spec: once when the data finishes loading (covers first mount/hard
  // refresh), and again whenever the sidebar's own focused tab changes
  // (covers "navigated to another section and came back", since a tab
  // switch is the sidebar's equivalent of a screen blur/focus). Desktop
  // -only: no reason to fetch/reroll a banner a mobile visitor never
  // sees.
  const { reroll: rerollBanner, currentForSlot, loaded: bannersLoaded } = useBanners();
  useEffect(() => {
    // null, not undefined: the sidebar belongs to no section -- it is the
    // app's chrome, standing beside the gate as much as beside a section --
    // so its section is known, and known to be none. Only banners that
    // target no section are eligible here.
    if (bannersLoaded && isDesktop) rerollBanner('sidebar_nav', null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bannersLoaded, isDesktop, focusedIndex]);
  const sidebarBanner = currentForSlot('sidebar_nav', null);

  // How tall the sidebar banner is allowed to get. navScroll (flex:1)
  // already occupies exactly the space between brandRow and the footer --
  // see its own comment below -- so its measured height, minus the nav
  // list's own height and the banner's marginTop/marginBottom (18 + 6, see
  // sidebarBanner style), is precisely how much room is left before the
  // footer. Passed to BannerSlotView as an override on its own maxHeight
  // ceiling (see that component's sizing math) rather than a fixed 320px --
  // it's still just a ceiling, not a fill target: a creative that doesn't
  // need all of it is shown at its own full, uncropped size and leaves
  // whatever's left of the gap empty, rather than being stretched or
  // cropped to fill it. Falls back to SLOT_SIZE's own 320px default until
  // both measurements land (first render, before onLayout fires), so
  // there's no flash of an unbounded or zero-height box.
  const [navScrollH, setNavScrollH] = useState<number | null>(null);
  const [navListH, setNavListH] = useState<number | null>(null);
  const SIDEBAR_BANNER_VMARGIN = 18 + 6;
  const SIDEBAR_BANNER_DEFAULT_CAP = 320;
  const sidebarBannerMaxHeight =
    navScrollH != null && navListH != null
      ? Math.max(0, navScrollH - navListH - SIDEBAR_BANNER_VMARGIN)
      : SIDEBAR_BANNER_DEFAULT_CAP;

  if (isDesktop) {
    return (
      <View style={[styles.sidebar, isRTL ? styles.sidebarRTL : styles.sidebarLTR]}>
        <View style={styles.brandRow}>
          <BrandMark variant="sidebar" onPress={goHome} />
        </View>

        {/* Scrollable so the sidebar_nav banner -- now stretched to fill
            whatever's left below the nav list (see sidebarBannerMaxHeight
            above) -- can never collide with the footer below: the footer
            sits in normal flow after this ScrollView rather than
            absolutely pinned over it, so it's physically impossible for
            one to cover the other, whatever the banner's own aspect ratio
            turns out to be. On a normal-length nav list (the common case)
            this scrolls nowhere and looks identical to a plain View. */}
        <ScrollView
          style={styles.navScroll}
          contentContainerStyle={styles.navScrollContent}
          showsVerticalScrollIndicator={false}
          onLayout={(e) => setNavScrollH(e.nativeEvent.layout.height)}
        >
          <View style={styles.navList} onLayout={(e) => setNavListH(e.nativeEvent.layout.height)}>
            {state.routes.map((route, index) => {
              const focused = state.index === index;
              const isSell = route.name === 'SellTab';
              const onPress = () => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (event.defaultPrevented) return;
                if (focused) {
                  // Tapping the tab you're already on should take you to the
                  // top of it. Home in particular is the "start again"
                  // button -- from inside a category, with filters set and
                  // something typed in the search box, tapping Home did
                  // nothing at all, because navigate() to the tab you're on
                  // is a no-op. Resetting the nested stack with a fresh key
                  // remounts the screen, which clears the search text and
                  // filters along with it; keeping the old key would restore
                  // the very state you were trying to leave.
                  resetTabToTop(route.name);
                  return;
                }
                navigation.navigate(route.name as never);
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

          <BannerSlotView
            banner={sidebarBanner}
            slot="sidebar_nav"
            style={styles.sidebarBanner}
            maxHeight={sidebarBannerMaxHeight}
          />
        </ScrollView>

        {/* The site-wide footer (tagline + legal links + copyright) is
            desktop-web only by design -- on native, About/Privacy/Terms
            live one tap away in the Profile tab's "About Us" section
            instead (see ProfileScreen.tsx), so there's no bare-link UX to
            hand off to a mobile OS browser from a cramped sidebar. */}
        {Platform.OS === 'web' ? (
          <View style={styles.footerBlock}>
            <Text style={[styles.footerTagline, isRTL && styles.textEnd]}>{t('nav.footer')}</Text>
            <View style={styles.footerLinks}>
              <Pressy onPress={() => openLegalPage('about', language)}>
                <Text style={[styles.footerLink, isRTL && styles.textEnd]}>{t('nav.aboutUs')}</Text>
              </Pressy>
              <Pressy onPress={() => openLegalPage('privacy', language)}>
                <Text style={[styles.footerLink, isRTL && styles.textEnd]}>{t('nav.privacyPolicy')}</Text>
              </Pressy>
              <Pressy onPress={() => openLegalPage('terms', language)}>
                <Text style={[styles.footerLink, isRTL && styles.textEnd]}>{t('nav.termsOfUse')}</Text>
              </Pressy>
            </View>
            <Text style={[styles.footerCopy, isRTL && styles.textEnd]}>{t('nav.footerCopyright')}</Text>
          </View>
        ) : (
          <Text style={[styles.footerNote, isRTL && styles.textEnd]}>{t('nav.footer')}</Text>
        )}
      </View>
    );
  }

  // Native: interpolate straight off chromeAnim (Animated.timing,
  // useNativeDriver -- UI-thread only, scoped to this node) instead of
  // relying on a global LayoutAnimation call to smooth the discrete style
  // flip below; see ScrollChromeContext's file comment for why that used
  // to cause scroll lag. Web keeps its existing discrete-style + CSS-
  // transition path (styles.wrap/wrapHidden's transitionProperty) exactly
  // as before -- chromeAnim isn't driven or read there.
  const wrapAnimStyle =
    Platform.OS === 'web'
      ? !chromeVisible && styles.wrapHidden
      : {
          opacity: chromeAnim,
          transform: [{ translateY: chromeAnim.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }) }],
        };

  return (
    <Animated.View
      style={[styles.wrap, { paddingBottom: 20 + insets.bottom }, wrapAnimStyle]}
      pointerEvents={chromeVisible ? 'box-none' : 'none'}
    >
      <View style={styles.pillShadow}>
        {/* This pill floats permanently over an actively-scrolling list, so
            whatever is behind the blur changes on every single frame. On
            iOS that's a cheap native UIVisualEffectView, and on web it's a
            GPU-composited backdrop-filter -- but on Android expo-blur has
            to re-capture and re-blur the content underneath continuously,
            which is a well-known frame-rate killer and (unlike a one-off
            static blur, e.g. Glass on the language-select screen) is paid
            for every frame the user scrolls. Android gets a solid pill
            instead; visually near-identical against this app's near-white
            background, minus the per-frame cost. */}
        {Platform.OS !== 'android' && <BlurView intensity={55} tint="light" style={StyleSheet.absoluteFill} />}
        <View style={[styles.pill, Platform.OS === 'android' && styles.pillAndroid]}>
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const isSell = route.name === 'SellTab';
            const onPress = () => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (event.defaultPrevented) return;
              if (focused) {
                // Tapping the tab you're already on should take you to the
                // top of it. Home in particular is the "start again"
                // button -- from inside a category, with filters set and
                // something typed in the search box, tapping Home did
                // nothing at all, because navigate() to the tab you're on
                // is a no-op. Resetting the nested stack with a fresh key
                // remounts the screen, which clears the search text and
                // filters along with it; keeping the old key would restore
                // the very state you were trying to leave.
                resetTabToTop(route.name);
                return;
              }
              navigation.navigate(route.name as never);
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
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Mobile: floating bottom pill (unchanged from before).
  // Auto-hide transition (see ScrollChromeContext, and wrapAnimStyle in the
  // render above). On web this still animates via these CSS transition
  // props alone, not RN's Animated API -- same reasoning as Pressy.tsx's
  // press-scale motion: react-native-web's Animated fallback has real,
  // previously-hit bugs, so web deliberately never drives chromeAnim.
  // Native now does use Animated (useNativeDriver, UI-thread-only, scoped
  // to just this node) to smooth the same flip -- see wrapAnimStyle -- so
  // opacity/transform below are only this style's resting (fully shown)
  // values on native, overridden per-frame by whichever branch applies.
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
  // Compensates for the missing BlurView on Android (see the render above):
  // without something behind it, the 0.62-alpha pill would let the list
  // scroll through it unblurred, which reads as a bug rather than as glass.
  pillAndroid: { backgroundColor: 'rgba(252,252,251,0.97)' },
  tabItem: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center', gap: 4 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent' },
  dotActive: { backgroundColor: colors.primary },
  sellBtn: {
    width: 50, height: 50, borderRadius: 25, backgroundColor: colors.primary,
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
    // Column is RN's default flexDirection, made explicit here because it's
    // what makes the scrollable-middle/fixed-footer split below work: the
    // brand row and footer take their natural height, and navScroll (flex:
    // 1) fills whatever's left between them and scrolls internally if its
    // content -- the nav items plus the banner -- doesn't fit.
    flexDirection: 'column',
  },
  sidebarLTR: { left: 0, borderRightWidth: 1, borderRightColor: colors.line },
  sidebarRTL: { right: 0, borderLeftWidth: 1, borderLeftColor: colors.line },
  brandRow: { paddingHorizontal: 6, marginBottom: 34 },
  navScroll: { flex: 1 },
  navScrollContent: { flexGrow: 1 },
  navList: { gap: 4 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 44, borderRadius: radius.md, paddingHorizontal: 12 },
  navItemActive: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  navItemSell: { backgroundColor: colors.primary, marginTop: 10, marginBottom: 10 },
  navLabel: { fontSize: 14, fontWeight: '600', color: colors.inkSoft },
  navLabelActive: { color: colors.ink },
  navLabelSell: { color: colors.white },
  // Sits below the nav items, inside the same scroll region -- see the
  // ScrollView in the render above. Its height is the measured
  // sidebarBannerMaxHeight budget (computed above, passed as a prop),
  // not a fixed SLOT_SIZE cap -- this margin is just the breathing room
  // around it; the 18/6 split is baked into that budget's own math.
  sidebarBanner: { marginTop: 18, marginBottom: 6 },
  // No longer absolutely positioned (see sidebar's flexDirection comment
  // above) -- sits in normal flow after navScroll, so it can never be
  // covered by a tall banner however long the nav list + banner get.
  footerNote: { paddingTop: 14, paddingBottom: 20, fontSize: 10.5, color: colors.inkSoft },
  // Web-only site footer that replaces footerNote above (see the Platform
  // check in the render): tagline, then the three legal links, then a
  // copyright line -- stacked to fit the narrow persistent sidebar.
  footerBlock: { paddingTop: 14, paddingBottom: 18, gap: 7 },
  footerTagline: { fontSize: 10.5, color: colors.inkSoft },
  footerLinks: { gap: 5 },
  footerLink: { fontSize: 10.5, fontWeight: '600', color: colors.ink },
  footerCopy: { fontSize: 9, color: colors.inkSoft },
  textEnd: { textAlign: 'right' },
});
