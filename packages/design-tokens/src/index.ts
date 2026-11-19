/**
 * WtrDrop design tokens, shared by the mobile app and the admin portal.
 * Source: the approved logo and UI direction (Phase 0 design canvas).
 * Every text/background pair used in the apps is checked for WCAG AA contrast
 * in index.test.ts.
 */

export const colors = {
  /** Drop Blue: main buttons, links, logo. */
  primary: '#1769E0',
  primaryPressed: '#0F4FAF',
  /** Light blue used for the logo's motion lines. */
  primarySoft: '#7CC4FA',
  /** Deep Navy: headings and body text. */
  ink: '#0B2545',
  /** Slate: secondary text and labels. */
  inkMuted: '#4A5B70',
  /** Mist: highlighted cards and selected options. */
  mist: '#E6F1FC',
  /** Cloud: page background. */
  background: '#F4F8FC',
  surface: '#FFFFFF',
  border: '#DCE6F0',
  borderStrong: '#C7D7EA',
  /** Done Green: delivered, paid. */
  success: '#13795B',
  successSoft: '#E3F4EC',
  /** Attention Amber: due, failed, short. */
  warning: '#B54708',
  warningSoft: '#FDF0E3',
  onPrimary: '#FFFFFF',
} as const;

export type ColorToken = keyof typeof colors;

/** 4-point spacing scale, in px (web) or dp (mobile). */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const radii = { sm: 12, md: 16, lg: 20, xl: 24, pill: 999 } as const;

export const fonts = {
  /** Latin text. Malayalam text falls back to Noto Sans Malayalam. */
  family: 'Nunito',
  familyMalayalam: 'Noto Sans Malayalam',
  weights: { regular: '400', semibold: '600', bold: '700', heavy: '800', black: '900' },
} as const;

/** Type scale. Body text is never below 16. */
export const fontSizes = {
  caption: 14,
  label: 15,
  body: 17,
  bodyLarge: 19,
  title: 22,
  heading: 28,
  display: 34,
} as const;

/** Minimum touch target, from the accessibility rules in the Phase 0 analysis (§7.3). */
export const touchTarget = { min: 48, primaryButtonHeight: 58 } as const;

export const shadows = {
  card: '0 1px 3px rgba(11,37,69,0.08)',
  raised: '0 6px 20px rgba(11,37,69,0.10)',
} as const;

export const tokens = { colors, spacing, radii, fonts, fontSizes, touchTarget, shadows } as const;
export default tokens;

// ---- contrast helpers (used by tests and available to the apps) ----

function channel(hex: string, offset: number): number {
  const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}
