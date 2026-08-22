import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Screen from './Screen';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import { colors, radius, type } from '../theme/theme';

// Extracted verbatim from CreateListingScreen's own upfront "standalone or
// storefront?" gate (shouldAskShopChoice/shopChoiceResolved -- see that
// screen's own doc comment for why a verified storefront owner starting a
// brand-new listing gets this as its own screen rather than a buried
// toggle). Reused as-is by CreateListingScreen itself (so a verified
// owner reaching it directly, e.g. by deep link, sees byte-for-byte the
// same screen it always has) AND by SellHubScreen, which shows it once
// before either "Sell one item" or "Sell a bunch of items" continues, per
// the locked batch-listings decision that this chooser is unchanged, just
// reached from one extra screen in front.
export default function ShopChoiceGate({
  onChoose,
  onBack,
  title,
  storefrontTitle,
  storefrontBody,
  standaloneTitle,
  standaloneBody,
}: {
  onChoose: (attachToShop: boolean) => void;
  onBack: () => void;
  title: string;
  storefrontTitle: string;
  storefrontBody: string;
  standaloneTitle: string;
  standaloneBody: string;
}) {
  return (
    <Screen maxWidth={640}>
      <View style={localStyles.topBar}>
        <Pressy onPress={onBack} style={localStyles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>{title}</Text>
        <View style={localStyles.iconBtn} />
      </View>
      <View style={localStyles.shopChooserWrap}>
        <Pressy onPress={() => onChoose(true)} style={localStyles.shopChooserCard}>
          <View style={localStyles.shopChooserIcon}>
            <Icon name="building" size={22} color={colors.primary} />
          </View>
          <Text style={localStyles.shopChooserCardTitle}>{storefrontTitle}</Text>
          <Text style={localStyles.shopChooserCardBody}>{storefrontBody}</Text>
        </Pressy>
        <Pressy onPress={() => onChoose(false)} style={localStyles.shopChooserCard}>
          <View style={localStyles.shopChooserIcon}>
            <Icon name="bag" size={22} color={colors.primary} />
          </View>
          <Text style={localStyles.shopChooserCardTitle}>{standaloneTitle}</Text>
          <Text style={localStyles.shopChooserCardBody}>{standaloneBody}</Text>
        </Pressy>
      </View>
    </Screen>
  );
}

const localStyles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  shopChooserWrap: { paddingHorizontal: 18, paddingTop: 20, gap: 14 },
  shopChooserCard: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.lg, padding: 20,
  },
  shopChooserIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryTint,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  shopChooserCardTitle: { fontSize: 16.5, fontWeight: '700', color: colors.ink, marginBottom: 5 },
  shopChooserCardBody: { fontSize: 13, color: colors.inkSoft, lineHeight: 18 },
});
