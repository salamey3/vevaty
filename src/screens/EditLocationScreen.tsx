import React, { useState } from 'react';
import { StyleSheet, Text, View, KeyboardAvoidingView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import Button from '../components/Button';
import PlaceSuggestInput from '../components/PlaceSuggestInput';
import { colors, type } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { RootStackParamList } from '../navigation/types';
import { useLanguage } from '../i18n/LanguageContext';

type Props = NativeStackScreenProps<RootStackParamList, 'EditLocation'>;

// Reached from ProfileScreen's "Edit your profile" menu. profile.district
// is a plain display string (unlike a listing's richer place fields), so
// this just needs the typed/selected town name -- same PlaceSuggestInput
// used for a listing's own location, non-blocking the same way: whatever
// is typed is saved verbatim even if it never matches a dropdown row.
export default function EditLocationScreen({ navigation }: Props) {
  const { t } = useLanguage();
  const { profile, updateProfileDistrict } = useAppStore();
  const [district, setDistrict] = useState(profile.district || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const trimmed = district.trim();
    if (!trimmed) {
      setError(t('editLocation.locationRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateProfileDistrict(trimmed);
      navigation.goBack();
    } catch {
      setError(t('editLocation.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen maxWidth={480}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <Icon name="back" size={18} />
          </Pressy>
          <Text style={type.h3}>{t('editLocation.title')}</Text>
          <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <Icon name="close" size={18} />
          </Pressy>
        </View>

        <View style={styles.body}>
          <Text style={styles.subtitle}>{t('editLocation.subtitle')}</Text>
          <Text style={styles.fieldLabel}>{t('editLocation.locationLabel')}</Text>
          <PlaceSuggestInput
            value={district}
            onChangeText={setDistrict}
            onSelectPlace={(place) => setDistrict(place.name)}
            placeholder={t('editLocation.locationPlaceholder')}
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Button label={t('common.save')} onPress={save} loading={saving} style={{ marginTop: 18 }} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 22, paddingTop: 12 },
  subtitle: { ...type.soft, marginBottom: 18 },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  error: { color: colors.danger, fontSize: 12.5, marginTop: 10 },
});
