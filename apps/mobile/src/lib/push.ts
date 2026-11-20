/**
 * Push messages on the customer's phone (ADR 0006, finished in Phase 8 / ADR 0007).
 *
 * The app asks for permission once, after the first order is placed (when "we'll tell you when it
 * is on the way" makes sense), and refreshes the token on Home when permission was already given.
 * The token is removed from the server on sign-out, so a shared phone stops getting the last
 * person's messages. Nothing happens on the web, in a simulator, or before `eas init` has written
 * the project id into app.json, because Expo cannot issue a token there.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

const TOKEN_KEY = 'wtrdrop.pushToken';

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

async function supported() {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
  if (!projectId()) return false;
  const Device = await import('expo-device');
  return Device.isDevice;
}

let handlerSet = false;

/**
 * Registers this phone for messages. `ask` shows the system question if it has not been answered;
 * without it, only an already-given permission is used. Never throws: messages are also in the app.
 */
export async function registerForPush({ ask }: { ask: boolean }): Promise<void> {
  try {
    if (!(await supported())) return;
    const Notifications = await import('expo-notifications');
    if (!handlerSet) {
      handlerSet = true;
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
    }
    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted' && ask && current.canAskAgain)
      status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    if (Platform.OS === 'android')
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Orders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
    await api('/me/push-tokens', { method: 'POST', body: { token, platform: Platform.OS } });
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* no push this time; the Messages screen still has everything */
  }
}

/** Removes this phone's token from the server. Call before the session is signed out. */
export async function unregisterPush(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token) return;
    await AsyncStorage.removeItem(TOKEN_KEY);
    await api('/me/push-tokens', { method: 'DELETE', body: { token } });
  } catch {
    /* the server also drops tokens the push service reports as gone */
  }
}
