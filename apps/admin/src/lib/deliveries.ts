import type { FailureReason, OrderStatus, PaymentMethod, TripStatus } from '@wtrdrop/shared';

/** Shapes returned by GET /admin/deliveries (see apps/api/src/modules/delivery). */
export interface AddressSnapshot {
  label: string;
  line: string;
  landmark: string;
  pincode: string;
  areaName: string;
  deliveryNote: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface Attempt {
  id: string;
  outcome: 'delivered' | 'failed';
  failureReason: FailureReason | null;
  fullDelivered: number;
  emptyCollected: number;
  extraEmpties: number;
  paymentMethod: PaymentMethod | null;
  amountCollectedPaise: number;
  overCreditLimit: boolean;
  note: string | null;
  recordedAt: string;
}

export interface Stop {
  orderId: string;
  orderNo: number;
  status: OrderStatus;
  seq: number | null;
  qty: number;
  totalPaise: number;
  address: AddressSnapshot;
  windowNameEn: string;
  windowNameMl: string;
  windowStart: string;
  windowEnd: string;
  customerId: string;
  customerName: string | null;
  phoneLast4: string;
  attempt: Attempt | null;
}

export interface Trip {
  id: string;
  staffUserId: string;
  date: string;
  status: TripStatus;
  loadFull: number | null;
  returnFull: number | null;
  returnEmpty: number | null;
  returnDamaged: number | null;
  cashHandedPaise: number | null;
  expectedFull: number | null;
  expectedEmpty: number | null;
  expectedCashPaise: number | null;
  endNote: string | null;
  reconcileNote: string | null;
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

export interface Route {
  trip: Trip;
  staffName: string | null;
  stops: Stop[];
  totals: Totals;
  differences: { full: number; empty: number; cashPaise: number } | null;
}

export interface Waiting {
  orderId: string;
  orderNo: number;
  status: OrderStatus;
  deliveryDate: string;
  qty: number;
  address: AddressSnapshot;
  customerName: string | null;
  windowNameEn: string;
  windowNameMl: string;
  windowStart: string;
  windowEnd: string;
  failure?: { reason: FailureReason | null; note: string | null; at: string } | null;
}

export interface OfficeDay {
  date: string;
  staff: { userId: string; name: string | null }[];
  routes: Route[];
  unassigned: Waiting[];
  toReschedule: Waiting[];
  toReconcile: { id: string; date: string; staffName: string | null }[];
}

export const windowOf = (w: {
  windowNameEn: string;
  windowNameMl: string;
  windowStart: string;
  windowEnd: string;
}) => ({
  nameEn: w.windowNameEn,
  nameMl: w.windowNameMl,
  startTime: w.windowStart,
  endTime: w.windowEnd,
});
