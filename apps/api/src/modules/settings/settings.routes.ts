import { Router } from 'express';
import type { Database } from '../../db/client';
import { requireRole, tenant } from '../../middleware/auth';
import { idempotency } from '../../middleware/idempotency';
import { parse } from '../../middleware/validate';
import { settingsPatchSchema } from './settings.schema';
import { getSettings, updateSettings } from './settings.service';

export function settingsRoutes(db: Database): Router {
  const r = Router();
  r.get('/admin/settings', requireRole('admin', 'owner'), async (req, res) => {
    res.json({ settings: await getSettings(db, tenant(req)) });
  });
  // Only the owner changes business settings (Phase 0 analysis §11).
  r.patch('/admin/settings', requireRole('owner'), idempotency(db), async (req, res) => {
    const patch = parse(settingsPatchSchema, req.body);
    res.json({ settings: await updateSettings(db, tenant(req), patch) });
  });
  return r;
}
