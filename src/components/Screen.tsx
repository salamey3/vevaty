import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import Texture from './Texture';
import { useIsDesktop, SIDEBAR_WIDTH } from '../hooks/useResponsive';
import { useLanguage } from '../i18n/LanguageContext';

export default function Screen({
  children,
  edges = ['top', 'left', 'right'],
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
