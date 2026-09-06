import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Pressy from '../components/Pressy';
import Icon from '../icons/Icon';
import { Alert } from '../lib/alertShim';
import { colors, radius, type } from '../theme/theme';
import { mirrorRow } from '../lib/mirrorRow';
import { useLanguage } from '../i18n/LanguageContext';
import { useAppStore } from '../store/AppStore';
import { useIsDesktop, DESKTOP_CONTENT_MAX_WIDTH } from '../hooks/useResponsive';
import { uploadPhotosWithThumbnails } from '../lib/photoUpload';
import { getGovernorateNames } from '../data/lebanonPlaces';
import TermsTick, { TermsState } from '../components/TermsTick';
import { RootStackParamList } from '../navigation/types';
import {
  EMPTY_DRAFT, MAX_SUBMISSION_PHOTOS, MIN_SUBMISSION_PHOTOS, SUBMISSION_CONDITIONS,
  SubmissionCondition, SubmissionDraft, SubmissionError, SubmissionKind,
  fetchMySubmissions, fetchSubmissionKinds, submitAuctionItem, updateAuctionSubmission,
} from '../lib/auctionSubmissions';

// Offering an item for a sale.
//
// This form is a FIRST SCREENING, and every field on it earns its place by
// changing a yes into a no or the other way round. It is deliberately not
// the create-listing form with different labels: a marketplace listing is
// published by the person who writes it, so its form collects what a buyer
// needs; this one is read by one person deciding whether to take the
// object at all, so it collects what a specialist would ask on the phone.
//
// The order is the order that call goes in -- what is it, what makes it
// that, what state is it in, what comes with it, is it yours, what do you
// think it is worth, where is it. Money last on purpose: a consignor who
// is asked their price first anchors on it and describes the object to
// justify the number.
//
// It is also an EDIT form. A submission we sent back with a question is
// answered here, and saving it puts it back in the queue -- which is why
// there is no separate "reply" screen and no message thread. The answer to
// "can you photograph the date stamp" is a photograph, and it belongs on
// the submission rather than beside it.

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'AuctionSubmissionForm'>;

const MAX_TITLE = 140;
const MAX_DESCRIPTION = 4000;

export default function AuctionSubmissionFormScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const editingId = route.params?.submissionId ?? null;
  const { t, language, isRTL } = useLanguage();
  const { isVerified, authChecked } = useAppStore();
  const isDesktop = useIsDesktop();

  const [draft, setDraft] = useState<SubmissionDraft>(EMPTY_DRAFT);
  const [kinds, setKinds] = useState<SubmissionKind[] | null>(null);
  // The question we asked, on the row being answered. Shown at the top of
  // the form: the modal covers the card it was written on, and dismissing
  // it to re-read the question throws away everything typed so far.
  const [askedNote, setAskedNote] = useState<string | null>(null);
  // Four states, not a boolean and a string. 'blocked' is the one the old
  // shape could not hold: the record did not load, so the form must not
  // render at all -- it used to render EMPTY and editable, and saving it
  // sent a blank payload that overwrote a perfectly good submission,
  // photographs included.
  const [phase, setPhase] = useState<'loading' | 'ready' | 'blocked'>('loading');
  const [blocked, setBlocked] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether the consignor has agreed to the conditions of consignment.
  // Owned by TermsTick and mirrored here only to gate the button -- the
  // real gate is server-side in submit_auction_item, because a checkbox in
  // an app is a courtesy to the reader and not a control.
  const [terms, setTerms] = useState<TermsState>('pending');
  const onTermsChange = useCallback((v: TermsState) => setTerms(v), []);
  // Bumped when the SERVER refuses for terms after the row said they were
  // accepted -- a new version was published while this form sat open. It
  // forces the row to reload so the tick comes back, instead of leaving a
  // ticked, disabled row under an error telling them to tick it.
  const [termsRefresh, setTermsRefresh] = useState(0);

  const set = <K extends keyof SubmissionDraft>(key: K, value: SubmissionDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // `t` is deliberately NOT a dependency. It is stable per language, so
  // listing it would re-run this whole effect on a language switch and
  // setDraft over everything typed. The messages it produces are held as
  // codes and translated at render instead.
  useEffect(() => {
    let alive = true;
    setPhase('loading');
    setBlocked(null);
    (async () => {
     try {
      const list = await fetchSubmissionKinds();
      if (!alive) return;
      setKinds(list);

      // The kind list failing is fatal to a NEW submission: nothing can be
      // chosen, so the form can never be completed. It used to render a
      // line telling the reader to pull down to refresh, on a screen with
      // no refresh control -- advice that could not be followed on a form
      // that could not be sent.
      if (!editingId && (list === null || list.length === 0)) {
        setBlocked('kinds');
        setPhase('blocked');
        return;
      }

      if (!editingId) {
        setDraft(EMPTY_DRAFT);
        setPhase('ready');
        return;
      }

      // An edit loads the row it is editing from the server rather than
      // taking it from the list screen. The list may be minutes old, and
      // the one thing worse than a stale form is one that silently
      // overwrites a newer answer with it.
      const mine = await fetchMySubmissions();
      if (!alive) return;
      // null is a FAILED read, not an empty one -- fetchMySubmissions
      // returns null for exactly this reason. Collapsing the two told a
      // consignor on a patchy connection that their submission no longer
      // existed, and left them a live blank form pointed at it.
      if (mine === null) { setBlocked('load'); setPhase('blocked'); return; }
      const found = mine.find((s) => s.id === editingId);
      if (!found) { setBlocked('gone'); setPhase('blocked'); return; }
      if (!found.editable) { setBlocked('decided'); setPhase('blocked'); return; }

      const { id, status, kindLabelEn, kindLabelAr, adminNote, decidedAt,
              createdAt, submittedAt, editable, ...rest } = found;
      setDraft(rest);
      setAskedNote(adminNote);
      setPhase('ready');
     } catch {
      // The state machine's whole premise is that it cannot get stuck, and
      // without this it could: the fetch helpers handle a RETURNED error,
      // but a thrown one -- a malformed row, a shape that is not the array
      // the mapper expects -- left an unhandled rejection and a permanent
      // spinner with no message and no way back but killing the app.
      if (alive) { setBlocked('load'); setPhase('blocked'); }
     }
    })();
    return () => { alive = false; };
  }, [editingId, reload]);

  const label = useCallback(
    (k: SubmissionKind) => (language === 'ar' ? k.labelAr : k.labelEn),
    [language]
  );

  const addPhotos = async () => {
    const room = MAX_SUBMISSION_PHOTOS - draft.photos.length;
    if (room <= 0) return;
    let result: ImagePicker.ImagePickerResult;
    try {
      // Inside the try with the picker: a rejection from the permission
      // request was an unhandled one.
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t('consign.photoPermTitle'), t('consign.photoPermBody'));
        return;
      }
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        // Native-only; the web picker ignores it, which is why the slice
        // below is not optional.
        selectionLimit: room,
        quality: 1,
      });
    } catch {
      // The web picker REJECTS on a file it cannot read rather than
      // returning cancelled.
      Alert.alert(t('consign.photoFailTitle'), t('consign.photoFailBody'));
      return;
    }
    if (result.canceled) return;
    const uris = result.assets.map((a) => a.uri).slice(0, room);
    if (uris.length === 0) return;

    setUploading(true);
    // Cleared on entry: a partial failure that is then retried
    // successfully used to go on reporting the old count for good.
    setError(null);
    try {
      // `silent`, because the helper's own dialog is written for the
      // posting flow and is English-only: it says the LISTING was saved
      // without them and to open it and tap Edit. Neither is true here --
      // nothing has been saved, there is no listing, and the consignor may
      // be reading in Arabic. The recovery on this screen is to tap Add
      // again, so that is what it says.
      const up = await uploadPhotosWithThumbnails(uris, { silent: true });
      // Appended, not replaced: uploadPhotosWithThumbnails COMPACTS on
      // failure, so a partial batch still adds what survived.
      setDraft((d) => ({
        ...d,
        photos: [...d.photos, ...up.map((u) => ({ url: u.url, thumbnailUrl: u.thumbnailUrl }))]
          .slice(0, MAX_SUBMISSION_PHOTOS),
      }));
      if (up.length < uris.length) {
        setError(t('consign.photoSomeFailed', {
          n: String(uris.length - up.length), total: String(uris.length),
        }));
      }
    } catch {
      // The helper compacts rather than throwing today, so this is a
      // backstop -- but setDraft runs inside the try, and an unhandled
      // rejection here would leave the spinner up with no explanation.
      setError(t('consign.photoFailBody'));
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (url: string) =>
    setDraft((d) => ({ ...d, photos: d.photos.filter((p) => p.url !== url) }));

  // What is still missing, in the order the form asks for it, so the
  // message names the FIRST thing to fix rather than all of them at once.
  const missing = useMemo((): string | null => {
    if (!draft.kind) return t('consign.needKind');
    if (draft.title.trim().length < 3) return t('consign.needTitle');
    if (draft.description.trim().length < 10) return t('consign.needDescription');
    if (!draft.condition) return t('consign.needCondition');
    if (!draft.ownsOutright) return t('consign.needOwnership');
    if (draft.photos.length < MIN_SUBMISSION_PHOTOS) {
      return t('consign.needPhotos', { n: String(MIN_SUBMISSION_PHOTOS) });
    }
    const low = Number(draft.estimateLow);
    const high = Number(draft.estimateHigh);
    if (draft.estimateLow && draft.estimateHigh && high < low) return t('consign.needEstimateOrder');
    // Last, because it sits last on the form: naming it before the fields
    // above it would send someone scrolling past what they still have to
    // fill in.
    if (!editingId && terms === 'unavailable') return t('legal.blocked');
    if (!editingId && terms !== 'accepted') return t('legal.needAgree');
    return null;
  }, [draft, t, terms, editingId]);

  const save = async () => {
    if (missing) { setError(missing); return; }
    setSaving(true);
    setError(null);
    try {
      if (editingId) await updateAuctionSubmission(editingId, draft);
      else await submitAuctionItem(draft);
      setSaving(false);
      // Straight back to the list, which is where the new row and its
      // status now are. An "it worked" screen with a Done button is one
      // more tap to see the same thing.
      navigation.goBack();
      Alert.alert(
        editingId ? t('consign.savedTitle') : t('consign.sentTitle'),
        editingId ? t('consign.savedBody') : t('consign.sentBody')
      );
    } catch (e) {
      setSaving(false);
      const code = (e as SubmissionError)?.code;
      if (code === 'terms_not_accepted') setTermsRefresh((n) => n + 1);
      setError(
        code === 'not_verified' ? t('consign.errNotVerified')
          : code === 'not_signed_in' ? t('consign.errNotSignedIn')
          : code === 'too_many_open' ? t('consign.errTooManyOpen')
          : code === 'not_editable' ? t('consign.errNotEditable')
          : code === 'not_found' ? t('consign.errNotFound')
          : code === 'estimate_ordering' ? t('consign.needEstimateOrder')
          : code === 'amount_invalid' ? t('consign.errAmount')
          : code === 'photos_required' ? t('consign.needPhotos', { n: String(MIN_SUBMISSION_PHOTOS) })
          : code === 'too_many_photos' ? t('consign.errTooManyPhotos', { n: String(MAX_SUBMISSION_PHOTOS) })
          : code === 'title_required' ? t('consign.needTitle')
          : code === 'description_required' ? t('consign.needDescription')
          : code === 'invalid_kind' ? t('consign.needKind')
          : code === 'condition_invalid' ? t('consign.needCondition')
          : code === 'terms_not_accepted' ? t('legal.superseded')
          : t('consign.errGeneric')
      );
    }
  };

  const rtlText = isRTL ? styles.rtl : null;

  const field = (
    key: keyof SubmissionDraft,
    labelKey: string,
    opts: { hint?: string; multiline?: boolean; numeric?: boolean; max?: number } = {}
  ) => (
    <View style={styles.field}>
      <Text style={[styles.label, rtlText]}>{t(labelKey)}</Text>
      {opts.hint ? <Text style={[styles.hint, rtlText]}>{opts.hint}</Text> : null}
      <TextInput
        value={String(draft[key] ?? '')}
        onChangeText={(v) => set(key, (opts.max ? v.slice(0, opts.max) : v) as any)}
        editable={!saving}
        multiline={opts.multiline}
        keyboardType={opts.numeric ? 'decimal-pad' : 'default'}
        placeholderTextColor={colors.inkSoft}
        style={[styles.input, opts.multiline && styles.inputTall, rtlText]}
      />
    </View>
  );

  const check = (key: 'hasBox' | 'hasPapers' | 'hasAuthentication' | 'ownsOutright', labelKey: string) => (
    <Pressy
      onPress={() => set(key, !draft[key])}
      disabled={saving}
      style={[styles.check, mirrorRow(isRTL)]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: draft[key] }}
    >
      <View style={[styles.box, draft[key] && styles.boxOn]}>
        {draft[key] ? <Icon name="check" size={13} color={colors.white} /> : null}
      </View>
      <Text style={[styles.checkText, rtlText]}>{t(labelKey)}</Text>
    </Pressy>
  );

  const bar = (title: string) => (
    <View style={[styles.topBar, mirrorRow(isRTL)]}>
      <Pressy onPress={() => navigation.goBack()} style={styles.iconBtn} disabled={saving}>
        <Icon name="close" size={18} />
      </Pressy>
      <Text style={type.h3} numberOfLines={1}>{title}</Text>
      <View style={styles.iconBtn} />
    </View>
  );

  if (!authChecked || phase === 'loading') {
    return (
      <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />
      </Screen>
    );
  }

  // BEFORE the blocked screen, not after. A load that failed because
  // there is no session is an auth problem, and reporting it as "could not
  // load the categories" sends the reader to a Retry button that will keep
  // failing for the one reason the screen never mentions.
  if (!isVerified) {
    return (
      <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
        {bar(t('consign.formTitle'))}
        <View style={styles.gate}>
          <Icon name="lock" size={28} color={colors.inkSoft} />
          <Text style={[type.body, { marginTop: 12, textAlign: 'center' }]}>
            {t('consign.errNotVerified')}
          </Text>
          <Pressy onPress={() => navigation.navigate('Auth')} style={styles.gateBtn}>
            <Text style={styles.gateBtnText}>{t('consign.signIn')}</Text>
          </Pressy>
        </View>
      </Screen>
    );
  }

  // The record did not load, or is no longer ours to change. The form is
  // NOT rendered underneath this: a live blank form pointed at a real
  // submission is how a working record gets overwritten with nothing.
  if (phase === 'blocked') {
    const retryable = blocked === 'load' || blocked === 'kinds';
    return (
      <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
        {bar(editingId ? t('consign.editTitle') : t('consign.formTitle'))}
        <View style={styles.gate}>
          <Icon name={retryable ? 'rotate' : 'lock'} size={26} color={colors.inkSoft} />
          <Text style={[type.body, { marginTop: 12, textAlign: 'center', lineHeight: 20 }]}>
            {blocked === 'load' ? t('consign.loadFailed')
              : blocked === 'kinds' ? t('consign.kindsFailed')
              : blocked === 'decided' ? t('consign.errNotEditable')
              : t('consign.errNotFound')}
          </Text>
          {retryable ? (
            <Pressy onPress={() => setReload((n) => n + 1)} style={styles.gateBtn}>
              <Text style={styles.gateBtnText}>{t('common.retry')}</Text>
            </Pressy>
          ) : null}
        </View>
      </Screen>
    );
  }

  return (
    <Screen maxWidth={DESKTOP_CONTENT_MAX_WIDTH}>
      {bar(editingId ? t('consign.editTitle') : t('consign.formTitle'))}

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.body, isDesktop && styles.bodyDesktop]}
          keyboardShouldPersistTaps="handled"
        >
          {/* What we asked, on the form that answers it. The modal covers
              the card this was written on, and going back to re-read it
              throws away everything typed and every photo uploaded. */}
          {askedNote ? (
            <View style={styles.asked}>
              <Text style={[styles.askedLabel, rtlText]}>{t('consign.fromVevaty')}</Text>
              <Text style={[styles.askedText, rtlText]}>{askedNote}</Text>
            </View>
          ) : null}

          <Text style={[styles.lede, rtlText]}>{t('consign.formLede')}</Text>

          {/* ---- What is it ---------------------------------------- */}
          <Text style={[styles.section, rtlText]}>{t('consign.sectionWhat')}</Text>
          <View style={styles.field}>
            <Text style={[styles.label, rtlText]}>{t('consign.kind')}</Text>
            {kinds === null || kinds.length === 0 ? (
              // Only reachable on an EDIT: a new form with no kinds is
              // blocked above rather than shown with an empty picker.
              <Text style={[styles.hint, rtlText]}>{t('consign.kindsFailed')}</Text>
            ) : (
              <View style={styles.pills}>
                {kinds.map((k) => (
                  <Pressy
                    key={k.kind}
                    onPress={() => set('kind', k.kind)}
                    disabled={saving}
                    style={[styles.pill, draft.kind === k.kind && styles.pillOn]}
                  >
                    <Text style={[styles.pillText, draft.kind === k.kind && styles.pillTextOn]}>
                      {label(k)}
                    </Text>
                  </Pressy>
                ))}
              </View>
            )}
          </View>
          {field('title', 'consign.itemTitle', { hint: t('consign.titleHint'), max: MAX_TITLE })}
          {field('description', 'consign.itemDescription', {
            hint: t('consign.descriptionHint'), multiline: true, max: MAX_DESCRIPTION,
          })}

          {/* ---- What makes it that -------------------------------- */}
          <Text style={[styles.section, rtlText]}>{t('consign.sectionIdentity')}</Text>
          {field('brand', 'consign.brand', { hint: t('consign.brandHint'), max: 80 })}
          {field('modelRef', 'consign.modelRef', { hint: t('consign.modelRefHint'), max: 80 })}
          {field('yearMade', 'consign.yearMade', { hint: t('consign.yearMadeHint'), max: 40 })}
          {field('sizeNotes', 'consign.sizeNotes', { hint: t('consign.sizeNotesHint'), max: 200 })}

          {/* ---- What state is it in ------------------------------- */}
          <Text style={[styles.section, rtlText]}>{t('consign.sectionCondition')}</Text>
          <View style={styles.field}>
            <Text style={[styles.label, rtlText]}>{t('consign.condition')}</Text>
            <View style={styles.pills}>
              {SUBMISSION_CONDITIONS.map((c: SubmissionCondition) => (
                <Pressy
                  key={c}
                  onPress={() => set('condition', c)}
                  disabled={saving}
                  style={[styles.pill, draft.condition === c && styles.pillOn]}
                >
                  <Text style={[styles.pillText, draft.condition === c && styles.pillTextOn]}>
                    {t(`consign.grade.${c}`)}
                  </Text>
                </Pressy>
              ))}
            </View>
          </View>
          {field('conditionNotes', 'consign.conditionNotes', {
            hint: t('consign.conditionNotesHint'), multiline: true, max: 1000,
          })}

          {/* ---- What comes with it -------------------------------- */}
          <Text style={[styles.section, rtlText]}>{t('consign.sectionPapers')}</Text>
          {check('hasBox', 'consign.hasBox')}
          {check('hasPapers', 'consign.hasPapers')}
          {check('hasAuthentication', 'consign.hasAuthentication')}
          {field('provenance', 'consign.provenance', {
            hint: t('consign.provenanceHint'), multiline: true, max: 2000,
          })}

          {/* ---- Is it yours --------------------------------------- */}
          <Text style={[styles.section, rtlText]}>{t('consign.sectionOwnership')}</Text>
          <Text style={[styles.hint, rtlText, { marginBottom: 6 }]}>{t('consign.ownershipHint')}</Text>
          {check('ownsOutright', 'consign.ownsOutright')}

          {/* ---- What is it worth ---------------------------------- */}
          <Text style={[styles.section, rtlText]}>{t('consign.sectionValue')}</Text>
          <Text style={[styles.hint, rtlText, { marginBottom: 6 }]}>{t('consign.valueHint')}</Text>
          <View style={[styles.row, mirrorRow(isRTL)]}>
            <View style={styles.half}>
              {field('estimateLow', 'consign.estimateLow', { numeric: true })}
            </View>
            <View style={styles.half}>
              {field('estimateHigh', 'consign.estimateHigh', { numeric: true })}
            </View>
          </View>
          {field('reserveExpectation', 'consign.reserve', {
            hint: t('consign.reserveHint'), numeric: true,
          })}

          {/* ---- Where is it --------------------------------------- */}
          <Text style={[styles.section, rtlText]}>{t('consign.sectionWhere')}</Text>
          <View style={styles.field}>
            <Text style={[styles.label, rtlText]}>{t('consign.governorate')}</Text>
            <View style={styles.pills}>
              {getGovernorateNames().map((g) => (
                <Pressy
                  key={g}
                  onPress={() => set('governorate', draft.governorate === g ? '' : g)}
                  disabled={saving}
                  style={[styles.pill, draft.governorate === g && styles.pillOn]}
                >
                  <Text style={[styles.pillText, draft.governorate === g && styles.pillTextOn]}>
                    {g}
                  </Text>
                </Pressy>
              ))}
            </View>
          </View>
          {field('district', 'consign.district', { max: 80 })}
          {field('logisticsNotes', 'consign.logistics', {
            hint: t('consign.logisticsHint'), multiline: true, max: 1000,
          })}

          {/* ---- Photographs --------------------------------------- */}
          <Text style={[styles.section, rtlText]}>{t('consign.sectionPhotos')}</Text>
          <Text style={[styles.hint, rtlText]}>{t('consign.photosHint')}</Text>
          <View style={styles.thumbs}>
            {draft.photos.map((p) => (
              <View key={p.url} style={styles.thumbWrap}>
                <Image source={{ uri: p.thumbnailUrl || p.url }} style={styles.thumb} />
                <Pressy
                  onPress={() => removePhoto(p.url)}
                  disabled={saving}
                  style={styles.thumbX}
                  accessibilityLabel={t('consign.removePhoto')}
                >
                  <Icon name="close" size={12} color={colors.white} />
                </Pressy>
              </View>
            ))}
            {draft.photos.length < MAX_SUBMISSION_PHOTOS ? (
              <Pressy onPress={addPhotos} disabled={saving || uploading} style={styles.addPhoto}>
                {uploading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <>
                    <Icon name="camera" size={18} color={colors.inkSoft} />
                    <Text style={styles.addPhotoText}>{t('consign.addPhoto')}</Text>
                  </>
                )}
              </Pressy>
            ) : null}
          </View>
          <Text style={[styles.hint, rtlText]}>
            {t('consign.photoCount', {
              n: String(draft.photos.length), max: String(MAX_SUBMISSION_PHOTOS),
            })}
          </Text>

          {/* Only on a NEW submission. An edit is somebody answering a
              question we asked, and stopping them mid-conversation to
              re-agree to a document we changed in the meantime would be
              our problem made into theirs -- which is why the server does
              not gate the edit either. */}
          {!editingId ? (
            <View style={styles.terms}>
              <TermsTick
                slug="auction_consignment"
                context="consignment_form"
                onChange={onTermsChange}
                refreshToken={termsRefresh}
              />
            </View>
          ) : null}

          {error ? <Text style={[styles.error, rtlText]}>{error}</Text> : null}

          {/* Only `saving` disables it. Gating the button on `missing`
              would make it inert with no explanation -- Pressy has no
              disabled styling, so it would look live and do nothing. It
              is dimmed instead, and the tap names what is missing. */}
          {/* `uploading` disables it too. Without that, tapping Send
              mid-upload sent the draft captured at tap time -- without the
              photos still in flight -- and then unmounted the screen, so
              they were lost with a "sent" dialog on top. */}
          <Pressy
            onPress={save}
            disabled={saving || uploading}
            style={[styles.submit, (saving || uploading || !!missing) && styles.submitIdle]}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.submitText}>
                {editingId ? t('consign.saveChanges') : t('consign.send')}
              </Text>
            )}
          </Pressy>
          <Text style={[styles.footnote, rtlText]}>{t('consign.footnote')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, height: 48,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 18, paddingBottom: 120 },
  bodyDesktop: { paddingHorizontal: 0, paddingBottom: 60 },
  lede: { ...type.soft, marginTop: 4, marginBottom: 18, lineHeight: 20 },

  section: {
    ...type.h3, fontSize: 15, marginTop: 22, marginBottom: 8,
    paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.line,
  },
  field: { marginBottom: 14 },
  label: { fontSize: 13.5, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  hint: { ...type.tiny, lineHeight: 16, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm,
    paddingHorizontal: 11, paddingVertical: 10, color: colors.ink,
    backgroundColor: colors.card, fontSize: 14.5,
  },
  inputTall: { minHeight: 92, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },

  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 13, height: 34, justifyContent: 'center',
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card,
  },
  pillOn: { borderColor: colors.accentRing, backgroundColor: colors.accentTint },
  pillText: { fontSize: 13, fontWeight: '700', color: colors.inkSoft },
  pillTextOn: { color: colors.ink },

  check: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  box: {
    width: 21, height: 21, borderRadius: 5, borderWidth: 1.5,
    borderColor: colors.line, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card,
  },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkText: { flex: 1, fontSize: 14, color: colors.ink, lineHeight: 19 },

  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4, marginBottom: 6 },
  thumbWrap: { width: 84, height: 84 },
  thumb: { width: 84, height: 84, borderRadius: radius.sm, backgroundColor: colors.surface },
  thumbX: {
    position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center',
  },
  addPhoto: {
    width: 84, height: 84, borderRadius: radius.sm, borderWidth: 1,
    borderColor: colors.line, borderStyle: 'dashed', backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center', gap: 3,
  },
  addPhotoText: { fontSize: 10.5, fontWeight: '700', color: colors.inkSoft },

  terms: { marginTop: 22, paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.line },
  error: { ...type.tiny, color: colors.danger, lineHeight: 17, marginTop: 12 },
  submit: {
    marginTop: 18, height: 50, borderRadius: radius.pill, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  submitIdle: { opacity: 0.45 },
  submitText: { fontSize: 15, fontWeight: '800', color: colors.white },
  footnote: { ...type.tiny, marginTop: 12, lineHeight: 16 },

  asked: {
    marginTop: 6, marginBottom: 4, padding: 12, borderRadius: radius.sm,
    backgroundColor: colors.warnBg, gap: 4,
  },
  askedLabel: { fontSize: 10.5, fontWeight: '800', color: colors.accentDeep, letterSpacing: 0.4 },
  askedText: { fontSize: 13.5, color: colors.ink, lineHeight: 19 },

  gate: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 30 },
  gateBtn: {
    marginTop: 16, paddingHorizontal: 22, height: 44, justifyContent: 'center',
    borderRadius: radius.pill, backgroundColor: colors.primary,
  },
  gateBtnText: { fontSize: 14, fontWeight: '800', color: colors.white },

  rtl: { textAlign: 'right', writingDirection: 'rtl' },
});
