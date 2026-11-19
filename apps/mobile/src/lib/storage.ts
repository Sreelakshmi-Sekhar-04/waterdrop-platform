import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Sign-in secrets live in the phone's secure storage (Android Keystore / iOS Keychain).
 * The web build is only for development previews and tests; there it falls back to browser storage.
 */
const web = Platform.OS === 'web';

export const secure = {
  get: (k: string) => (web ? AsyncStorage.getItem(k) : SecureStore.getItemAsync(k)),
  set: (k: string, v: string) =>
    web ? AsyncStorage.setItem(k, v) : SecureStore.setItemAsync(k, v),
  remove: (k: string) => (web ? AsyncStorage.removeItem(k) : SecureStore.deleteItemAsync(k)),
};

export const KEYS = {
  refreshToken: 'wtrdrop.refreshToken',
  role: 'wtrdrop.role',
  deviceId: 'wtrdrop.deviceId',
  /** Staff: phone number and whether a PIN is set on this phone, for the daily PIN screen. */
  staffPhone: 'wtrdrop.staffPhone',
  staffPinSet: 'wtrdrop.staffPinSet',
} as const;
