import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '@wtrdrop/design-tokens';
import '../i18n';
import { restoreLanguage } from '../i18n';
import { fontAssets } from '../lib/fonts';
import { SessionProvider } from '../lib/session';

void SplashScreen.preventAutoHideAsync();
const queryClient = new QueryClient();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const [languageReady, setLanguageReady] = useState(false);

  useEffect(() => {
    void restoreLanguage().finally(() => setLanguageReady(true));
  }, []);

  // If fonts fail to load the app still opens with system fonts rather than staying on the splash.
  const ready = (fontsLoaded || !!fontError) && languageReady;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          />
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
