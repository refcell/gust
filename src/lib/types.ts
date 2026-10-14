import type { Sector } from './sectors';
import type { SpeedUnit } from './units';

export interface Spot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  country?: string;
  region?: string;
  /** Rideable wind-from sectors. Empty or missing = unknown. */
  sectors?: Sector[];
  water?: 'flat' | 'chop' | 'waves' | 'mixed';
  level?: 'beginner' | 'intermediate' | 'advanced' | 'all';
  notes?: string;
  /** Where the spot came from. */
  source?: 'curated' | 'osm';
  /** For OSM spots: how the sectors were obtained. */
  sectorSource?: 'curated' | 'coastline' | 'unknown';
}

export interface Settings {
  /** Lower bound of the wind window, knots. */
  minKn: number;
  /** Upper bound of the wind window, knots. */
  maxKn: number;
  /** Maximum acceptable gusts, knots. */
  maxGustKn: number;
  unit: SpeedUnit;
  radiusKm: number;
  /** Forecast "good window ahead" alerts. */
  forecastAlerts: boolean;
  /** Minimum consecutive good hours for a forecast window. */
  minWindowHours: number;
  /** Spot ids that never send notifications. */
  muted?: string[];
  /** Favourite spot ids: listed first, always shown and watched (even outside the radius). */
  favorites?: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  minKn: 15,
  maxKn: 30,
  maxGustKn: 35,
  unit: 'kn',
  radiusKm: 50,
  forecastAlerts: true,
  minWindowHours: 2,
};

export interface WindSample {
  /** ISO local time (Open-Meteo timezone=auto) */
  time: string;
  speedKn: number;
  gustKn: number;
  dirDeg: number;
}

export interface SpotWind {
  current: WindSample;
  hourly: WindSample[];
  /** UTC offset of the spot in seconds. */
  utcOffsetSeconds: number;
  /** IANA time zone of the spot (Open-Meteo `timezone`), when known. */
  timezone?: string;
  /** When this was fetched from the network (ms epoch). */
  fetchedAt: number;
  /** Epoch ms of the `current` sample, derived from its local time and the UTC offset. */
  observedAt: number;
}

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
}
