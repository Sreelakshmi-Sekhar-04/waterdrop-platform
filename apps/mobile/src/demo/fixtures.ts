/**
 * DEMO DATA for Phase 2 screen previews only. Every value here is made up.
 * Real data replaces these when each feature is connected (Phases 3–6).
 * Prices follow the placeholder business values in docs/REQUIREMENTS-CHANGELOG.md Part 4.
 */
import type { OrderStatus } from '@wtrdrop/shared';

export const DEMO = true;

export const demoSettings = {
  pricePerCanPaise: 4000,
  depositPerCanPaise: 15000,
  maxCansPerOrder: 10,
  staffUndoWindowMinutes: 10,
};

export const demoCustomer = {
  name: 'Anitha',
  cansHeld: 2,
  depositCoverCans: 2,
  duePaise: 0,
  usualQty: 2,
  address: { label: 'Home', line: "Near St. Mary's Church, 2nd lane" },
};

export const demoSlots = [
  { value: 'today-eve', label: 'Today, 4–7 pm', earliest: true },
  { value: 'tom-morn', label: 'Tomorrow, 7–11 am', earliest: false },
  { value: 'tom-eve', label: 'Tomorrow, 4–7 pm', earliest: false },
] as const;

export interface DemoOrder {
  id: string;
  date: string;
  qty: number;
  totalPaise: number;
  status: OrderStatus;
}

export const demoOrders: DemoOrder[] = [
  { id: 'WD-1042', date: 'Today', qty: 2, totalPaise: 8000, status: 'ACCEPTED' },
  { id: 'WD-0988', date: 'Mon, 16 Nov', qty: 2, totalPaise: 8000, status: 'DELIVERED' },
  { id: 'WD-0951', date: 'Thu, 12 Nov', qty: 3, totalPaise: 12000, status: 'DELIVERED' },
  { id: 'WD-0907', date: 'Sun, 8 Nov', qty: 2, totalPaise: 8000, status: 'CANCELLED' },
];

export interface DemoStop {
  n: number;
  name: string;
  landmark: string;
  area: string;
  qty: number;
  cansHeld: number;
  depositCoverCans: number;
  duePaise: number;
  note?: string;
}

export const demoRoute = {
  done: 9,
  total: 24,
  cansOnVan: 31,
  pendingSync: 0,
  stops: [
    {
      n: 10,
      name: 'Rajan K.',
      landmark: 'Near Govt. LP School',
      area: 'Kakkanad',
      qty: 3,
      cansHeld: 2,
      depositCoverCans: 3,
      duePaise: 12000,
      note: 'Call before coming, gate is locked',
    },
    {
      n: 11,
      name: 'Meera S.',
      landmark: 'Opp. Milma booth',
      area: 'Kakkanad',
      qty: 2,
      cansHeld: 2,
      depositCoverCans: 2,
      duePaise: 0,
    },
    {
      n: 12,
      name: 'Green Valley Office',
      landmark: 'Infopark Phase 1, Gate 2',
      area: 'Infopark',
      qty: 6,
      cansHeld: 8,
      depositCoverCans: 8,
      duePaise: 0,
    },
  ] satisfies DemoStop[],
};

export function findStop(n: number): DemoStop | undefined {
  return demoRoute.stops.find((s) => s.n === n);
}
