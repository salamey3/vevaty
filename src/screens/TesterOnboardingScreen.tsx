import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Screen from '../components/Screen';
import Button from '../components/Button';
import BrandMark from '../components/BrandMark';
import LanguageSwitch from '../components/LanguageSwitch';
import Icon from '../icons/Icon';
import { ChoiceList, FormInput, QuestionCard } from '../components/FormParts';
import { colors, radius, type } from '../theme/theme';
import { useLanguage } from '../i18n/LanguageContext';
import { RootStackParamList } from '../navigation/types';
import { mirrorRow } from '../lib/mirrorRow';
import { useKeyboardAwareScroll } from '../hooks/useKeyboardAwareScroll';
import { ensureSession } from '../lib/supabase';
import {
  Category,
  DevicePreference,
  MobilePreference,
  OnboardingAnswers,
  PhoneType,
  SellerType,
  Sells,
  checkOnboardingLink,
  cleanEmail,
  lebaneseMobile,
  submitOnboarding,
} from '../lib/testerForms';

// Form 1 of the tester round: Vevaty Tester Onboarding (@TESTERS.md, "The
// two forms"). Opened from the link the admin sends on WhatsApp to someone
// who has agreed to test -- vevaty.com/testers/join?k=KEY -- by a visitor
// with no account, so it asks nothing of the app but a browser. The key in
// the link is checked as the page opens, so a link that has been replaced
// says so before anyone types their answers into it.
//
// Every question must be answered, and which ones are asked depends on the
// answer to "Do you sell things regularly?": a shopper is asked what they
// mostly buy; a seller whether it is a shop or personal selling, and what
// they mostly sell. The two lists are kept apart, so changing that answer
// and changing it back never carries one list into the other question.

type Props = NativeStackScreenProps<RootStackParamList, 'TesterOnboarding'>;

type Field =
  | 'fullName'
  | 'phone'
  | 'email'
  | 'sells'
  | 'sellerType'
  | 'categories'
  | 'devicePreference'
  | 'phoneType'
  | 'mobilePreference';
// Top to bottom, for "scroll to the first one that needs an answer".
const FIELD_ORDER: Field[] = [
  'fullName',
  'phone',
  'email',
  'sells',
  'sellerType',
  'categories',
  'devicePreference',
  'phoneType',
  'mobilePreference',
];

type LinkState = 'checking' | 'ok' | 'bad' | 'error';

export default function TesterOnboardingScreen({ navigation, route }: Props) {
  const { t, language, isRTL } = useLanguage();
  const key = typeof route.params?.k === 'string' ? route.params.k.trim() : '';

  const [link, setLink] = useState<LinkState>(key ? 'checking' : 'bad');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [sells, setSells] = useState<Sells | null>(null);
  const [sellerType, setSellerType] = useState<SellerType | null>(null);
  const [sellCats, setSellCats] = useState<Category[]>([]);
  const [sellOther, setSellOther] = useState('');
  const [buyCats, setBuyCats] = useState<Category[]>([]);
  const [buyOther, setBuyOther] = useState('');
  const [devicePreference, setDevicePreference] = useState<DevicePreference | null>(null);
  const [phoneType, setPhoneType] = useState<PhoneType | null>(null);
  const [mobilePreference, setMobilePreference] = useState<MobilePreference | null>(null);

  // Answers are only marked once Send has been pressed; after that each
  // mark goes the moment its answer is fixed.
  const [tried, setTried] = useState(false);
  const [phase, setPhase] = useState<'editing' | 'sending' | 'sent'>('editing');
  const [formError, setFormError] = useState<string | null>(null);
  const [sentName, setSentName] = useState('');
  // The keyboard: on Android nothing scrolls a focused field above it by
  // itself (see useKeyboardAwareScroll), and a form this long has fields
  // near the bottom.
  const { scrollRef, onScroll, onInputFocus, keyboardHeight } = useKeyboardAwareScroll();
  const scrollY = useRef(0);
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
    onScroll(e);
  };
  // Send scrolls to the first question that needs an answer. Measured at
  // that moment, against the frame the list scrolls in: questions appear
  // and disappear with the answers above them, so any position remembered
  // from earlier can be stale.
  const frameRef = useRef<View>(null);
  const cards = useRef<Partial<Record<Field, View | null>>>({});
  const refFor = (f: Field) => (v: View | null) => {
    cards.current[f] = v;
  };
  const scrollToField = (f: Field) => {
    const card = cards.current[f];
    const frame = frameRef.current;
    if (!card || !frame) return;
    frame.measureInWindow((_fx, frameY) => {
      card.measureInWindow((_cx, cardY) => {
        scrollRef.current?.scrollTo({ y: Math.max(0, scrollY.current + cardY - frameY - 12), animated: true });
      });
    });
  };

  const checkLink = useCallback(async () => {
    if (!key) {
      setLink('bad');
      return;
    }
    setLink('checking');
    try {
      setLink((await checkOnboardingLink(key)) ? 'ok' : 'bad');
    } catch (e: any) {
      console.warn('[TesterOnboarding] link check failed:', e?.message || e);
      setLink('error');
    }
  }, [key]);

  useEffect(() => {
    void checkLink();
  }, [checkLink]);

  const shopper = sells === 'shopper';
  const seller = sells === 'often' || sells === 'sometimes';

  const validate = (): { errors: Partial<Record<Field, string>>; answers: OnboardingAnswers | null } => {
    const errors: Partial<Record<Field, string>> = {};
    const name = fullName.replace(/\s+/g, ' ').trim();
    if (name.length < 2) errors.fullName = t('join.errName');
    const cleanPhone = lebaneseMobile(phone);
    if (!cleanPhone) errors.phone = t('join.errPhone');
    const cleanMail = cleanEmail(email);
    if (!cleanMail) errors.email = t('join.errEmail');
    if (!sells) errors.sells = t('join.errChoose');
    if (seller && !sellerType) errors.sellerType = t('join.errChoose');
    const cats = shopper ? buyCats : sellCats;
    const other = (shopper ? buyOther : sellOther).replace(/\s+/g, ' ').trim();
    if (sells) {
      if (cats.length === 0) errors.categories = t('join.errTick');
      else if (cats.includes('other') && !other) errors.categories = t('join.errOther');
    }
    if (!devicePreference) errors.devicePreference = t('join.errChoose');
    if (!phoneType) errors.phoneType = t('join.errChoose');
    if (!mobilePreference) errors.mobilePreference = t('join.errChoose');
    if (Object.keys(errors).length > 0 || !sells || !cleanPhone || !cleanMail || !devicePreference || !phoneType || !mobilePreference) {
      return { errors, answers: null };
    }
    return {
      errors,
      answers: {
        fullName: name,
        phone: cleanPhone,
        email: cleanMail,
        sells,
        sellerType: shopper ? null : sellerType,
        categories: cats,
        categoriesOther: cats.includes('other') ? other : null,
        devicePreference,
        phoneType,
        mobilePreference,
      },
    };
  };

  const checked = validate();
  const errors = tried ? checked.errors : {};

  const toggle = (list: Category[], set: (next: Category[]) => void) => (c: Category) =>
    set(list.includes(c) ? list.filter((x) => x !== c) : [...list, c]);

  const send = async () => {
    if (phase === 'sending') return;
    setTried(true);
    setFormError(null);
    const { errors: now, answers } = validate();
    if (!answers) {
      setFormError(t('join.errSummary'));
      const first = FIELD_ORDER.find((f) => now[f]);
      if (first) scrollToField(first);
      return;
    }
    setPhase('sending');
    try {
      // The form is answered from the visitor's own session -- the silent
      // anonymous one every visit starts with -- which is what the server
      // counts sends against. Made sure of here in case it has not landed.
      await ensureSession().catch(() => null);
      const outcome = await submitOnboarding(key, answers, language);
      switch (outcome) {
        case 'ok':
          setSentName(answers.fullName.split(' ')[0] || answers.fullName);
          setPhase('sent');
          return;
        case 'bad_link':
          setLink('bad');
          break;
        case 'already_sent':
          setFormError(t('join.alreadySent'));
          break;
        case 'too_many':
          setFormError(t('join.tooMany'));
          break;
        case 'invalid_name':
          setFormError(t('join.errName'));
          break;
        case 'invalid_phone':
          setFormError(t('join.errPhone'));
          break;
        case 'invalid_email':
          setFormError(t('join.errEmail'));
          break;
        case 'invalid_answers':
          setFormError(t('join.errSummary'));
          break;
        default:
          setFormError(t('join.failed'));
      }
    } catch (e: any) {
      console.warn('[TesterOnboarding] not sent:', e?.message || e);
      setFormError(t('join.failed'));
    }
    setPhase('editing');
  };

  const goHome = () => navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });

  const rowDir = mirrorRow(isRTL);
  const textDir = isRTL ? styles.rtl : null;
  const busy = phase === 'sending';

  const categoryOptions = [
    { value: 'cars' as const, label: t('join.catCars') },
    { value: 'properties' as const, label: t('join.catProperties') },
    { value: 'computers_phones' as const, label: t('join.catComputers') },
    { value: 'cameras' as const, label: t('join.catCameras') },
    { value: 'other' as const, label: t('join.catOther') },
  ];

  const renderCategories = (list: Category[], set: (next: Category[]) => void, other: string, setOther: (v: string) => void) => (
    <>
      <ChoiceList multi options={categoryOptions} selected={list} onPick={toggle(list, set)} disabled={busy} />
      {list.includes('other') && (
        <FormInput
          onFocus={onInputFocus}
          value={other}
          onChangeText={setOther}
          placeholder={t('join.catOtherPh')}
          maxLength={200}
          editable={!busy}
          invalid={!!errors.categories && !other.trim()}
          style={{ marginTop: 10 }}
        />
      )}
    </>
  );

  let body: React.ReactNode;
  if (link === 'checking') {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[type.soft, styles.centerText]}>{t('join.checking')}</Text>
      </View>
    );
  } else if (link === 'error') {
    body = (
      <View style={styles.center}>
        <Text style={[type.body, styles.centerText]}>{t('join.checkFailed')}</Text>
        <Button label={t('join.retry')} variant="secondary" onPress={checkLink} style={styles.centerButton} />
      </View>
    );
  } else if (link === 'bad') {
    body = (
      <View style={styles.center}>
        <View style={[styles.badge, { backgroundColor: colors.surface }]}>
          <Icon name="lock" size={20} color={colors.inkSoft} />
        </View>
        <Text style={[type.h2, styles.centerText]}>{t('join.badLink')}</Text>
        <Text style={[type.soft, styles.centerText]}>{t('join.badLinkBody')}</Text>
      </View>
    );
  } else if (phase === 'sent') {
    body = (
      <View style={styles.center}>
        <View style={[styles.badge, { backgroundColor: colors.success }]}>
          <Icon name="check" size={22} color={colors.white} />
        </View>
        <Text style={[type.h2, styles.centerText]}>{t('join.sentTitle', { name: sentName })}</Text>
        <Text style={[type.soft, styles.centerText]}>{t('join.sentBody')}</Text>
        <Button label={t('join.goHome')} variant="secondary" onPress={goHome} style={styles.centerButton} />
      </View>
    );
  } else {
    body = (
      <View ref={frameRef} style={styles.fill}>
        <ScrollView
          ref={scrollRef}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scroll, { paddingBottom: 48 + keyboardHeight }]}
        >
          <View style={styles.header}>
            <Text style={[type.title, textDir]}>{t('join.title')}</Text>
            <Text style={[type.body, styles.intro, textDir]}>{t('join.intro')}</Text>
            <Text style={[type.tiny, textDir]}>
              <Text style={styles.star}>* </Text>
              {t('join.allRequired')}
            </Text>
          </View>

          <QuestionCard title={t('join.fullName')} required error={errors.fullName} cardRef={refFor('fullName')}>
            <FormInput
              onFocus={onInputFocus}
              value={fullName}
              onChangeText={setFullName}
              placeholder={t('join.fullNamePh')}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              maxLength={120}
              editable={!busy}
              invalid={!!errors.fullName}
            />
          </QuestionCard>

          <QuestionCard
            title={t('join.phone')}
            required
            help={t('join.phoneHelp')}
            error={errors.phone}
            cardRef={refFor('phone')}
          >
            {/* A number reads left to right in both languages. */}
            <FormInput
              onFocus={onInputFocus}
              value={phone}
              onChangeText={setPhone}
              placeholder={t('join.phonePh')}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              maxLength={24}
              editable={!busy}
              invalid={!!errors.phone}
              style={styles.ltr}
            />
          </QuestionCard>

          <QuestionCard title={t('join.email')} required error={errors.email} cardRef={refFor('email')}>
            <FormInput
              onFocus={onInputFocus}
              value={email}
              onChangeText={setEmail}
              placeholder={t('join.emailPh')}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              maxLength={254}
              editable={!busy}
              invalid={!!errors.email}
              style={styles.ltr}
            />
          </QuestionCard>

          <QuestionCard title={t('join.sellsQ')} required error={errors.sells} cardRef={refFor('sells')}>
            <ChoiceList
              options={[
                { value: 'often' as const, label: t('join.sellsOften') },
                { value: 'sometimes' as const, label: t('join.sellsSometimes') },
                { value: 'shopper' as const, label: t('join.sellsShopper') },
              ]}
              selected={sells}
              onPick={setSells}
              disabled={busy}
            />
          </QuestionCard>

          {shopper && (
            <QuestionCard
              title={t('join.buysQ')}
              required
              help={t('join.tickAll')}
              error={errors.categories}
              cardRef={refFor('categories')}
            >
              {renderCategories(buyCats, setBuyCats, buyOther, setBuyOther)}
            </QuestionCard>
          )}

          {seller && (
            <>
              <QuestionCard title={t('join.sellerTypeQ')} required error={errors.sellerType} cardRef={refFor('sellerType')}>
                <ChoiceList
                  options={[
                    { value: 'business' as const, label: t('join.sellerBusiness') },
                    { value: 'personal' as const, label: t('join.sellerPersonal') },
                  ]}
                  selected={sellerType}
                  onPick={setSellerType}
                  disabled={busy}
                />
              </QuestionCard>
              <QuestionCard
                title={t('join.sellsWhatQ')}
                required
                help={t('join.tickAll')}
                error={errors.categories}
                cardRef={refFor('categories')}
              >
                {renderCategories(sellCats, setSellCats, sellOther, setSellOther)}
              </QuestionCard>
            </>
          )}

          <QuestionCard title={t('join.deviceQ')} required error={errors.devicePreference} cardRef={refFor('devicePreference')}>
            <ChoiceList
              options={[
                { value: 'computer' as const, label: t('join.deviceComputer') },
                { value: 'mobile' as const, label: t('join.deviceMobile') },
              ]}
              selected={devicePreference}
              onPick={setDevicePreference}
              disabled={busy}
            />
          </QuestionCard>

          <QuestionCard title={t('join.phoneTypeQ')} required error={errors.phoneType} cardRef={refFor('phoneType')}>
            <ChoiceList
              options={[
                { value: 'iphone' as const, label: t('join.iphone') },
                { value: 'android' as const, label: t('join.android') },
              ]}
              selected={phoneType}
              onPick={setPhoneType}
              disabled={busy}
            />
          </QuestionCard>

          <QuestionCard title={t('join.mobilePrefQ')} required error={errors.mobilePreference} cardRef={refFor('mobilePreference')}>
            <ChoiceList
              options={[
                { value: 'app' as const, label: t('join.prefApp') },
                { value: 'website' as const, label: t('join.prefWebsite') },
              ]}
              selected={mobilePreference}
              onPick={setMobilePreference}
              disabled={busy}
            />
          </QuestionCard>

          <Text style={[type.tiny, styles.privacy, textDir]}>{t('join.privacy')}</Text>
          {!!formError && <Text style={[styles.formError, textDir]}>{formError}</Text>}
          <Button label={t('join.send')} onPress={send} loading={busy} style={styles.send} />
        </ScrollView>
      </View>
    );
  }

  return (
    <Screen maxWidth={640}>
      <View style={[styles.topBar, rowDir]}>
        <BrandMark variant="sidebar" />
        <LanguageSwitch compact />
      </View>
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    height: 56,
  },
  scroll: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 48 },
  header: { marginBottom: 14, paddingHorizontal: 2, gap: 8 },
  intro: { color: colors.inkSoft, lineHeight: 21 },
  star: { color: colors.danger },
  rtl: { textAlign: 'right' },
  ltr: { textAlign: 'left', writingDirection: 'ltr' },
  privacy: { marginTop: 4, marginBottom: 10, paddingHorizontal: 2, lineHeight: 17 },
  formError: { fontSize: 13.5, color: colors.danger, fontWeight: '600', marginBottom: 10, paddingHorizontal: 2 },
  send: { marginTop: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 60, gap: 10 },
  centerText: { textAlign: 'center' },
  centerButton: { marginTop: 10, alignSelf: 'stretch', maxWidth: 360, width: '100%' },
  badge: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
});
