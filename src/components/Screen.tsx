import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import Texture from './Texture';
import { useIsDesktop, SIDEBAR_WIDTH } from '../hooks/useResponsive';
import { useLanguage } from '../i18n/LanguageContext';

export default function Screen({
  children,
  // 'bottom' is included on purpose. Android's system nav bar (3-button or
  // gesture pill) sits over the bottom of the window, and this used to
  // default to top/left/right only -- so nothing reserved space for it, and
  // any screen with something anchored to the bottom had to remember to add
  // insets.bottom by hand. ListingDetailScreen and CreateListingScreen did;
  // ChatThreadScreen didn't, which is why its message input and Send button
  // ended up underneath the nav bar. Reserving the inset here once means no
  // screen can forget it again.
  //
  // Safe to apply globally: Texture paints colors.bg full-bleed *behind*
  // this SafeAreaView, so the reserved strip is the same colour as the bars
  // that sit against it rather than showing through as a seam. The floating
  // tab bar is the one thing not covered by this -- it's rendered by the tab
  // navigator outside any Screen, and keeps its own insets.bottom handling.
  edges = ['top', 'left', 'right', 'bottom'],
  maxWidth,
  reserveSidebar = false,
}: {
  children: React.ReactNode;
  edges?: Edge[];
  // On desktop, cap and center content at this width instead of letting it
  // stretch edge-to-edge across a wide browser window. Ignored on mobile.
  maxWidth?: number;
  // Set on the four main-tab screens (Home/Categories/Chat/Profile) so
  // their content reserves space for the persistent desktop sidebar that
  // TabBar renders on top of them. Ignored on mobile, where there's no
  // sidebar (the bottom pill floats over content instead).
  reserveSidebar?: boolean;
}) {
  const isDesktop = useIsDesktop();
  const { isRTL } = useLanguage();
  const content =
    isDesktop && maxWidth ? (
      <View style={[styles.fill, styles.centerWrap, { maxWidth }]}>{children}</View>
    ) : (
      children
    );

  // The persistent desktop sidebar (TabBar) sits on the left in LTR and
  // flips to the right in RTL -- reserve space on whichever side it's
  // actually on, or content renders underneath it in Arabic.
  const sidebarReserveStyle =
    isDesktop && reserveSidebar
      ? isRTL
        ? { paddingRight: SIDEBAR_WIDTH }
        : { paddingLeft: SIDEBAR_WIDTH }
      : null;

  return (
    <View style={styles.fill}>
      <Texture />
      <SafeAreaView style={styles.fill} edges={edges}>
        <View style={[styles.fill, sidebarReserveStyle]}>{content}</View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centerWrap: { width: '100%', alignSelf: 'center' },
});
