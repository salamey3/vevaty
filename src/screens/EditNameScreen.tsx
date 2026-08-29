import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, KeyboardAvoidingView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import Button from '../components/Button';
import { colors, type, radius } from '../theme/theme';
import { useAppStore } from '../store/AppStore';
import { RootStackParamList } from '../navigation/types';
import { useLanguage } from '../i18n/LanguageContext';

type Props = NativeStackScreenProps<RootStackParamList, 'EditName'>;

// Reached from ProfileScreen's "Edit your profile" menu (only shown to
// verified users, same as ChangePhoneScreen). Same immediate-local-state,
// awaited-DB-write shape as the avatar picker -- updateProfileName already
// handles both.
export default function EditNameScreen({ navigation }: Props) {
  const { t } = useLanguage();
  const { profile, updateProfileName } = useAppStore();
  const [name, setName] = useState(profile.name && profile.name !== 'You' ? profile.name : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('editName.nameRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateProfileName(trimmed);
      navigation.goBack();
    } catch {
      setError(t('editName.saveFailed'));
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
          <Text style={type.h3}>{t('editName.title')}</Text>
          <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <Icon name="close" size={18} />
          </Pressy>
        </View>

        <View style={styles.body}>
          <Text style={styles.subtitle}>{t('editName.subtitle')}</Text>
          <Text style={styles.fieldLabel}>{t('editName.nameLabel')}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t('editName.namePlaceholder')}
            placeholderTextColor={colors.inkSoft}
            autoCapitalize="words"
            style={styles.input}
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
  input: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.ink,
  },
  error: { color: colors.danger, fontSize: 12.5, marginTop: 10 },
});
