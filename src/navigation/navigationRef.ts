import { createNavigationContainerRef } from '@react-navigation/native';
import { RootStackParamList } from './types';

// The navigator, reachable from outside it. Exists for one caller: the
// "Report a problem" tab, which is mounted beside the navigator in App.tsx
// (like AlertHost) rather than inside any screen, and still has to say
// WHICH screen the tester was on when something broke.
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
