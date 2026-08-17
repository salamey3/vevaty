import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept from
// the original App.tsx; not currently wired into the tree below.
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppStoreProvider } from './src/store/AppStore';
import { ChatStoreProvider } from './src/store/ChatStore';
import { FavoritesStoreProvider } from './src/store/FavoritesStore';
import { SavedSearchesStoreProvider } from './src/store/SavedSearchesStore';
import { SettingsProvider, useSettings } from './src/store/SettingsStore';
import { ScrollChromeProvider } from './src/store/ScrollChromeContext';
import { LanguageProvider } from './src/i18n/LanguageContext';
import RootNavigator from './src/navigation/RootNavigator';
import AlertHost from './src/components/AlertHost';
import AdminLockScreen from './src/components/AdminLockScreen';

// Feeds SettingsStore's auto-lock idle timer -- any pointer/keyboard
// activity anywhere in the app resets the clock. Web-only (matches the
// Platform.OS === 'web' conditionals already used in theme.ts/favicon.ts;
// this whole app ships web-only), and only meaningfully does anything
// while signed in as admin, so it's a no-op for every regular user.
function AdminActivityListener() {
  const { isAdmin, recordActivity } = useSettings();

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !isAdmin) return;
    const handler = () => recordActivity();
    window.addEventListener('pointerdown', handler);
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
    };
  }, [isAdmin, recordActivity]);

  return null;
}

// The browser draws its own focus ring on the <input> that every
// TextInput becomes on the web -- a hard black rounded rectangle sitting
// inside our own rounded search field, which looks like a second box
// nested in the first. The native app has no equivalent, so the two
// platforms disagreed on what a focused field looks like.
//
// Replaced rather than removed. Deleting the outline outright is the easy
// fix and it strips keyboard users of the only signal telling them where
// they are on the page; :focus-visible only matches keyboard focus, so
// clicking a field is quiet while tabbing to it still shows a ring -- in
// the app's own colour instead of the browser's.
function WebFocusStyles() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const id = 'vevaty-focus-styles';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = [
      'input:focus, textarea:focus, [contenteditable]:focus { outline: none; }',
      'input:focus-visible, textarea:focus-visible {',
      '  outline: 2px solid var(--vevaty-primary, #2b2b2f);',
      '  outline-offset: 2px;',
      '  border-radius: 6px;',
      '}',
    ].join('\n');
    document.head.appendChild(el);
  }, []);

  return null;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <SettingsProvider>
          <AppStoreProvider>
            <ChatStoreProvider>
              <FavoritesStoreProvider>
                <SavedSearchesStoreProvider>
                  <ScrollChromeProvider>
                    <StatusBar style="dark" />
                    <RootNavigator />
                    <AlertHost />
                    <AdminLockScreen />
                    <AdminActivityListener />
        <WebFocusStyles />
                  </ScrollChromeProvider>
                </SavedSearchesStoreProvider>
              </FavoritesStoreProvider>
            </ChatStoreProvider>
          </AppStoreProvider>
        </SettingsProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}
