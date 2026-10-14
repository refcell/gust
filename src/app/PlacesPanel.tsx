import { useState } from 'preact/hooks';
import { geocode, type GeocodeResult } from './data';
import type { Place } from '../lib/types';
import type { LatLon } from '../lib/geo';

interface Props {
  places: Place[];
  onChange: (p: Place[]) => void;
  loc: LatLon | null;
}

export function PlacesPanel({ places, onChange, loc }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = (name: string, lat: number, lon: number) => {
    const id = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (places.some((p) => p.id === id)) return;
    onChange([...places, { id, name, lat, lon }]);
    setResults(null);
    setQ('');
  };

  const search = async (e: Event) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    const m = term.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) {
      add(`${Number(m[1]).toFixed(3)}, ${Number(m[2]).toFixed(3)}`, Number(m[1]), Number(m[2]));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      setResults(await geocode(term));
    } catch {
      setErr('Search failed. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="panel" aria-labelledby="places-h">
      <h2 id="places-h">Places</h2>
      <p class="small muted">gust watches spots near your current location and near every saved place. Background alerts use saved places.</p>
      <form class="search" onSubmit={search} role="search">
        <label class="sr-only" for="place-q">
          Search a town or beach, or enter lat,lon
        </label>
        <input id="place-q" type="search" placeholder="Town, beach, or lat,lon" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
        <button class="btn" type="submit" disabled={busy}>
          Search
        </button>
      </form>
      {err && <p class="notice">{err}</p>}
      {results && (
        <ul class="list">
          {results.length === 0 && <li class="muted">No matches.</li>}
          {results.map((r) => (
            <li key={`${r.lat},${r.lon}`}>
              <button class="row-btn" onClick={() => add(r.name, r.lat, r.lon)}>
                <span>{r.name}</span>
                <span class="small muted">{r.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {loc && (
        <button class="btn ghost" onClick={() => add('Saved location', loc.lat, loc.lon)}>
          Save current location
        </button>
      )}
      <h3>Saved</h3>
      {places.length === 0 ? (
        <p class="muted small">No saved places yet.</p>
      ) : (
        <ul class="list">
          {places.map((p) => (
            <li key={p.id} class="row">
              <span>
                {p.name}
                <span class="small muted"> · {p.id}</span>
              </span>
              <button class="btn ghost small" onClick={() => onChange(places.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.name}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
