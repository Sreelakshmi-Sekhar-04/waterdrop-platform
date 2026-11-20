import { useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FailureReason, OrderStatus, PaymentMethod } from '@wtrdrop/shared';
import { api } from './api';
import { setOnSent, type QueuedAction } from './outbox';
import { router } from 'expo-router';

export interface Attempt {
  id: string;
  outcome: 'delivered' | 'failed';
  failureReason: FailureReason | null;
  fullDelivered: number;
  emptyCollected: number;
  extraEmpties: number;
  chargePaise: number;
  depositPaise: number;
  paymentMethod: PaymentMethod | null;
  amountCollectedPaise: number;
  recordedAt: string;
}

export interface Stop {
  orderId: string;
  orderNo: number;
  status: OrderStatus;
  seq: number | null;
  qty: number;
  totalPaise: number;
  deliveryChargePaise: number;
  note: string | null;
  address: {
    label: string;
    line: string;
    landmark: string;
    areaName: string;
    deliveryNote: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  windowNameEn: string;
  windowNameMl: string;
  windowStart: string;
  windowEnd: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string;
  cansHeld: number;
  depositCoverCans: number;
  balancePaise: number;
  unitPricePaise: number;
  depositPerCanPaise: number;
  attempt: Attempt | null;
  canUndo: boolean;
  /** Saved on the phone, not yet sent (offline). */
  pending?: 'deliver' | 'not-delivered';
}

export interface Trip {
  id: string;
  date: string;
  status: 'planned' | 'on_route' | 'ended' | 'reconciled';
  loadFull: number | null;
}

export interface Totals {
  stops: number;
  done: number;
  left: number;
  plannedLoad: number;
  fullDelivered: number;
  emptiesCollected: number;
  cashPaise: number;
  upiPaise: number;
  laterPaise: number;
  fullOnVan: number | null;
}

export interface StaffDay {
  date: string;
  trip: Trip | null;
  stops: Stop[];
  totals: Totals | null;
  undoMinutes: number;
}

export const staffDayKey = ['staff', 'day'] as const;
const CACHE = 'wtrdrop.staffDay';

/**
 * Today's route. The last copy is kept on the phone, so the route still opens with no signal
 * (Phase 0 §5.1 "the day's route is cached on the phone").
 */
export function useStaffDay() {
  const qc = useQueryClient();
  setOnSent(() => void qc.invalidateQueries({ queryKey: staffDayKey }));
  return useQuery({
    queryKey: staffDayKey,
    queryFn: async () => {
      try {
        const d = await api<StaffDay>('/staff/day');
        await AsyncStorage.setItem(CACHE, JSON.stringify(d)).catch(() => undefined);
        return d;
      } catch (e) {
        const cached = await AsyncStorage.getItem(CACHE).catch(() => null);
        if (cached) return { ...(JSON.parse(cached) as StaffDay), offline: true };
        throw e;
      }
    },
    refetchInterval: 60_000,
  });
}

export async function clearStaffCache() {
  await AsyncStorage.removeItem(CACHE).catch(() => undefined);
}

const OPEN: OrderStatus[] = ['ASSIGNED', 'OUT_FOR_DELIVERY'];

/** The route as the delivery person should see it: the server's copy plus actions not yet sent. */
export function withPending(day: StaffDay, queue: QueuedAction[]): StaffDay {
  if (!day.trip) return day;
  const started = queue.some((a) => a.kind === 'start');
  const ended = queue.some((a) => a.kind === 'end');
  const stops = day.stops.map((s) => {
    const q = queue.find(
      (a) => a.orderId === s.orderId && (a.kind === 'deliver' || a.kind === 'not-delivered'),
    );
    return q && OPEN.includes(s.status)
      ? { ...s, pending: q.kind as 'deliver' | 'not-delivered' }
      : s;
  });
  return {
    ...day,
    trip: {
      ...day.trip,
      status: ended
        ? 'ended'
        : started && day.trip.status === 'planned'
          ? 'on_route'
          : day.trip.status,
    },
    stops,
  };
}

export const isOpen = (s: Stop) => OPEN.includes(s.status) && !s.pending;

/** Map hand-off (Phase 0 §2B: no in-app navigation). Uses the saved pin, else the address text. */
export function mapUrl(s: Stop) {
  const a = s.address;
  if (a.latitude !== null && a.longitude !== null)
    return `https://www.google.com/maps/search/?api=1&query=${a.latitude},${a.longitude}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${a.line}, ${a.landmark}, ${a.areaName}`,
  )}`;
}

/** Back to the route screen without stacking a second copy of it. */
export function backToRoute() {
  if (router.canGoBack()) router.back();
  else router.replace('/(staff)/route');
}
