import { useEffect, useState } from 'preact/hooks';
import { formatWaterTemp, formatWaveHeight, localClock, marineNow, wetsuitHint, type MarineData } from '../lib/marine';
import { compass } from '../lib/sectors';
import type { Spot } from '../lib/types';
import type { SpeedUnit } from '../lib/units';
import { Arrow } from './Arrow';
import { loadMarine } from './marineCache';

/**
 * Waves, water temperature and tide for an expanded spot. Mounted only while the detail is open,
 * so the request is lazy; renders nothing while loading, on errors, and for inland spots.
 */
export function Marine({ spot, unit }: { spot: Spot; unit: SpeedUnit }) {
  const [state, setState] = useState<{ id: string; data: MarineData | null } | null>(null);
  useEffect(() => {
    let live = true;
    loadMarine(spot.id, spot.lat, spot.lon).then(
      (data) => live && setState({ id: spot.id, data }),
      () => live && setState({ id: spot.id, data: null }),
    );
    return () => {
      live = false;
    };
  }, [spot.id, spot.lat, spot.lon]);

  const m = state?.id === spot.id ? marineNow(state.data) : null;
  if (!m) return null;
  return (
    <dl class="facts small marine" aria-label="Marine conditions">
      {m.waveM != null && (
        <>
          <dt>Waves</dt>
          <dd>
            {formatWaveHeight(m.waveM, unit)}
            {m.periodS != null && ` at ${Math.round(m.periodS)} s`}
            {m.waveDirDeg != null && (
              <>
                {` from ${compass(m.waveDirDeg)} `}
                <span class="marine-arrow" aria-hidden="true">
                  <Arrow deg={m.waveDirDeg} size={16} />
                </span>
              </>
            )}
          </dd>
        </>
      )}
      {m.seaTempC != null && (
        <>
          <dt>Water temp</dt>
          <dd>
            {formatWaterTemp(m.seaTempC, unit)} · {wetsuitHint(m.seaTempC)} <span class="muted">(rough guide)</span>
          </dd>
        </>
      )}
      {m.tide && (
        <>
          <dt>Tide</dt>
          <dd>
            {m.tide.trend === 'rising' ? 'Rising' : 'Falling'}
            {m.tide.next && ` · ${m.tide.next.kind} ${localClock(m.tide.next.time)}`}
          </dd>
        </>
      )}
    </dl>
  );
}
