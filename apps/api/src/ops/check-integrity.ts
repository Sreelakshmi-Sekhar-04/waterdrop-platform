/** CLI for the nightly data check. Prints one JSON line; exit code 1 when a problem is found. */
import { createDb } from '../db/client';
import { checkIntegrity } from './integrity';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}
const { db, close } = createDb(url);
checkIntegrity(db)
  .then(async (report) => {
    console.log(JSON.stringify(report));
    await close();
    process.exit(report.ok ? 0 : 1);
  })
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : 'integrity check failed');
    await close();
    process.exit(2);
  });
