import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from './locales/en.json';
import ml from './locales/ml.json';

const STORAGE_KEY = 'wtrdrop.language';
export type AppLanguage = 'en' | 'ml';

/** Phone set to Malayalam → start in Malayalam. The user can switch with one tap. */
function deviceLanguage(): AppLanguage {
  return getLocales()[0]?.languageCode === 'ml' ? 'ml' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ml: { translation: ml } },
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

/** Restores the language the user picked last time, if any. */
export async function restoreLanguage(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ml') await i18n.changeLanguage(saved);
  } catch {
    /* storage unavailable: keep the device language */
  }
}

export async function setLanguage(lng: AppLanguage): Promise<void> {
  await i18n.changeLanguage(lng);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* not fatal */
  }
}

export default i18n;
