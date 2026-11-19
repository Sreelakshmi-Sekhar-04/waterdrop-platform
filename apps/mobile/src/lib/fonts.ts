import { Nunito_400Regular } from '@expo-google-fonts/nunito/400Regular';
import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold';
import { Nunito_800ExtraBold } from '@expo-google-fonts/nunito/800ExtraBold';
import { Nunito_900Black } from '@expo-google-fonts/nunito/900Black';
import { NotoSansMalayalam_400Regular } from '@expo-google-fonts/noto-sans-malayalam/400Regular';
import { NotoSansMalayalam_700Bold } from '@expo-google-fonts/noto-sans-malayalam/700Bold';

/** Only the weights the designs use are bundled, to keep the app small. */
export const fontAssets = {
  Nunito_400Regular,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  Nunito_900Black,
  NotoSansMalayalam_400Regular,
  NotoSansMalayalam_700Bold,
};

export type Weight = 'regular' | 'bold' | 'heavy' | 'black';

/** Picks the loaded font for a weight. Malayalam uses Noto Sans Malayalam (Nunito has no Malayalam letters). */
export function fontFor(weight: Weight, language: string): string {
  if (language === 'ml')
    return weight === 'regular' ? 'NotoSansMalayalam_400Regular' : 'NotoSansMalayalam_700Bold';
  return {
    regular: 'Nunito_400Regular',
    bold: 'Nunito_700Bold',
    heavy: 'Nunito_800ExtraBold',
    black: 'Nunito_900Black',
  }[weight];
}
