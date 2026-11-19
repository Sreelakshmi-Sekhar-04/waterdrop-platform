import { Router } from 'express';
import { sql } from 'drizzle-orm';
import type { HealthResponse } from '@wtrdrop/shared';
import type { Database } from '../../db/client';

export function healthRoutes(db: Database, version: string): Router {
  const r = Router();
  r.get('/health', async (_req, res) => {
    let database: HealthResponse['database'] = 'ok';
    try {
      await db.execute(sql`select 1`);
    } catch {
      database = 'unavailable';
    }
    const body: HealthResponse = {
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      version,
      time: new Date().toISOString(),
    };
    res.status(database === 'ok' ? 200 : 503).json(body);
  });
  return r;
}
