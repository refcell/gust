import { arrowClass, arrowTransform, compassLabel, compassSectorPaths, polarToXY } from '../lib/compass';
import type { Rating } from '../lib/score';
import type { Sector } from '../lib/sectors';

const R = 40;
const TICKS = [0, 90, 180, 270];
const ARROW = 'M0 -30V28M-8 18L0 29L8 18';

/** Compass rose with the spot's rideable sectors and an arrow for where the wind blows to. */
export function Compass({ sectors, dirDeg, rating }: { sectors: readonly Sector[]; dirDeg?: number; rating?: Rating }) {
  const transform = arrowTransform(dirDeg);
  return (
    <svg class="compass" viewBox="-50 -50 100 100" width="80" height="80" role="img" aria-label={compassLabel(sectors, dirDeg)}>
      <g aria-hidden="true">
        {compassSectorPaths(sectors, R).map((d, i) => (
          <path key={i} class="compass-sector" d={d} />
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
        {transform && (
          <g class={arrowClass(rating)} transform={transform}>
            <path class="compass-arrow-halo" d={ARROW} />
            <path d={ARROW} />
          </g>
        )}
      </g>
    </svg>
  );
}
