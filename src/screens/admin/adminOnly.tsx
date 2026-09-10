import React from 'react';
import { useSettings } from '../../store/SettingsStore';
import AdminGateScreen from './AdminGateScreen';

// Every admin page except the sign-in itself is registered through this.
//
// Until 10 Sep 2026 the inner admin pages were plain routes: anyone who
// typed vevaty.com/admin/branding got the whole branding editor, and
// /admin/users the user search. Nothing they pressed would have saved --
// the server checks myazar.admins on every write -- but the admin area is
// meant to be invisible to members, not merely inert.
//
// So a visitor who is not signed in to the panel gets the admin sign-in
// in the page's place, at the page's own address, and the page itself once
// they are through it. Not a redirect: the gate already shows a spinner
// while the admin check is still running, so an admin reloading an inner
// page never sees the form flash, and signing out from the lock screen
// swaps whatever page was open for the form at once.
//
// Wrap once, at module level (see RootNavigator). Calling adminOnly()
// inside a render makes a new component type every time, and React would
// remount the page on every render.
export function adminOnly<P extends object>(Page: React.ComponentType<P>): React.ComponentType<P> {
  function AdminOnly(props: P) {
    const { isAdmin } = useSettings();
    return isAdmin ? <Page {...props} /> : <AdminGateScreen />;
  }
  AdminOnly.displayName = `adminOnly(${Page.displayName || Page.name || 'Page'})`;
  return AdminOnly;
}
