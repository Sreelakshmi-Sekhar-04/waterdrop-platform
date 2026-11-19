/**
 * DEMO DATA for Phase 2 page previews only. Every name, number and amount is made up.
 * Pages using it show a "Demo data" badge. Real data replaces it in Phases 5–7.
 * (Customers became real in Phase 3 and orders in Phase 4; both were removed from here.)
 */

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
