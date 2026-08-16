// react-native-web ships Alert.alert as a total no-op (`static alert() {}`),
// so any code calling the real react-native `Alert.alert(...)` silently does
// nothing on the deployed web build -- no dialog, no error, nothing.
//
// This module is a drop-in replacement with the same call signature
// (`Alert.alert(title, message?, buttons?)`) that actually renders something
// on web (and native): it forwards the call to whichever <AlertHost /> is
// currently mounted (see components/AlertHost.tsx, mounted once in App.tsx).
// Call sites don't change at all -- only the import source does:
//   import { Alert } from 'react-native';        // silently broken on web
//   import { Alert } from '../lib/alertShim';     // works everywhere
export type AlertButtonStyle = 'default' | 'cancel' | 'destructive';

export type AlertButton = {
  text?: string;
  style?: AlertButtonStyle;
  onPress?: () => void;
};

type ShowFn = (title: string, message?: string, buttons?: AlertButton[]) => void;

let activeHost: ShowFn | null = null;

// Called by AlertHost when it mounts/unmounts. Not for direct use elsewhere.
export function registerAlertHost(fn: ShowFn | null) {
  activeHost = fn;
}

function alert(title: string, message?: string, buttons?: AlertButton[]) {
  if (activeHost) {
    activeHost(title, message, buttons);
  } else if (__DEV__) {
    // AlertHost should always be mounted (it lives in App.tsx), so this
    // means something tried to alert before the app finished mounting.
    console.warn('[alertShim] No AlertHost mounted yet, dropped alert:', title, message);
  }
}

export const Alert = { alert };
