/**
 * DEMO DATA for Phase 2 page previews only. Every name, number and amount is made up.
 * Pages using it show a "Demo data" badge. Real data replaces it in Phases 4–7.
 */
import type { OrderStatus } from '@wtrdrop/shared';

export const demoAttention = [
  { id: 'unassigned', count: '12', tone: 'neutral', action: 'assign' },
  { id: 'failed', count: '2', tone: 'warning', action: 'reschedule' },
  { id: 'cashShort', count: '₹300', tone: 'warning', action: 'review' },
  { id: 'complaint', count: '1', tone: 'neutral', action: 'open' },
] as const;

export const demoStats = [
  { id: 'orders', value: 142, money: false, tone: 'neutral' },
  { id: 'delivered', value: 96, money: false, tone: 'success' },
  {
    id: 'collected',
    value: 768000,
    money: true,
    tone: 'neutral',
    breakdown: { cash: 412000, upi: 356000 },
  },
  { id: 'due', value: 1240000, money: true, tone: 'warning' },
  { id: 'cansOut', value: 1032, money: false, tone: 'neutral' },
  { id: 'fullAtPlant', value: 184, money: false, tone: 'neutral' },
] as const;

export const demoDrivers = [
  { name: 'Ravi', area: 'Kakkanad', done: 9, total: 24, cashPaise: 148000, closed: false },
  { name: 'Suresh', area: 'Edappally', done: 21, total: 21, cashPaise: 264000, closed: true },
];

export interface DemoOrderRow {
  id: string;
  customer: string;
  phoneLast4: string;
  area: string;
  qty: number;
  slot: string;
  status: OrderStatus;
  driver: string | null;
  channel: 'app' | 'phone';
}

export const demoOrders: DemoOrderRow[] = [
  {
    id: 'WD-1051',
    customer: 'Anitha R.',
    phoneLast4: '2345',
    area: 'Kakkanad',
    qty: 2,
    slot: 'Today 4–7 pm',
    status: 'ACCEPTED',
    driver: null,
    channel: 'app',
  },
  {
    id: 'WD-1050',
    customer: 'Green Valley Office',
    phoneLast4: '9012',
    area: 'Infopark',
    qty: 6,
    slot: 'Today 4–7 pm',
    status: 'ACCEPTED',
    driver: null,
    channel: 'phone',
  },
  {
    id: 'WD-1049',
    customer: 'Rajan K.',
    phoneLast4: '7781',
    area: 'Kakkanad',
    qty: 3,
    slot: 'Today 4–7 pm',
    status: 'OUT_FOR_DELIVERY',
    driver: 'Ravi',
    channel: 'app',
  },
  {
    id: 'WD-1048',
    customer: 'Meera S.',
    phoneLast4: '4410',
    area: 'Kakkanad',
    qty: 2,
    slot: 'Today 4–7 pm',
    status: 'OUT_FOR_DELIVERY',
    driver: 'Ravi',
    channel: 'app',
  },
  {
    id: 'WD-1047',
    customer: 'Thomas P.',
    phoneLast4: '1209',
    area: 'Edappally',
    qty: 1,
    slot: 'Today 7–11 am',
    status: 'RESCHEDULE_PENDING',
    driver: null,
    channel: 'app',
  },
  {
    id: 'WD-1046',
    customer: 'Lakshmi Stores',
    phoneLast4: '6623',
    area: 'Edappally',
    qty: 4,
    slot: 'Today 7–11 am',
    status: 'DELIVERED',
    driver: 'Suresh',
    channel: 'phone',
  },
  {
    id: 'WD-1045',
    customer: 'Fathima N.',
    phoneLast4: '8890',
    area: 'Edappally',
    qty: 2,
    slot: 'Today 7–11 am',
    status: 'CANCELLED',
    driver: null,
    channel: 'app',
  },
];

export interface DemoCustomer {
  id: string;
  name: string;
  phoneLast4: string;
  area: string;
  type: 'household' | 'office' | 'shop';
  cansHeld: number;
  depositCans: number;
  duePaise: number;
  lastOrder: string;
}

export const demoCustomers: DemoCustomer[] = [
  {
    id: 'c1',
    name: 'Anitha R.',
    phoneLast4: '2345',
    area: 'Kakkanad',
    type: 'household',
    cansHeld: 2,
    depositCans: 2,
    duePaise: 0,
    lastOrder: 'Today',
  },
  {
    id: 'c2',
    name: 'Rajan K.',
    phoneLast4: '7781',
    area: 'Kakkanad',
    type: 'household',
    cansHeld: 2,
    depositCans: 3,
    duePaise: 12000,
    lastOrder: 'Today',
  },
  {
    id: 'c3',
    name: 'Green Valley Office',
    phoneLast4: '9012',
    area: 'Infopark',
    type: 'office',
    cansHeld: 8,
    depositCans: 8,
    duePaise: 384000,
    lastOrder: 'Today',
  },
  {
    id: 'c4',
    name: 'Lakshmi Stores',
    phoneLast4: '6623',
    area: 'Edappally',
    type: 'shop',
    cansHeld: 6,
    depositCans: 4,
    duePaise: 0,
    lastOrder: 'Today',
  },
  {
    id: 'c5',
    name: 'Thomas P.',
    phoneLast4: '1209',
    area: 'Edappally',
    type: 'household',
    cansHeld: 3,
    depositCans: 2,
    duePaise: 8000,
    lastOrder: '45 days ago',
  },
];

/** Can ledger for Rajan K. Corrections are new entries; nothing is edited. */
export const demoLedger = [
  {
    id: 1,
    date: '1 Nov',
    type: 'opening',
    delta: 2,
    by: 'Owner',
    note: 'Opening balance at go-live',
    reversesId: null,
  },
  {
    id: 2,
    date: '5 Nov',
    type: 'delivery',
    delta: 2,
    by: 'Ravi',
    note: 'WD-0921: 2 full',
    reversesId: null,
  },
  {
    id: 3,
    date: '5 Nov',
    type: 'return',
    delta: -1,
    by: 'Ravi',
    note: 'WD-0921: 1 empty',
    reversesId: null,
  },
  {
    id: 4,
    date: '6 Nov',
    type: 'reversal',
    delta: 1,
    by: 'Owner',
    note: 'Wrong count: customer returned 2',
    reversesId: 3,
  },
  {
    id: 5,
    date: '6 Nov',
    type: 'return',
    delta: -2,
    by: 'Owner',
    note: 'Corrected: 2 empties on 5 Nov',
    reversesId: null,
  },
] as const;
