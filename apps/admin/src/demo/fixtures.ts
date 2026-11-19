/**
 * DEMO DATA for Phase 2 page previews only. Every name, number and amount is made up.
 * Pages using it show a "Demo data" badge. Real data replaces it in Phases 4–7.
 * (Customers became real in Phase 3 and were removed from here.)
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
