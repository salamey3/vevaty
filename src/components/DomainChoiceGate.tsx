import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Screen from './Screen';
import Pressy from './Pressy';
import Icon from '../icons/Icon';
import DomainTiles from './DomainTiles';
import { type } from '../theme/theme';
import { ListingDomain } from '../types';

// The sell gate: what kind of thing is this? Asked once, before any photo
// is taken, because it is the one question the photos genuinely cannot
// answer -- an apartment interior really does contain furniture, so a
// classifier choosing between "Apartment" and "Decor Concept" on the same
// pictures is guessing, not failing. See DOMAINS.md.
//
// The tiles themselves live in DomainTiles, shared with the buyer's gate:
// this screen is only the seller's framing around them -- a title, a
// subtitle, a way back.
export default function DomainChoiceGate({
  domains,
  onChoose,
  onBack,
  title,
  subtitle,
}: {
  domains: ListingDomain[];
  onChoose: (domainId: string) => void;
  onBack: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <Screen maxWidth={640}>
      <View style={styles.topBar}>
        <Pressy onPress={onBack} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>{title}</Text>
        <View style={styles.iconBtn} />
      </View>

      <Text style={styles.subtitle}>{subtitle}</Text>

      <DomainTiles domains={domains} onChoose={onChoose} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  subtitle: { ...type.soft, paddingHorizontal: 18, marginBottom: 18 },
});
