import { tokens } from '@wtrdrop/design-tokens';

/** Publishes the shared design tokens as CSS variables (--color-primary, --space-lg, …). */
export function applyTheme(root: HTMLElement = document.documentElement): void {
  const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  for (const [k, v] of Object.entries(tokens.colors))
    root.style.setProperty(`--color-${kebab(k)}`, v);
  for (const [k, v] of Object.entries(tokens.spacing))
    root.style.setProperty(`--space-${k}`, `${v}px`);
  for (const [k, v] of Object.entries(tokens.radii))
    root.style.setProperty(`--radius-${k}`, `${v}px`);
  for (const [k, v] of Object.entries(tokens.fontSizes))
    root.style.setProperty(`--font-${kebab(k)}`, `${v}px`);
  root.style.setProperty('--shadow-card', tokens.shadows.card);
  root.style.setProperty('--touch-min', `${tokens.touchTarget.min}px`);
}
