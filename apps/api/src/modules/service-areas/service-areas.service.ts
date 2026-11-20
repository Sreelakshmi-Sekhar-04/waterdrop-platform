import { and, arrayOverlaps, asc, eq, ne } from 'drizzle-orm';
import type { ServiceAreaInput } from '@wtrdrop/shared';
import type { Database, DbOrTx } from '../../db/client';
import { serviceAreas } from '../../db/schema';
import { AppError, errors } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import type { TenantContext } from '../../lib/context';

const columns = {
  id: serviceAreas.id,
  name: serviceAreas.name,
  nameMl: serviceAreas.nameMl,
  pincodes: serviceAreas.pincodes,
  deliveryChargePaise: serviceAreas.deliveryChargePaise,
  freeAboveCans: serviceAreas.freeAboveCans,
  status: serviceAreas.status,
};

export async function listServiceAreas(db: Database, supplierId: string, activeOnly: boolean) {
  return db
    .select(columns)
    .from(serviceAreas)
    .where(
      activeOnly
        ? and(eq(serviceAreas.supplierId, supplierId), eq(serviceAreas.status, 'active'))
        : eq(serviceAreas.supplierId, supplierId),
    )
    .orderBy(asc(serviceAreas.name));
}

/** The active area that delivers to this PIN code, or an error the app can show plainly. */
export async function areaForPincode(db: DbOrTx, supplierId: string, pincode: string) {
  const [a] = await db
    .select({ id: serviceAreas.id, name: serviceAreas.name })
    .from(serviceAreas)
    .where(
      and(
        eq(serviceAreas.supplierId, supplierId),
        eq(serviceAreas.status, 'active'),
        arrayOverlaps(serviceAreas.pincodes, [pincode]),
      ),
    )
    .limit(1);
  if (!a) {
    throw new AppError(
      422,
      'OUTSIDE_SERVICE_AREA',
      'Sorry, we do not deliver to this PIN code yet.',
      { pincode },
    );
  }
  return a;
}

async function assertPincodesFree(
  db: DbOrTx,
  supplierId: string,
  pincodes: string[],
  exceptId?: string,
) {
  const clash = await db
    .select({ name: serviceAreas.name, pincodes: serviceAreas.pincodes })
    .from(serviceAreas)
    .where(
      and(
        eq(serviceAreas.supplierId, supplierId),
        eq(serviceAreas.status, 'active'),
        arrayOverlaps(serviceAreas.pincodes, pincodes),
        exceptId ? ne(serviceAreas.id, exceptId) : undefined,
      ),
    );
  if (clash.length) {
    const taken = pincodes.filter((p) => clash.some((c) => c.pincodes.includes(p)));
    throw new AppError(409, 'PINCODE_IN_OTHER_AREA', 'A PIN code is already in another area.', {
      pincodes: taken,
      area: clash[0]!.name,
    });
  }
}

export async function createServiceArea(db: Database, ctx: TenantContext, input: ServiceAreaInput) {
  const pincodes = [...new Set(input.pincodes)];
  return db.transaction(async (tx) => {
    await assertPincodesFree(tx, ctx.supplierId, pincodes);
    const [row] = await tx
      .insert(serviceAreas)
      .values({
        supplierId: ctx.supplierId,
        name: input.name,
        nameMl: input.nameMl ?? null,
        pincodes,
        deliveryChargePaise: input.deliveryChargePaise ?? null,
        freeAboveCans: input.freeAboveCans ?? null,
      })
      .onConflictDoNothing()
      .returning(columns);
    if (!row) throw errors.conflict('AREA_NAME_TAKEN', 'An area with this name already exists.');
    await recordAudit(tx, ctx, {
      action: 'service_area.created',
      entityType: 'service_area',
      entityId: row.id,
      after: row,
    });
    return row;
  });
}

export async function updateServiceArea(
  db: Database,
  ctx: TenantContext,
  id: string,
  input: Partial<ServiceAreaInput>,
) {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select(columns)
      .from(serviceAreas)
      .where(and(eq(serviceAreas.id, id), eq(serviceAreas.supplierId, ctx.supplierId)))
      .for('update');
    if (!before) throw errors.notFound('Area');
    const pincodes = input.pincodes ? [...new Set(input.pincodes)] : before.pincodes;
    if ((input.status ?? before.status) === 'active')
      await assertPincodesFree(tx, ctx.supplierId, pincodes, id);
    const [after] = await tx
      .update(serviceAreas)
      .set({
        name: input.name ?? before.name,
        nameMl: input.nameMl === undefined ? before.nameMl : input.nameMl,
        pincodes,
        deliveryChargePaise:
          input.deliveryChargePaise === undefined
            ? before.deliveryChargePaise
            : input.deliveryChargePaise,
        freeAboveCans:
          input.freeAboveCans === undefined ? before.freeAboveCans : input.freeAboveCans,
        status: input.status ?? before.status,
        updatedAt: new Date(),
      })
      .where(eq(serviceAreas.id, id))
      .returning(columns);
    await recordAudit(tx, ctx, {
      action: 'service_area.updated',
      entityType: 'service_area',
      entityId: id,
      before,
      after,
    });
    return after!;
  });
}
