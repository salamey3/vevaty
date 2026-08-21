import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';

// Generic "warn before leaving a form with unsaved changes" guard, meant to
// be reused by any form screen (CreateListingScreen, MyStorefrontScreen, and
// whatever comes after) -- see each call site for what "unsaved" and "save"
// mean for that particular form; this hook only owns the interception and
// the two-choice decision, not the save logic itself.
//
// Usage: compute a `hasUnsavedChanges` boolean the way the screen sees fit
// (typically comparing a snapshot of current form state against a baseline
// captured at mount), pass an `onSaveAndExit` that performs the save and
// resolves to true on success / false to stay on the form (e.g. validation
// failed, or the save itself errored). Render the returned `visible`/
// `saving` state through an <ActionSheet> with exactly two options -- see
// CreateListingScreen/MyStorefrontScreen for the wiring; this hook
// deliberately doesn't render anything itself so each screen can supply its
// own translated copy.
//
// Web platform limitation, accepted rather than solved: browsers do not let
// a page customize the buttons/text on the native beforeunload prompt, so an
// actual tab close / refresh / typed-URL navigation can only ever show the
// browser's own generic "Leave site?" confirmation, never this component's
// "Save & exit" / "Exit without saving" choice. This hook still attaches a
// beforeunload listener so that vector isn't completely unguarded, but the
// two-button UI below is reachable only for in-app navigation attempts
// (header back, hardware back, a link inside the app) via React Navigation's
// beforeRemove event.
//
// A second, narrower web quirk applies to the in-app path too: React
// Navigation's linking integration updates the browser's address bar via
// the History API before this listener's preventDefault() can run, so
// cancelling a browser-back attempt (picking "stay" here) can leave the URL
// bar pointing at the destination for a moment while this screen is still
// the one rendered. It resolves itself on the next real navigation and
// nothing is actually lost, so this is accepted rather than worked around --
// avoiding it would mean replacing React Navigation's own history handling,
// well out of proportion to what this feature needs.
export function useUnsavedChangesGuard(hasUnsavedChanges: boolean, onSaveAndExit: () => Promise<boolean>) {
  const navigation = useNavigation();
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const pendingAction = useRef<any>(null);

  useEffect(() => {
    const sub = (navigation as any).addListener('beforeRemove', (e: any) => {
      if (!hasUnsavedChanges) return;
      e.preventDefault();
      pendingAction.current = e.data.action;
      setVisible(true);
    });
    return sub;
  }, [navigation, hasUnsavedChanges]);

  // See the file-level comment above: this can only show the browser's own
  // generic message, never this hook's two custom choices.
  useEffect(() => {
    if (Platform.OS !== 'web' || !hasUnsavedChanges) return;
    if (typeof window === 'undefined') return;
    const warn = (e: any) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedChanges]);

  const proceedWithExit = useCallback(() => {
    setVisible(false);
    const action = pendingAction.current;
    pendingAction.current = null;
    if (action) navigation.dispatch(action);
  }, [navigation]);

  const exitWithoutSaving = useCallback(() => {
    proceedWithExit();
  }, [proceedWithExit]);

  const saveAndExit = useCallback(async () => {
    setSaving(true);
    let ok = false;
    try {
      ok = await onSaveAndExit();
    } finally {
      setSaving(false);
    }
    if (ok) proceedWithExit();
  }, [onSaveAndExit, proceedWithExit]);

  const cancel = useCallback(() => {
    setVisible(false);
    pendingAction.current = null;
  }, []);

  return { visible, saving, saveAndExit, exitWithoutSaving, cancel };
}
