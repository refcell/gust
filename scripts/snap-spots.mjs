// Moves the given spots to the nearest point (within ~2.5 km) whose elevation is <= 5 m, i.e. onto the shore.
// Usage: node scripts/snap-spots.mjs id1 id2 ...
import { readFileSync, writeFileSync } from 'node:fs';

const ids = process.argv.slice(2);
const spots = JSON.parse(readFileSync('data/spots.json', 'utf8'));
const STEP_M = 250;
const N = 12; // grid half-width in steps (~3 km)

async function elevations(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const c = points.slice(i, i + 100);
    const q = new URLSearchParams({ latitude: c.map((p) => p.lat.toFixed(5)).join(','), longitude: c.map((p) => p.lon.toFixed(5)).join(',') });
    let r;
    for (let attempt = 0; ; attempt++) {
      r = await fetch(`https://api.open-meteo.com/v1/elevation?${q}`);
      if (r.status !== 429 || attempt > 5) break;
      await new Promise((ok) => setTimeout(ok, 65_000)); // per-minute limit
    }
    if (!r.ok) throw new Error(`elevation ${r.status}`);
    out.push(...(await r.json()).elevation);
  }
  return out;
}

for (const id of ids) {
  const s = spots.find((x) => x.id === id);
  if (!s) {
    console.log(`skip ${id}: not found`);
    continue;
  }
  const dLat = STEP_M / 111320;
  const dLon = STEP_M / (111320 * Math.cos((s.lat * Math.PI) / 180));
  const grid = [];
  for (let y = -N; y <= N; y++) for (let x = -N; x <= N; x++) grid.push({ lat: s.lat + y * dLat, lon: s.lon + x * dLon, d: Math.hypot(x, y) });
  const el = await elevations(grid);
  // Nearest low point (0.5-5 m) with open water (elevation 0) in an adjacent cell: the shoreline.
  const W = 2 * N + 1;
  const cells = grid.map((g, i) => ({ ...g, e: el[i], i }));
  const seaNext = (i) => {
    const y = Math.floor(i / W), x = i % W;
    for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < W && xx >= 0 && xx < W && el[yy * W + xx] <= 0) return true;
    }
    return false;
  };
  const low = cells.filter((g) => g.e <= 5 && g.e >= 0.5 && seaNext(g.i)).sort((a, b) => a.d - b.d)[0];
  if (!low) {
    console.log(`skip ${id}: no shore point found`);
    continue;
  }
  console.log(`${id}: ${s.lat},${s.lon} -> ${low.lat.toFixed(5)},${low.lon.toFixed(5)} (${Math.round(low.d * STEP_M)} m, ${low.e} m elev)`);
  s.lat = Number(low.lat.toFixed(5));
  s.lon = Number(low.lon.toFixed(5));
}
writeFileSync('data/spots.json', '[\n' + spots.map((x) => '  ' + JSON.stringify(x)).join(',\n') + '\n]\n');
