import { goodWindows, relativeDay } from '../lib/forecast';
import { RATING_LABEL, scoreWind, type Rating } from '../lib/score';
import { compass, describeSectors } from '../lib/sectors';
import type { Settings, Spot, SpotWind } from '../lib/types';
import { formatDistance, formatSpeed } from '../lib/units';

interface Props {
  spot: Spot;
  distanceKm: number;
  wind?: SpotWind;
  settings: Settings;
  open: boolean;
  onToggle: () => void;
}

export function SpotCard({ spot, distanceKm, wind, settings, open, onToggle }: Props) {
  const sc = wind ? scoreWind(wind.current, spot.sectors, settings) : null;
  const nowHour = wind ? wind.current.time.slice(0, 13) + ':00' : '';
  const next = wind ? goodWindows(wind.hourly, spot.sectors, settings, nowHour)[0] : undefined;
  const ongoing = next && next.start <= nowHour;
  const detailId = `spot-${spot.id}`;
  return (
    <li class={`spot r-${sc?.rating ?? 'none'}`}>
      <button class="spot-head" aria-expanded={open} aria-controls={detailId} onClick={onToggle}>
        <span class="spot-main">
          <span class="spot-name">{spot.name}</span>
          <span class="spot-sub muted small">
            {formatDistance(distanceKm)}
            {sc && ` · ${sc.reason}`}
            {sc?.direction === 'unknown' && ' · direction unknown'}
          </span>
          {next && (
            <span class="spot-next small">
              {ongoing && sc?.rating === 'good'
                ? `Good until ${endHour(next.end)}`
                : `Next good: ${relativeDay(next.start, wind!.current.time)}, ${next.hours}h`}
            </span>
          )}
        </span>
        <span class="spot-right">
          <span class="spot-wind">
            {wind ? (
              <>
                <Arrow deg={wind.current.dirDeg} />
                <span class="speed">
                  <strong>{formatSpeed(wind.current.speedKn, settings.unit, false)}</strong>
                  <span class="small muted">
                    {' '}
                    g{formatSpeed(wind.current.gustKn, settings.unit, false)}
                  </span>
                </span>
              </>
            ) : (
              <span class="muted small">–</span>
            )}
          </span>
          {sc && <Badge rating={sc.rating} />}
        </span>
      </button>
      {open && (
        <div class="spot-detail" id={detailId}>
          {wind && (
            <p class="small">
              Now {formatSpeed(wind.current.speedKn, settings.unit)}, gusts {formatSpeed(wind.current.gustKn, settings.unit)} from {compass(wind.current.dirDeg)} (
              {Math.round(wind.current.dirDeg)}°). Score {sc?.score}/100.
            </p>
          )}
          {wind && <Hourly wind={wind} spot={spot} settings={settings} />}
          <dl class="facts small">
            <dt>Rideable from</dt>
            <dd>{spot.sectors?.length ? describeSectors(spot.sectors) : 'Unknown — scored on speed only'}</dd>
            {spot.water && (
              <>
                <dt>Water</dt>
                <dd>{spot.water}</dd>
              </>
            )}
            {spot.level && (
              <>
                <dt>Level</dt>
                <dd>{spot.level}</dd>
              </>
            )}
            <dt>Source</dt>
            <dd>{spot.source === 'osm' ? 'OpenStreetMap' : 'gust curated list'}</dd>
          </dl>
          {spot.notes && <p class="small">{spot.notes}</p>}
          <p class="small">
            <a href={`https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}`} target="_blank" rel="noopener">
              Open in Maps
            </a>
          </p>
        </div>
      )}
    </li>
  );
}

export function Badge({ rating }: { rating: Rating }) {
  return <span class={`badge b-${rating}`}>{RATING_LABEL[rating]}</span>;
}

/** Arrow pointing where the wind blows to (the path points down = south at 0°, i.e. wind from north). */
function Arrow({ deg }: { deg: number }) {
  return (
    <svg class="arrow" viewBox="0 0 24 24" width="22" height="22" role="img" aria-label={`from ${compass(deg)}`}>
      <g transform={`rotate(${deg} 12 12)`}>
        <path d="M12 3v16M6 13l6 7 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      </g>
    </svg>
  );
}

function Hourly({ wind, spot, settings }: { wind: SpotWind; spot: Spot; settings: Settings }) {
  const nowHour = wind.current.time.slice(0, 13);
  const start = Math.max(
    0,
    wind.hourly.findIndex((h) => h.time.slice(0, 13) >= nowHour),
  );
  const hours = wind.hourly.slice(start, start + 48);
  const max = Math.max(settings.maxGustKn, ...hours.map((h) => h.gustKn));
  return (
    <figure class="hourly">
      <div class="bars" role="img" aria-label="Wind for the next 48 hours (table follows)">
        {hours.map((h) => {
          const r = scoreWind(h, spot.sectors, settings).rating;
          return (
            <div class="bar-col" key={h.time} title={`${h.time.slice(5, 16).replace('T', ' ')} · ${formatSpeed(h.speedKn, settings.unit)} g${formatSpeed(h.gustKn, settings.unit, false)} ${compass(h.dirDeg)}`}>
              <div class="gust" style={{ height: `${(h.gustKn / max) * 100}%` }} />
              <div class={`bar b-${r}`} style={{ height: `${(h.speedKn / max) * 100}%` }} />
              {(h.time.endsWith('T00:00') || h.time.endsWith('T12:00')) && (
                <span class="tick" aria-hidden="true">
                  {h.time.endsWith('T00:00') ? weekday(h.time) : '12'}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <table class="sr-only">
        <caption>Hourly wind, every 3 hours</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Wind</th>
            <th scope="col">Gust</th>
            <th scope="col">From</th>
            <th scope="col">Rating</th>
          </tr>
        </thead>
        <tbody>
          {hours
            .filter((_, i) => i % 3 === 0)
            .map((h) => (
              <tr key={h.time}>
                <td>{relativeDay(h.time, wind.current.time)}</td>
                <td>{formatSpeed(h.speedKn, settings.unit)}</td>
                <td>{formatSpeed(h.gustKn, settings.unit)}</td>
                <td>{compass(h.dirDeg)}</td>
                <td>{RATING_LABEL[scoreWind(h, spot.sectors, settings).rating]}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <figcaption class="small muted">
        Next 48 h from {hours[0] && relativeDay(hours[0].time, wind.current.time)}. Bars show wind, lines show gusts.
      </figcaption>
    </figure>
  );
}

function weekday(iso: string): string {
  return new Date(iso.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

/** The hour after the last good hour, e.g. "2026-06-01T17:00" -> "18:00". */
function endHour(lastGood: string): string {
  const h = (Number(lastGood.slice(11, 13)) + 1) % 24;
  return `${String(h).padStart(2, '0')}:00`;
}
