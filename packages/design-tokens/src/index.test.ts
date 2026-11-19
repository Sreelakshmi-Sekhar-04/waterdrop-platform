import { describe, expect, it } from 'vitest';
import { colors, contrastRatio } from './index';

/** Every text-on-background pair the designs use. WCAG AA for normal text is 4.5:1. */
const pairs: [string, keyof typeof colors, keyof typeof colors][] = [
  ['body text on page', 'ink', 'background'],
  ['body text on card', 'ink', 'surface'],
  ['muted text on card', 'inkMuted', 'surface'],
  ['muted text on page', 'inkMuted', 'background'],
  ['button label', 'onPrimary', 'primary'],
  ['link on card', 'primary', 'surface'],
  ['selected chip', 'primaryPressed', 'mist'],
  ['text on mist', 'ink', 'mist'],
  ['success chip', 'success', 'successSoft'],
  ['success on card', 'success', 'surface'],
  ['warning chip', 'warning', 'warningSoft'],
  ['warning on card', 'warning', 'surface'],
];

describe('design tokens', () => {
  it.each(pairs)('%s passes WCAG AA (4.5:1)', (_name, fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(4.5);
  });
});
