import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import {
  addDays,
  deliveryChargeFor,
  depositCansFor,
  istDate,
  priceOrder,
  type OrderStatus,
} from '@wtrdrop/shared';
import { api } from './api';

export interface WindowSlot {
  date: string;
  windowId: string;
  nameEn: string;
  nameMl: string;
  startTime: string;
  endTime: string;
  remainingCans: number;
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
  supportPhone: string | null;
  windows: WindowSlot[];
}

export interface OrderSummary {
  id: string;
  orderNo: number;
  status: OrderStatus;
  deliveryDate: string;
  windowNameEn: string;
  windowNameMl: string;
  windowStart: string;
  windowEnd: string;
  qty: number;
  totalPaise: number;
  createdAt: string;
  canCancel: boolean;
  address: { label: string; line: string; landmark: string; areaName: string };
}

export interface OrderDetail extends OrderSummary {
  subtotalPaise: number;
  deliveryChargePaise: number;
  depositPaise: number;
  note: string | null;
  items: { unitPricePaise: number; depositCans: number; depositPerCanPaise: number }[];
  history: { to: OrderStatus; at: string; reason: string | null }[];
}

export const ordersKey = ['customer', 'orders'] as const;
export const optionsKey = (addressId?: string | null) =>
  ['customer', 'order-options', addressId ?? 'default'] as const;

export function useOrderOptions(addressId?: string | null, enabled = true) {
  return useQuery({
    queryKey: optionsKey(addressId),
    enabled,
    queryFn: () =>
      api<OrderOptions>(
        `/customer/order-options${addressId ? `?addressId=${encodeURIComponent(addressId)}` : ''}`,
      ),
  });
}

export function useMyOrders(enabled = true) {
  return useQuery({
    queryKey: ordersKey,
    enabled,
    queryFn: async () => (await api<{ orders: OrderSummary[] }>('/customer/orders')).orders,
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: ['customer', 'order', id],
    enabled: !!id,
    queryFn: async () => (await api<{ order: OrderDetail }>(`/customer/orders/${id}`)).order,
  });
}

/** The same price the server will calculate (it checks the total the customer saw). */
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

/** "7 am", "3:30 pm"; in Malayalam the morning/evening word instead of am/pm. */
function clock(time: string, lang: string) {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const h12 = ((h + 11) % 12) + 1;
  const suffix = lang === 'ml' ? (h < 12 ? 'രാവിലെ' : 'വൈകിട്ട്') : h < 12 ? 'am' : 'pm';
  const mm = m ? `:${String(m).padStart(2, '0')}` : '';
  return `${h12}${mm} ${suffix}`;
}

/** "Today", "Tomorrow" or "Fri, 21 Nov". */
export function dayLabel(t: TFunction, date: string, lang: string, now = new Date()) {
  const today = istDate(now);
  if (date === today) return t('order.today');
  if (date === addDays(today, 1)) return t('order.tomorrow');
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(lang === 'ml' ? 'ml-IN' : 'en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** "Today, Evening (3 pm – 7 pm)". */
export function windowLabel(
  t: TFunction,
  w: Pick<WindowSlot, 'date' | 'nameEn' | 'nameMl' | 'startTime' | 'endTime'>,
  lang: string,
) {
  return t('order.windowLabel', {
    day: dayLabel(t, w.date, lang),
    name: lang === 'ml' ? w.nameMl : w.nameEn,
    from: clock(w.startTime, lang),
    to: clock(w.endTime, lang),
  });
}

export const orderNo = (n: number) => `WD-${n}`;
