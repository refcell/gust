import { useMemo, useState } from 'preact/hooks';
import { geocode, type GeocodeResult } from './data';
import type { Place, Spot } from '../lib/types';
import type { LatLon } from '../lib/geo';
import { searchSpots } from '../lib/spotsearch';

interface Props {
  places: Place[];
  onChange: (p: Place[]) => void;
  loc: LatLon | null;
  /** Bundled curated spots (null while loading), searched by name. */
  spots: readonly Spot[] | null;
  favorites: readonly string[];
  onFavorite: (spot: Spot, favorite: boolean) => void;
  /** Ids of spots currently shown in the Spots list. */
  listedIds: ReadonlySet<string>;
  onShow: (id: string) => void;
}

export function PlacesPanel({ places, onChange, loc, spots, favorites, onFavorite, listedIds, onShow }: Props) {
  const [q, setQ] = useState('');
  /** Last submitted search term; spot matches are derived from it. */
  const [spotTerm, setSpotTerm] = useState('');
  const spotMatches = useMemo(() => (spots && spotTerm ? searchSpots(spots, spotTerm) : []), [spots, spotTerm]);
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = (name: string, lat: number, lon: number) => {
    const id = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (places.some((p) => p.id === id)) return;
    onChange([...places, { id, name, lat, lon }]);
    setResults(null);
    setSpotTerm('');
    setQ('');
  };

  const search = async (e: Event) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    const m = term.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) {
      setSpotTerm('');
      add(`${Number(m[1]).toFixed(3)}, ${Number(m[2]).toFixed(3)}`, Number(m[1]), Number(m[2]));
      return;
    }
    setSpotTerm(term);
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
      {spotMatches.length > 0 && (
        <>
          <h3>Spots</h3>
          {spotMatches.some((sp) => !listedIds.has(sp.id)) && <p class="small muted">Spots not near you or a saved place appear in your list once you favourite them.</p>}
          <ul class="list" aria-label="Matching spots">
            {spotMatches.map((sp) => {
              const fav = favorites.includes(sp.id);
              const where = [sp.region, sp.country].filter(Boolean).join(', ');
              return (
                <li key={sp.id} class="row">
                  <span>
                    {sp.name}
                    {where && <span class="small muted"> · {where}</span>}
                  </span>
                  <span class="row-actions">
                    <button class="btn ghost small fav-btn" type="button" aria-pressed={fav} aria-label={`Favourite ${sp.name}`} onClick={() => onFavorite(sp, !fav)}>
                      <span aria-hidden="true">{fav ? '★' : '☆'}</span>
                    </button>
                    {listedIds.has(sp.id) && (
                      <button class="btn ghost small" type="button" aria-label={`Show ${sp.name}`} onClick={() => onShow(sp.id)}>
                        Show
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {err && <p class="notice">{err}</p>}
      {results && spotMatches.length > 0 && <h3>Places</h3>}
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
