import { compass } from '../lib/sectors';

/** Arrow pointing where the wind/swell travels to (the path points down = south at 0°, i.e. from north). */
export function Arrow({ deg, size = 22 }: { deg: number; size?: number }) {
  return (
    <svg class="arrow" viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={`from ${compass(deg)}`}>
      <g transform={`rotate(${deg} 12 12)`}>
        <path d="M12 3v16M6 13l6 7 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      </g>
    </svg>
  );
}
