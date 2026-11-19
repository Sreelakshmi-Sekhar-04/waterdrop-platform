import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '@wtrdrop/design-tokens';

/** Simple stroke icons used across the app. Always shown next to words, never alone for meaning. */
export type IconName =
  | 'home'
  | 'orders'
  | 'help'
  | 'phone'
  | 'map'
  | 'check'
  | 'alert'
  | 'truck'
  | 'clock'
  | 'back'
  | 'pin'
  | 'cash'
  | 'swap'
  | 'note'
  | 'chat'
  | 'cloud-off'
  | 'refresh';

const PATHS: Record<IconName, React.ReactNode> = {
  home: (
    <>
      <Path d="M3 11l9-7 9 7v9H3z" />
      <Path d="M10 20v-6h4v6" />
    </>
  ),
  orders: (
    <>
      <Path d="M6 3h12v18H6z" />
      <Path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  help: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5" />
      <Circle cx="12" cy="17" r="0.6" />
    </>
  ),
  phone: (
    <Path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
  ),
  map: <Path d="M3 11l18-8-8 18-2-8z" />,
  check: <Path d="M5 12l5 5 9-10" />,
  alert: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 7.5v5.5" />
      <Circle cx="12" cy="16.5" r="0.6" />
    </>
  ),
  truck: (
    <>
      <Path d="M3 7h11v9H3z" />
      <Path d="M14 10h4l3 3v3h-7" />
      <Circle cx="7" cy="18" r="1.6" />
      <Circle cx="17" cy="18" r="1.6" />
    </>
  ),
  clock: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 7v5l3 2" />
    </>
  ),
  back: <Path d="M15 5l-7 7 7 7" />,
  pin: (
    <>
      <Path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" />
      <Circle cx="12" cy="9" r="2.5" />
    </>
  ),
  cash: (
    <>
      <Rect x="3" y="6" width="18" height="12" rx="2" />
      <Circle cx="12" cy="12" r="2.5" />
    </>
  ),
  swap: (
    <>
      <Path d="M4 12a8 8 0 0 1 14-5.3L20 9" />
      <Path d="M20 4v5h-5" />
      <Path d="M20 12a8 8 0 0 1-14 5.3L4 15" />
      <Path d="M4 20v-5h5" />
    </>
  ),
  note: <Path d="M4 5h16v11H8l-4 4z" />,
  chat: <Path d="M4 4h16v12H9l-5 4zM8 9h8M8 12h5" />,
  'cloud-off': (
    <>
      <Path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9a4.5 4.5 0 0 0 1 9z" />
      <Path d="M3 3l18 18" />
    </>
  ),
  refresh: (
    <>
      <Path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <Path d="M20 5v6h-6" />
    </>
  ),
};

export function Icon({
  name,
  size = 22,
  color = colors.ink,
  strokeWidth = 2.2,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  // Decorative: hidden from screen readers (the label next to it carries the meaning).
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {PATHS[name]}
      </Svg>
    </View>
  );
}
