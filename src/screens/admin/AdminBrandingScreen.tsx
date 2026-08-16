import React, { useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from '../../lib/alertShim';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../../components/Screen';
import Pressy from '../../components/Pressy';
import Icon from '../../icons/Icon';
import Button from '../../components/Button';
import { colors, type, radius } from '../../theme/theme';
import { useSettings } from '../../store/SettingsStore';
import { uploadPhoto } from '../../lib/photoUpload';
import { RootStackParamList } from '../../navigation/types';

const HEX_RE = /^#([0-9a-f]{3}){1,2}$/i;

function ImagePickerField({
  label,
  hint,
  url,
  onPicked,
  onRemove,
}: {
  label: string;
  hint?: string;
  url: string | null;
  onPicked: (url: string) => void;
  onRemove: () => void;
}) {
  const [uploading, setUploading] = useState(false);

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    setUploading(true);
    try {
      const hosted = await uploadPhoto(result.assets[0].uri);
      onPicked(hosted);
    } catch (e) {
      Alert.alert('Upload failed', 'Could not upload that image. Try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
      <View style={styles.imgRow}>
        <View style={styles.imgPreview}>
          {uploading ? <ActivityIndicator color={colors.ink} /> : url ? <Image source={{ uri: url }} style={styles.imgPreviewImg} resizeMode="contain" /> : <Icon name="camera" size={20} color={colors.inkSoft} />}
        </View>
        <Pressy onPress={pick} style={styles.uploadBtn}>
          <Text style={styles.uploadBtnText}>{url ? 'Replace' : 'Upload'}</Text>
        </Pressy>
        {!!url && (
          <Pressy onPress={onRemove} style={styles.removeBtn}>
            <Text style={styles.removeBtnText}>Remove</Text>
          </Pressy>
        )}
      </View>
    </View>
  );
}

export default function AdminBrandingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { siteSettings, updateSiteSettings } = useSettings();

  const [primary, setPrimary] = useState(siteSettings.brandPrimaryColor);
  const [accent, setAccent] = useState(siteSettings.brandAccentColor);
  const [logoEnUrl, setLogoEnUrl] = useState(siteSettings.logoEnUrl);
  const [logoArUrl, setLogoArUrl] = useState(siteSettings.logoArUrl);
  const [faviconUrl, setFaviconUrl] = useState(siteSettings.faviconUrl);
  const [saving, setSaving] = useState(false);

  const primaryValid = HEX_RE.test(primary);
  const accentValid = HEX_RE.test(accent);

  const save = async () => {
    if (!primaryValid || !accentValid) {
      Alert.alert('Invalid color', 'Colors must be a hex code like #2b2b2f.');
      return;
    }
    setSaving(true);
    try {
      await updateSiteSettings({
        brandPrimaryColor: primary,
        brandAccentColor: accent,
        logoEnUrl,
        logoArUrl,
        faviconUrl,
      });
      Alert.alert('Saved', 'Branding is now live for everyone.');
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen maxWidth={520}>
      <View style={styles.topBar}>
        <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="back" size={18} />
        </Pressy>
        <Text style={type.h3}>Branding</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionTitle}>Colors</Text>
        <Text style={styles.hint}>Changes go live for every visitor as soon as you save -- no app update needed.</Text>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Primary color</Text>
          <View style={styles.colorRow}>
            <View style={[styles.swatch, { backgroundColor: primaryValid ? primary : colors.line }]} />
            <TextInput value={primary} onChangeText={setPrimary} autoCapitalize="none" style={[styles.input, { flex: 1 }]} placeholder="#2b2b2f" />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Accent color (hero gradient)</Text>
          <View style={styles.colorRow}>
            <View style={[styles.swatch, { backgroundColor: accentValid ? accent : colors.line }]} />
            <TextInput value={accent} onChangeText={setAccent} autoCapitalize="none" style={[styles.input, { flex: 1 }]} placeholder="#4c4d52" />
          </View>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Logo</Text>
        <Text style={styles.hint}>Shown in the desktop sidebar and on the welcome screens. Leave blank to keep the default Vevaty wordmark.</Text>

        <ImagePickerField label="English logo" url={logoEnUrl} onPicked={setLogoEnUrl} onRemove={() => setLogoEnUrl(null)} />
        <ImagePickerField label="Arabic logo" url={logoArUrl} onPicked={setLogoArUrl} onRemove={() => setLogoArUrl(null)} />

        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Favicon</Text>
        <ImagePickerField
          label="Browser tab icon"
          hint="A small square image works best."
          url={faviconUrl}
          onPicked={setFaviconUrl}
          onRemove={() => setFaviconUrl(null)}
        />

        <Button label="Save branding" onPress={save} loading={saving} style={{ marginTop: 28 }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 60 },
  sectionTitle: { ...type.h3 },
  hint: { ...type.soft, marginTop: 4, marginBottom: 14, lineHeight: 17 },
  field: { marginBottom: 18 },
  fieldLabel: { ...type.tiny, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm, paddingHorizontal: 14, height: 46, fontSize: 14.5, color: colors.ink,
  },
  colorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.line },
  imgRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  imgPreview: {
    width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: colors.line,
  },
  imgPreviewImg: { width: '100%', height: '100%' },
  uploadBtn: {
    height: 38, paddingHorizontal: 14, borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  uploadBtnText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  removeBtn: { height: 38, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  removeBtnText: { fontSize: 13, fontWeight: '600', color: colors.danger },
});
