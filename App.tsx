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

// Kills the focus ring the browser draws inside text fields on the web.
//
// A TextInput becomes an <input>, and the browser outlines it when
// focused: a hard rectangle sitting inside our own rounded search pill,
// which reads as a box nested in a box. The native app has no equivalent.
//
// My first attempt swapped the browser's outline for one in the app's
// colour, reasoning that :focus-visible matches only keyboard focus and so
// a mouse user would never see it. That reasoning was wrong: per spec a
// text field ALWAYS matches :focus-visible when focused, however focus was
// gained, because it accepts keyboard input. The "compromise" was
// therefore no compromise at all -- it just recoloured the box.
//
// Text fields are the one control that needs no ring: the caret is already
// an unambiguous focus indicator and appears only in the focused field.
// Buttons and links have no such signal, so they keep one for keyboard
// users, which is where the accessibility concern actually bites.
function WebFocusStyles() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const id = 'vevaty-focus-styles';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = [
      // Text entry: no ring, in any state. The caret does this job.
      'input:focus, input:focus-visible, textarea:focus, textarea:focus-visible,',
      '[contenteditable]:focus, [contenteditable]:focus-visible {',
      '  outline: none !important;',
      '  box-shadow: none !important;',
      '}',
      // Everything else keyboard-reachable keeps a ring, and only when
      // actually reached by keyboard.
      '[role="button"]:focus-visible, button:focus-visible, a:focus-visible {',
      '  outline: 2px solid var(--vevaty-primary, #2b2b2f);',
      '  outline-offset: 2px;',
      '}',
    ].join('\n');
    document.head.appendChild(el);
  }, []);

  return null;
}

// Wheel and keyboard scrolling from anywhere on the page.
//
// On the web, react-native-web turns every ScrollView and FlatList into
// its own scroll container, and the browser only scrolls the container
// the pointer happens to be over. The page body itself never scrolls. So
// with the cursor beside the grid, over the category row, or in the
// margin, the trackpad did nothing -- the site felt broken, correctly,
// because there was genuinely nothing under the cursor to scroll.
//
// This is a fallback, not an override. If the thing under the pointer can
// scroll in the direction asked for, it is left alone and the browser
// behaves normally -- horizontal category strips, the filter sidebar and
// modal sheets all keep their own scrolling. Only when nothing would move
// does this forward the gesture to the main scroller.
//
// Arrow keys, Page Up/Down, Home/End and space work the same way, and are
// ignored while a text field has focus, where those keys mean something
// else entirely.
function WebScrollAnywhere() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const canScroll = (el: HTMLElement, dy: number) => {
      if (el.scrollHeight <= el.clientHeight + 1) return false;
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll') return false;
      return dy > 0
        ? el.scrollTop + el.clientHeight < el.scrollHeight - 1
        : el.scrollTop > 0;
    };

    // Walk up from whatever the pointer is over. If anything on the way to
    // the root would handle this scroll itself, do nothing.
    const nativeHandlerExists = (target: EventTarget | null, dy: number) => {
      let el = target as HTMLElement | null;
      while (el && el !== document.body) {
        if (canScroll(el, dy)) return true;
        el = el.parentElement;
      }
      return false;
    };

    // The biggest vertically-scrollable box on screen: in this app that's
    // always the list of listings, whatever screen you're on. Recomputed
    // per gesture rather than cached, because it changes with navigation,
    // and a stale reference would scroll something invisible.
    const mainScroller = (dy: number): HTMLElement | null => {
      let best: HTMLElement | null = null;
      let bestArea = 0;
      document.querySelectorAll<HTMLElement>('div').forEach((el) => {
        if (!canScroll(el, dy)) return;
        const rect = el.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 80) return;
        const area = rect.width * rect.height;
        if (area > bestArea) {
          bestArea = area;
          best = el;
        }
      });
      return best;
    };

    const onWheel = (e: WheelEvent) => {
      const dy = e.deltaY;
      if (!dy || nativeHandlerExists(e.target, dy)) return;
      const target = mainScroller(dy);
      if (!target) return;
      target.scrollTop += dy;
      e.preventDefault();
    };

    const KEY_STEP = 80;
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      let dy = 0;
      let toEnd: 'top' | 'bottom' | null = null;
      switch (e.key) {
        case 'ArrowDown': dy = KEY_STEP; break;
        case 'ArrowUp': dy = -KEY_STEP; break;
        case 'PageDown': dy = window.innerHeight * 0.9; break;
        case 'PageUp': dy = -window.innerHeight * 0.9; break;
        case ' ': dy = window.innerHeight * (e.shiftKey ? -0.9 : 0.9); break;
        case 'Home': toEnd = 'top'; break;
        case 'End': toEnd = 'bottom'; break;
        default: return;
      }

      const probe = toEnd === 'top' ? -1 : toEnd === 'bottom' ? 1 : dy;
      const target = mainScroller(probe);
      if (!target) return;
      if (toEnd === 'top') target.scrollTop = 0;
      else if (toEnd === 'bottom') target.scrollTop = target.scrollHeight;
      else target.scrollTop += dy;
      e.preventDefault();
    };

    // Not passive: this one sometimes calls preventDefault, and a passive
    // listener that does is ignored with a console warning.
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
    };
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
        <WebScrollAnywhere />
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
