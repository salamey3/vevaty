import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Alert } from '../lib/alertShim';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import ShopChoiceGate from '../components/ShopChoiceGate';
import DomainChoiceGate from '../components/DomainChoiceGate';
import { colors, radius, type } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { useSettings } from '../store/SettingsStore';
import { useLanguage } from '../i18n/LanguageContext';
import { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SellHub'>;

// "Sell on Vevaty" hub -- the new front door for posting, replacing the old
// direct "Sell" tab -> CreateListingScreen jump (see MainTabs.tsx). A
// regular seller picking either card goes straight into photo capture,
// same as before for the single-item path; a verified storefront owner
// sees the SAME standalone-vs-shop chooser CreateListingScreen has always
// shown (ShopChoiceGate, extracted so both places render it identically),
// just once, here, before either path continues -- see the batch-listings
// plan's locked decision on this ("Option A").
export default function SellHubScreen({ navigation, route }: Props) {
  const { myShop, createBatch } = useAppStore();
  const { domains } = useSettings();
  const { t } = useLanguage();
  const [pendingKind, setPendingKind] = useState<'single' | 'batch' | null>(null);
  // Set once the shop question (if any) is settled and we are waiting on
  // the domain pick. Holds the shop answer so it survives that step.
  const [pendingDomain, setPendingDomain] = useState<{ kind: 'single' | 'batch'; attachToShop?: boolean } | null>(null);
  const [startingBatch, setStartingBatch] = useState(false);

  const startSingle = (domainId: string, attachToShop?: boolean) => {
    navigation.navigate('CreateListing', {
      domain: domainId,
      ...(attachToShop === undefined ? {} : { shopChoice: { attachToShop } }),
    });
  };

  const startBatch = async (domainId: string, attachToShop?: boolean) => {
    setStartingBatch(true);
    try {
      // Held on the batch row, not passed between screens -- the batch
      // flow spans six of them and can be resumed later.
      const batch = await createBatch(domainId);
      navigation.navigate('BatchPhotos', {
        batchId: batch.id,
        domain: domainId,
        shopChoice: attachToShop === undefined ? undefined : { attachToShop },
      });
    } catch (e: any) {
      Alert.alert(t('sellHub.startBatchErrorTitle'), e?.message || t('sellHub.startBatchErrorBody'));
    } finally {
      setStartingBatch(false);
    }
  };

  // A storefront that has said what it sells has already answered the gate,
  // so it is not asked again -- the merchant listing their fortieth
  // apartment should not confirm that it is a property every time. The
  // answer is still visible and still changeable inside the wizard
  // ("Posting in Properties -- Change"), which is what keeps this a skip
  // rather than a lock.
  //
  // Only a domain the gate would itself render counts: an admin who
  // deactivates a domain, or every category inside it, must not leave a
  // shop posting into something that no longer exists. Standalone listings
  // are never skipped -- the shop's setting speaks for the shop.
  const shopDomainId =
    !route.params?.chooseDomain && myShop?.domainId && domains.some((d) => d.id === myShop.domainId)
      ? myShop.domainId
      : null;

  const afterShopChoice = (kind: 'single' | 'batch', attachToShop: boolean) => {
    setPendingKind(null);
    if (attachToShop && shopDomainId) {
      if (kind === 'single') startSingle(shopDomainId, true);
      else void startBatch(shopDomainId, true);
      return;
    }
    setPendingDomain({ kind, attachToShop });
  };

  // The domain step comes last, after the kind and (for a storefront
  // owner) the shop question, so the seller answers the cheap questions
  // before the one that constrains everything downstream.
  if (pendingDomain) {
    return (
      <DomainChoiceGate
        domains={domains}
        onBack={() => setPendingDomain(null)}
        onChoose={(domainId) =>
          pendingDomain.kind === 'single'
            ? startSingle(domainId, pendingDomain.attachToShop)
            : startBatch(domainId, pendingDomain.attachToShop)
        }
        title={t('sellHub.domainTitle')}
        subtitle={t('sellHub.domainSubtitle')}
      />
    );
  }

  if (myShop?.verifiedAt && pendingKind) {
    return (
      <ShopChoiceGate
        onBack={() => setPendingKind(null)}
        onChoose={(attach) => afterShopChoice(pendingKind, attach)}
        title={t('createListing.shopChooserTitle')}
        storefrontTitle={t('createListing.shopChooserStorefrontTitle')}
        storefrontBody={t('createListing.shopChooserStorefrontBody', { name: myShop.nameEn })}
        standaloneTitle={t('createListing.shopChooserStandaloneTitle')}
        standaloneBody={t('createListing.shopChooserStandaloneBody')}
      />
    );
  }

  const onPickSingle = () =>
    myShop?.verifiedAt ? setPendingKind('single') : setPendingDomain({ kind: 'single' });
  const onPickBatch = () =>
    myShop?.verifiedAt ? setPendingKind('batch') : setPendingDomain({ kind: 'batch' });

  return (
    <Screen maxWidth={640}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>{t('sellHub.title')}</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.intro}>
        <Text style={styles.headline}>{t('sellHub.headline')}</Text>
        <Text style={styles.subtitle}>{t('sellHub.subtitle')}</Text>
      </View>

      <View style={styles.cardsWrap}>
        <Pressy onPress={onPickSingle} style={styles.card} disabled={startingBatch}>
          <View style={styles.cardIcon}>
            <Icon name="image" size={22} color={colors.primary} />
          </View>
          <Text style={styles.cardTitle}>{t('sellHub.singleItemTitle')}</Text>
          <Text style={styles.cardBody}>{t('sellHub.singleItemBody')}</Text>
        </Pressy>
        <Pressy onPress={onPickBatch} style={styles.card} disabled={startingBatch}>
          <View style={styles.cardIcon}>
            <Icon name="grip" size={22} color={colors.primary} />
          </View>
          <Text style={styles.cardTitle}>{t('sellHub.batchItemTitle')}</Text>
          <Text style={styles.cardBody}>{t('sellHub.batchItemBody')}</Text>
        </Pressy>
      </View>

      {!!myShop?.verifiedAt && (
        <View style={styles.shopNote}>
          <Text style={styles.shopNoteText}>{t('sellHub.shopOwnerNote')}</Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  intro: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 4 },
  headline: { ...type.title, marginBottom: 6 },
  subtitle: { ...type.soft, lineHeight: 19 },
  cardsWrap: { paddingHorizontal: 18, paddingTop: 16, gap: 14 },
  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.lg, padding: 20,
  },
  cardIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryTint,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  cardTitle: { fontSize: 16.5, fontWeight: '700', color: colors.ink, marginBottom: 5 },
  cardBody: { fontSize: 13, color: colors.inkSoft, lineHeight: 18 },
  shopNote: { marginHorizontal: 18, marginTop: 18, padding: 14, borderRadius: radius.md, backgroundColor: colors.surface },
  shopNoteText: { fontSize: 12.5, color: colors.inkSoft, lineHeight: 17 },
});
