import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import BrowseGateScreen from '../screens/BrowseGateScreen';
import { HomeStackParamList } from './types';

const Stack = createNativeStackNavigator<HomeStackParamList>();

// Three routes. HomeRoot is the buyer's gate (BrowseGateScreen -- which
// section are you shopping in?); the other two are one component, scoped
// differently: HomeDomain is a section's own home, HomeCategory is one
// category inside it. Each is a real push, so back walks category ->
// section -> gate, which is the only way out of a section by design (see
// DOMAINS.md: no persistent section switcher).
//
// Selecting a top-level category used to be
// pure local state inside HomeScreen -- invisible to browser/hardware
// back, which is why pressing back while browsing a category used to
// blow straight past it and exit the app entirely instead of returning
// to "all categories". Splitting it into a real (if trivial) two-screen
// stack gives that state an actual back-stop: entering a category is a
// genuine `navigate` (push), so back correctly pops it. `animation: 'none'`
// because this should read as "the same page, filtered differently", not
// a screen transition.
export default function HomeStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
      <Stack.Screen name="HomeRoot" component={BrowseGateScreen} />
      <Stack.Screen name="HomeDomain" component={HomeScreen} />
      <Stack.Screen name="HomeCategory" component={HomeScreen} />
    </Stack.Navigator>
  );
}
