import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, fontSizes } from '@wtrdrop/design-tokens';
import { fontFor, type Weight } from '../lib/fonts';

type Variant = 'display' | 'heading' | 'title' | 'bodyLarge' | 'body' | 'label' | 'caption';

const VARIANTS: Record<Variant, { size: number; weight: Weight }> = {
  display: { size: fontSizes.display, weight: 'black' },
  heading: { size: fontSizes.heading, weight: 'black' },
  title: { size: fontSizes.title, weight: 'heavy' },
  bodyLarge: { size: fontSizes.bodyLarge, weight: 'regular' },
  body: { size: fontSizes.body, weight: 'regular' },
  label: { size: fontSizes.label, weight: 'bold' },
  caption: { size: fontSizes.caption, weight: 'regular' },
};

interface Props extends TextProps {
  variant?: Variant;
  muted?: boolean;
  color?: string;
}

/** All app text goes through this, so fonts follow the selected language and scale with system settings. */
export function Text({ variant = 'body', muted, color, style, ...rest }: Props) {
  const { i18n } = useTranslation();
  const v = VARIANTS[variant];
  const base: TextStyle = {
    fontFamily: fontFor(v.weight, i18n.language),
    fontSize: v.size,
    lineHeight: Math.round(v.size * (i18n.language === 'ml' ? 1.55 : 1.35)),
    color: color ?? (muted ? colors.inkMuted : colors.ink),
  };
  return <RNText {...rest} style={[base, style]} />;
}
