// Merge data/new-*.json into data/spots.json: validate, drop duplicates (id or within 1.5 km), keep one object per line.
// Usage: node scripts/merge-spots.mjs [--keep]
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';

const R = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
const dist = (a, b) => {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};
const width = (sectors) => sectors.reduce((acc, [a, b]) => acc + ((((b - a) % 360) + 360) % 360 || (b !== a ? 360 : 0)), 0);
const KEYS = ['id', 'name', 'lat', 'lon', 'country', 'region', 'sectors', 'water', 'level', 'notes'];

const spots = JSON.parse(readFileSync('data/spots.json', 'utf8'));
const files = readdirSync('data').filter((f) => /^new-.*\.json$/.test(f));
const report = { added: 0, dupId: [], dupNear: [], invalid: [] };

function validate(s) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id ?? '')) return 'bad id';
  if (typeof s.name !== 'string' || !s.name) return 'no name';
  if (!(Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180)) return 'coords';
  if (!/^[A-Z]{2}$/.test(s.country ?? '')) return 'country';
  if (!Array.isArray(s.sectors) || !s.sectors.every((x) => Array.isArray(x) && x.length === 2 && x.every((d) => d >= 0 && d <= 360))) return 'sectors';
  const any = s.sectors.some(([a, b]) => b - a >= 360);
  if (any && !/^Any direction/.test(s.notes ?? '')) return 'any-direction without note';
  if (!any && width(s.sectors) > 220) return `sector width ${width(s.sectors)}`;
  if (s.notes && s.notes.length > 140) return 'notes too long';
  if (['US', 'CA', 'MX', 'BR', 'AR', 'CL', 'PE', 'CO', 'VE', 'UY'].includes(s.country) && s.lon > 0) return 'positive longitude in the Americas';
  return null;
}

for (const f of files) {
  for (const s of JSON.parse(readFileSync(`data/${f}`, 'utf8'))) {
    const err = validate(s);
    if (err) {
      report.invalid.push(`${s.id}: ${err}`);
      continue;
    }
    if (spots.some((x) => x.id === s.id)) {
      report.dupId.push(s.id);
      continue;
    }
    const near = spots.find((x) => dist(x, s) < 1.5);
    if (near) {
      report.dupNear.push(`${s.id}~${near.id}`);
      continue;
    }
    const clean = {};
    for (const k of KEYS) if (s[k] !== undefined) clean[k] = s[k];
    spots.push(clean);
    report.added++;
  }
}

writeFileSync('data/spots.json', '[\n' + spots.map((s) => '  ' + JSON.stringify(s)).join(',\n') + '\n]\n');
if (!process.argv.includes('--keep')) for (const f of files) unlinkSync(`data/${f}`);
console.log(JSON.stringify({ files, total: spots.length, ...report }, null, 2));
