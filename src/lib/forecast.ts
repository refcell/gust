import { scoreWind } from './score';
import type { Sector } from './sectors';
import type { Settings, WindSample } from './types';

export interface GoodWindow {
  start: string;
  end: string;
  hours: number;
  avgKn: number;
  maxGustKn: number;
}

/**
 * Find runs of consecutive "good" hours of at least `settings.minWindowHours`,
 * starting at or after `fromTime` (ISO local string, compared lexically like Open-Meteo times).
 */
export function goodWindows(hourly: readonly WindSample[], sectors: readonly Sector[] | undefined, settings: Settings, fromTime = ''): GoodWindow[] {
  const out: GoodWindow[] = [];
  let run: WindSample[] = [];
  const flush = () => {
    if (run.length >= settings.minWindowHours) {
      out.push({
        start: run[0].time,
        end: run[run.length - 1].time,
        hours: run.length,
        avgKn: run.reduce((a, w) => a + w.speedKn, 0) / run.length,
        maxGustKn: Math.max(...run.map((w) => w.gustKn)),
      });
    }
    run = [];
  };
  for (const w of hourly) {
    if (w.time < fromTime) continue;
    if (scoreWind(w, sectors, settings).rating === 'good') run.push(w);
    else flush();
  }
  flush();
  return out;
}

/** "Today 14:00", "Tomorrow 09:00", or "Sat 11:00" relative to `now` (both local ISO strings). */
export function relativeDay(iso: string, nowIso: string): string {
  const day = iso.slice(0, 10);
  const today = nowIso.slice(0, 10);
  const hm = iso.slice(11, 16);
  if (day === today) return `Today ${hm}`;
  const d = new Date(day + 'T00:00:00Z');
  const t = new Date(today + 'T00:00:00Z');
  const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
  if (diff === 1) return `Tomorrow ${hm}`;
  return `${d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${hm}`;
}
