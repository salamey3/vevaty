import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Language, RTL_LANGUAGES, STRINGS } from './translations';
import { applyFontFamily, ensureFontsInjected } from '../theme/fonts';

const KEY = 'vevaty:language';

interface LanguageValue {
  ready: boolean;
  // True once the user has explicitly picked a language (or one was
  // restored from storage) -- gates whether the language-select screen
  // shows before onboarding.
  chosen: boolean;
  language: Language;
  isRTL: boolean;
  setLanguage: (lang: Language) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageValue | null>(null);

function applyDocumentDirection(lang: Language) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const isRTL = RTL_LANGUAGES.includes(lang);
  document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
  // Inter for English, Almarai (falling back to Inter for any Latin
  // characters mixed in) for Arabic -- see src/theme/fonts.ts.
  applyFontFamily(lang === 'ar' ? 'ar' : 'en');
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [chosen, setChosen] = useState(false);
  const [language, setLanguageState] = useState<Language>('en');

  useEffect(() => {
    // Injects the @font-face rules once; also applies the 'en' (Inter)
    // stack immediately so the language-select screen itself (and the
    // brief moment before AsyncStorage resolves below) never renders in
    // the browser's unstyled default font.
    ensureFontsInjected();
    applyDocumentDirection('en');
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(KEY);
        if (stored === 'en' || stored === 'ar') {
          setLanguageState(stored);
          setChosen(true);
          applyDocumentDirection(stored);
        }
      } catch (e) {
        // Fall back to English/unchosen -- language select screen will show.
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    setChosen(true);
    applyDocumentDirection(lang);
    AsyncStorage.setItem(KEY, lang).catch(() => {});
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let str = STRINGS[language][key] ?? STRINGS.en[key] ?? key;
      if (vars) {
        Object.entries(vars).forEach(([k, v]) => {
          // replaceAll, not replace -- some strings use the same {placeholder}
          // more than once (e.g. "Take at least {min} photos ({count}/{min})"),
          // and a single .replace() would silently leave the second occurrence
          // as literal "{min}" text.
          str = str.replaceAll(`{${k}}`, String(v));
        });
      }
      return str;
    },
    [language]
  );

  const value = useMemo(
    () => ({ ready, chosen, language, isRTL: RTL_LANGUAGES.includes(language), setLanguage, t }),
    [ready, chosen, language, setLanguage, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
