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
