// Checks that every English text has a Malayalam text and that both use the same {{placeholders}}.
// Run: node scripts/check-i18n.mjs  (also runs in CI)
import { readFileSync } from 'node:fs';

const APPS = ['apps/admin/src/i18n/locales', 'apps/mobile/src/i18n/locales'];
const flat = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]],
  );
// i18next plural forms (_one, _other) count as one key.
const base = (k) => k.replace(/_(zero|one|two|few|many|other)$/, '');
const vars = (s) =>
  [...String(s).matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

let problems = 0;
for (const dir of APPS) {
  const en = new Map(flat(JSON.parse(readFileSync(`${dir}/en.json`, 'utf8'))));
  const ml = new Map(flat(JSON.parse(readFileSync(`${dir}/ml.json`, 'utf8'))));
  const enBase = new Set([...en.keys()].map(base));
  const mlBase = new Set([...ml.keys()].map(base));
  const report = (msg) => {
    problems++;
    console.error(`${dir}: ${msg}`);
  };
  for (const k of enBase) if (!mlBase.has(k)) report(`missing in Malayalam: ${k}`);
  for (const k of mlBase) if (!enBase.has(k)) report(`only in Malayalam: ${k}`);
  for (const [k, v] of en) {
    if (String(v).trim() === '') report(`empty English text: ${k}`);
    const m = ml.get(k) ?? ml.get(`${base(k)}_other`);
    if (m !== undefined && vars(v) !== vars(m))
      report(`placeholders differ for ${k}: en {${vars(v)}} vs ml {${vars(m)}}`);
  }
  for (const [k, v] of ml) if (String(v).trim() === '') report(`empty Malayalam text: ${k}`);
  console.log(`${dir}: ${enBase.size} texts checked`);
}
if (problems) {
  console.error(`${problems} translation problem(s)`);
  process.exit(1);
}
console.log('Translations OK');
