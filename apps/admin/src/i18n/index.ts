import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ml from './locales/ml.json';

const STORAGE_KEY = 'wtrdrop.admin.language';

function savedLanguage(): 'en' | 'ml' {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'ml' ? 'ml' : 'en';
  } catch {
    return 'en';
  }
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ml: { translation: ml } },
  lng: savedLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* storage unavailable: language resets on reload */
  }
});
document.documentElement.lang = i18n.language;

export default i18n;
