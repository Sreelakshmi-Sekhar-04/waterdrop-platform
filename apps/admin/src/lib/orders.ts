import type { TFunction } from 'i18next';
import {
  addDays,
  deliveryChargeFor,
  depositCansFor,
  istDate,
  priceOrder,
  type OrderChannel,
  type OrderStatus,
} from '@wtrdrop/shared';

export interface WindowSlot {
  date: string;
  windowId: string;
  nameEn: string;
  nameMl: string;
  startTime: string;
  endTime: string;
  capacityCans: number;
  reservedCans: number;
  remainingCans: number;
  unavailable?: 'CLOSED' | 'TOO_LATE' | 'FULL';
  closedReason?: string;
}

export interface OrderOptions {
  product: { id: string; nameEn: string; nameMl: string };
  addressId: string | null;
  unitPricePaise: number;
  specialPrice: boolean;
  depositPerCanPaise: number;
  cansHeld: number;
  depositCoverCans: number;
  delivery: { chargePaise: number; freeAboveCans: number } | null;
  maxCans: number;
  defaultQty: number;
  windows: WindowSlot[];
}

export interface OrderRow {
  id: string;
  orderNo: number;
  status: OrderStatus;
  channel: OrderChannel;
  deliveryDate: string;
  windowId: string;
  windowNameEn: string;
  windowNameMl: string;
  windowStart: string;
  windowEnd: string;
  qty: number;
  totalPaise: number;
  createdAt: string;
  customerId: string;
  customerName: string | null;
  phoneLast4: string;
  areaName: string;
  areaNameMl: string | null;
  landmark: string;
}

export interface OrderDetail extends Omit<
  OrderRow,
  'phoneLast4' | 'areaName' | 'areaNameMl' | 'landmark'
> {
  customerPhone: string;
  address: {
    label: string;
    line: string;
    landmark: string;
    pincode: string;
    areaName: string;
    deliveryNote: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  subtotalPaise: number;
  deliveryChargePaise: number;
  depositPaise: number;
  note: string | null;
  items: {
    unitPricePaise: number;
    qtyOrdered: number;
    depositCans: number;
    depositPerCanPaise: number;
  }[];
  history: {
    from: OrderStatus | null;
    to: OrderStatus;
    actorRole: string;
    actorName: string | null;
    reason: string | null;
    at: string;
  }[];
}

export function quoteFor(o: OrderOptions, qty: number) {
  const depositCans = depositCansFor(qty, o.cansHeld, o.depositCoverCans);
  const rule = o.delivery ?? { chargePaise: 0, freeAboveCans: 0 };
  return {
    depositCans,
    ...priceOrder({
      qty,
      unitPricePaise: o.unitPricePaise,
      depositPerCanPaise: o.depositPerCanPaise,
      depositCans,
      deliveryChargePaise: deliveryChargeFor(qty, rule.chargePaise, rule.freeAboveCans),
    }),
  };
}

export const orderNo = (n: number) => `WD-${n}`;

export function dayLabel(t: TFunction, date: string, lang: string) {
  const today = istDate(new Date());
  const pretty = new Date(`${date}T00:00:00Z`).toLocaleDateString(
    lang === 'ml' ? 'ml-IN' : 'en-IN',
    {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    },
  );
  if (date === today) return t('orders.todayDate', { date: pretty });
  if (date === addDays(today, 1)) return t('orders.tomorrowDate', { date: pretty });
  return pretty;
}

export const windowName = (w: { nameEn: string; nameMl: string }, lang: string) =>
  lang === 'ml' ? w.nameMl : w.nameEn;

/** "Evening 15:00–19:00": office staff read 24-hour times quickly. */
export const windowText = (
  w: { nameEn: string; nameMl: string; startTime: string; endTime: string },
  lang: string,
) => `${windowName(w, lang)} ${w.startTime}–${w.endTime}`;
