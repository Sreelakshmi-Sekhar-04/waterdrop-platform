import Svg, { Line, Path } from 'react-native-svg';
import { colors } from '@wtrdrop/design-tokens';

/** The approved "delivery drop" mark. */
export function LogoMark({ size = 40, color = colors.primary }: { size?: number; color?: string }) {
  return (
    <Svg
      width={size}
      height={(size * 120) / 140}
      viewBox="0 0 140 120"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Path d="M80 6 C80 6 46 50 46 78 A34 34 0 0 0 114 78 C114 50 80 6 80 6 Z" fill={color} />
      <Path
        d="M64 82 Q65 98 80 102"
        fill="none"
        stroke={colors.surface}
        strokeWidth={7}
        strokeLinecap="round"
      />
      <Line
        x1="10"
        y1="64"
        x2="34"
        y2="64"
        stroke={colors.primarySoft}
        strokeWidth={9}
        strokeLinecap="round"
      />
      <Line
        x1="20"
        y1="84"
        x2="36"
        y2="84"
        stroke={colors.primarySoft}
        strokeWidth={9}
        strokeLinecap="round"
      />
    </Svg>
  );
}
