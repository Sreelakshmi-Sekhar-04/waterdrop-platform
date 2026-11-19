/**
 * DEMO DATA for the delivery staff screens only (customer screens are real since Phase 4).
 * Every value here is made up. Real routes replace them in Phase 5.
 * Prices follow the placeholder business values in docs/REQUIREMENTS-CHANGELOG.md Part 4.
 */
export const DEMO = true;

export const demoSettings = {
  pricePerCanPaise: 4000,
  depositPerCanPaise: 15000,
  maxCansPerOrder: 10,
  staffUndoWindowMinutes: 10,
};

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
