import { polarToXY, sectorArcPath, isFullCircle } from '../lib/compass';
import type { Rating } from '../lib/score';
import { compass, type Sector } from '../lib/sectors';

const R = 40;
const TICKS = [0, 90, 180, 270];

function describe(sectors: readonly Sector[]): string {
  if (sectors.length === 0) return 'rideable directions unknown';
  if (sectors.some(isFullCircle)) return 'rideable from any direction';
  return `rideable from ${sectors.map(([a, b]) => (compass(a) === compass(b) ? compass(a) : `${compass(a)} to ${compass(b)}`)).join(' and ')}`;
}

/** Compass rose with the spot's rideable sectors and an arrow for where the wind blows to. */
export function Compass({ sectors, dirDeg, rating }: { sectors: readonly Sector[]; dirDeg?: number; rating?: Rating }) {
  const hasWind = dirDeg !== undefined && Number.isFinite(dirDeg);
  const wind = hasWind ? `Wind from ${compass(dirDeg)} (${Math.round(dirDeg)}°); ` : '';
  const label = wind + describe(sectors);
  return (
    <svg class="compass" viewBox="-50 -50 100 100" width="80" height="80" role="img" aria-label={label.charAt(0).toUpperCase() + label.slice(1)}>
      <g aria-hidden="true">
        {sectors.map(([a, b]) => (
          <path key={`${a}-${b}`} class="compass-sector" d={sectorArcPath(a, b, R)} />
        ))}
        <circle class={sectors.length ? 'compass-ring' : 'compass-ring unknown'} r={R} />
        {TICKS.map((t) => {
          const p1 = polarToXY(t, R - 5);
          const p2 = polarToXY(t, R);
          return <line key={t} class="compass-tick" x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} />;
        })}
        <text class="compass-n" x="0" y="-27" text-anchor="middle" dominant-baseline="middle">
          N
        </text>
        {hasWind && (
          <g class={`compass-arrow b-${rating ?? 'none'}`} transform={`rotate(${Math.round(dirDeg)})`}>
            <path d="M0 -30V28M-8 18L0 29L8 18" />
          </g>
        )}
      </g>
    </svg>
  );
}
