// Flags curated spots whose coordinates look wrong: coastal spots well above sea level are probably inland.
// Uses the Open-Meteo elevation API (no key, 100 points per call). Usage: node scripts/check-spots.mjs [maxMeters]
import { readFileSync } from 'node:fs';

const MAX = Number(process.argv[2] ?? 25);
const spots = JSON.parse(readFileSync('data/spots.json', 'utf8'));
const inland = /lake|reservoir|river|dam|lago|lac\b|see\b|forebay|basin|delta|gorge|salton/i;
const flagged = [];
for (let i = 0; i < spots.length; i += 100) {
  const chunk = spots.slice(i, i + 100);
  const q = new URLSearchParams({ latitude: chunk.map((s) => s.lat).join(','), longitude: chunk.map((s) => s.lon).join(',') });
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`https://api.open-meteo.com/v1/elevation?${q}`).catch((e) => ({ ok: false, status: `network (${e.cause?.code ?? e.message})` }));
    if (res.ok || attempt >= 6) break; // retry rate limits, server errors and network failures
    console.error(`${res.status}, waiting 65 s (attempt ${attempt + 1})`);
    await new Promise((ok) => setTimeout(ok, 65_000));
  }
  if (!res.ok) throw new Error(`elevation ${res.status}`);
  const { elevation } = await res.json();
  chunk.forEach((s, j) => {
    const e = elevation[j];
    const lakeLike = inland.test(s.name + ' ' + (s.notes ?? ''));
    if (!lakeLike && e > MAX) flagged.push({ id: s.id, elevation: e, lat: s.lat, lon: s.lon });
  });
}
console.log(`${spots.length} spots checked, ${flagged.length} coastal spots above ${MAX} m:`);
for (const f of flagged.sort((a, b) => b.elevation - a.elevation)) console.log(`  ${f.id}\t${f.elevation} m\t${f.lat},${f.lon}`);
