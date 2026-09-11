import React from 'react';
import { View } from 'react-native';
import { colors } from '../../theme/theme';

// What an admin page renders while the server says the session is locked:
// nothing. The lock screen (AdminLockScreen, a modal) sits on top, and the
// page underneath is taken down rather than kept, because on the website a
// page kept under a modal is still in the page -- anyone at the unattended
// browser could delete the overlay and read the user details, phone numbers
// and reports it was showing. The cost, accepted: edits not yet saved when
// the lock comes down are lost. Lock times go up to three hours.
export default function AdminLockedBackdrop() {
  return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
}
