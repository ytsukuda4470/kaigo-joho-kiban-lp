import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text, ActivityIndicator, View } from 'react-native';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { LoginScreen }          from '../screens/LoginScreen';
import { InquiryListScreen }    from '../screens/InquiryListScreen';
import { InquiryDetailScreen }  from '../screens/InquiryDetailScreen';
import { ActionCreateScreen }   from '../screens/ActionCreateScreen';
import { FollowupListScreen }   from '../screens/FollowupListScreen';
import { SettingsScreen }       from '../screens/SettingsScreen';

// Google Sign-In の設定
GoogleSignin.configure({
  webClientId: '1024244209293-nbr6rscb8usvgv8sku6j93s3lb2vkrbs.apps.googleusercontent.com',
});

// Firestore offline persistence
firestore().settings({
  persistence: true,
  cacheSizeBytes: firestore.CACHE_SIZE_UNLIMITED,
});

const Tab   = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function InquiryStack() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: '#1a365d' }, headerTintColor: '#fff' }}>
      <Stack.Screen name="InquiryList"   component={InquiryListScreen}   options={{ title: '問い合わせ一覧' }} />
      <Stack.Screen name="InquiryDetail" component={InquiryDetailScreen} options={{ title: '詳細' }} />
      <Stack.Screen name="ActionCreate"  component={ActionCreateScreen}  options={{ title: '対応記録' }} />
    </Stack.Navigator>
  );
}

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused }) => {
          const icons: Record<string, string> = {
            Inquiries: focused ? '📋' : '📋',
            Followups: focused ? '✅' : '☑️',
            Settings:  focused ? '⚙️' : '⚙️',
          };
          return <Text style={{ fontSize: 20 }}>{icons[route.name] || '•'}</Text>;
        },
        tabBarActiveTintColor: '#2b6cb0',
        tabBarInactiveTintColor: '#a0aec0',
        headerShown: false,
      })}
    >
      <Tab.Screen name="Inquiries" component={InquiryStack}        options={{ title: '問い合わせ' }} />
      <Tab.Screen name="Followups" component={FollowupListScreen}  options={{ title: 'フォロー', headerShown: true, headerStyle: { backgroundColor: '#1a365d' }, headerTintColor: '#fff', headerTitle: 'フォローアップ' }} />
      <Tab.Screen name="Settings"  component={SettingsScreen}      options={{ title: '設定', headerShown: true, headerStyle: { backgroundColor: '#1a365d' }, headerTintColor: '#fff', headerTitle: '設定' }} />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  const [user, setUser] = useState<any>(undefined); // undefined = loading

  useEffect(() => {
    const unsub = auth().onAuthStateChanged(u => setUser(u));
    return unsub;
  }, []);

  if (user === undefined) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8f6f0' }}>
        <ActivityIndicator size="large" color="#2b6cb0" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {user ? <TabNavigator /> : (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Login" component={LoginScreen} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}
