import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrderStatus } from '@wtrdrop/shared';

export type Tone = 'info' | 'success' | 'warning' | 'neutral';

/** A status is always a word plus colour, never colour alone. */
export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`chip chip-${tone}`}>
      <span className="chip-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

const ORDER_TONE: Record<OrderStatus, Tone> = {
  PLACED: 'info',
  ACCEPTED: 'info',
  ASSIGNED: 'info',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'success',
  RESCHEDULE_PENDING: 'warning',
  CANCELLED: 'neutral',
  REJECTED: 'neutral',
};

export function OrderStatusChip({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  return <Chip tone={ORDER_TONE[status]}>{t(`orderStatus.${status}`)}</Chip>;
}

/** Marks every page or panel that shows made-up numbers. */
export function DemoBadge() {
  const { t } = useTranslation();
  return (
    <span className="demo-badge" title={t('demo.badgeHelp')}>
      {t('demo.badge')}
    </span>
  );
}

/** Page title row: heading, optional subtitle and actions. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-title">
        <h1>{title}</h1>
        {subtitle ? <div className="page-subtitle">{subtitle}</div> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

/** Polite live message, used to say what a simulated action did. */
export function LiveMessage({ text, tone = 'info' }: { text: string | null; tone?: Tone }) {
  return (
    <p className={`live-message${text ? ` live-${tone}` : ''}`} role="status" aria-live="polite">
      {text}
    </p>
  );
}

/** Wraps wide tables so the table scrolls, never the page. */
export function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export function SearchField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="search">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
      </svg>
      <span className="visually-hidden">{label}</span>
      <input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** A customer who deleted their account keeps a placeholder phone, never a real number (ADR 0007). */
export const isDeletedPhone = (phone: string) => phone.startsWith('deleted-');

/** Shows only the last four digits of a phone number. */
export function maskPhone(last4: string): string {
  return `•••• ${last4}`;
}
