import { colors } from '@wtrdrop/design-tokens';

/** The approved "delivery drop" mark. */
export function LogoMark({ size = 32, color = colors.primary }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={(size * 120) / 140} viewBox="0 0 140 120" aria-hidden="true">
      <path d="M80 6 C80 6 46 50 46 78 A34 34 0 0 0 114 78 C114 50 80 6 80 6 Z" fill={color} />
      <line
        x1="10"
        y1="64"
        x2="34"
        y2="64"
        stroke={colors.primarySoft}
        strokeWidth="10"
        strokeLinecap="round"
      />
      <line
        x1="20"
        y1="84"
        x2="36"
        y2="84"
        stroke={colors.primarySoft}
        strokeWidth="10"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      Wtr<span style={{ color: colors.primary }}>Drop</span>
    </span>
  );
}
