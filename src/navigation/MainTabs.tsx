import React from 'react';
import { View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import HomeStackNavigator from './HomeStack';
import ChatScreen from '../screens/ChatScreen';
import ProfileScreen from '../screens/ProfileScreen';
import TabBar from './TabBar';
import { useAppStore } from '../store/AppStore';
import { MainTabParamList, RootStackParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

// SellTab never actually renders — pressing it is intercepted below and
// redirected to the CreateListing flow on the root stack instead.
function SellPlaceholder() {
  return <View />;
}

export default function MainTabs() {
  const rootNav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { isVerified } = useAppStore();

  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tab.Screen name="HomeTab" component={HomeStackNavigator} />
      <Tab.Screen
        name="SellTab"
        component={SellPlaceholder}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            // Posting is gated behind a real phone-verified account (the
            // anonymous session every launch starts with can't create
            // listings -- see the "anonymous sessions cannot create
            // listings" RLS policy). Send them to log in first;
            // AuthScreen replaces itself with CreateListing on success.
            if (isVerified) rootNav.navigate('CreateListing');
            else rootNav.navigate('Auth', { returnTo: 'CreateListing' });
          },
        }}
      />
      <Tab.Screen name="ChatTab" component={ChatScreen} />
      <Tab.Screen name="ProfileTab" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
