import { describe, expect, it } from 'vitest';
import { currentIndex, formatWaterTemp, formatWaveHeight, marineNow, marineUrl, parseMarine, tideExtremes, tideInfo, wetsuitHint } from '../src/lib/marine';

const OFFSET = 3600; // UTC+1
const T0 = Date.parse('2026-06-01T00:00:00Z') - OFFSET * 1000; // local midnight

function iso(i: number): string {
  return `2026-06-0${1 + Math.floor(i / 24)}T${String(i % 24).padStart(2, '0')}:00`;
}

function body(levels: (number | null)[], over: Partial<Record<string, (number | null)[]>> = {}) {
  const n = levels.length;
  return {
    utc_offset_seconds: OFFSET,
    hourly: {
      time: Array.from({ length: n }, (_, i) => iso(i)),
      wave_height: Array(n).fill(1.2),
      wave_period: Array(n).fill(8.4),
      wave_direction: Array(n).fill(270),
      sea_surface_temperature: Array(n).fill(16.4),
      sea_level_height_msl: levels,
      ...over,
    },
  };
}

/** Semi-diurnal-ish tide: high at 3, low at 9, high at 15, low at 21 ... */
const tide = Array.from({ length: 48 }, (_, i) => Math.round(Math.cos(((i - 3) / 12) * 2 * Math.PI) * 100) / 100);

describe('marine', () => {
  it('builds the request URL', () => {
    const u = new URL(marineUrl(37.8, -122.45));
    expect(u.host).toBe('marine-api.open-meteo.com');
    expect(u.searchParams.get('hourly')).toContain('sea_level_height_msl');
    expect(u.searchParams.get('timezone')).toBe('auto');
    expect(u.searchParams.get('forecast_days')).toBe('2');
  });

  it('parses and converts local times', () => {
    const d = parseMarine(body(tide))!;
    expect(d.hourly).toHaveLength(48);
    expect(d.hourly[0].at).toBe(T0);
    expect(currentIndex(d.hourly, T0 + 90 * 60_000)).toBe(1);
    expect(currentIndex(d.hourly, T0 - 1)).toBe(-1);
  });

  it('returns null for inland (all nulls) and malformed responses', () => {
    const nulls = Array(48).fill(null);
    expect(parseMarine(body(nulls, { wave_height: nulls, wave_period: nulls, wave_direction: nulls, sea_surface_temperature: nulls }))).toBeNull();
    expect(parseMarine({ error: true, reason: 'nope' })).toBeNull();
    expect(parseMarine(null)).toBeNull();
    expect(marineNow(null)).toBeNull();
  });

  it('drops out-of-range values', () => {
    const d = parseMarine(body(tide, { wave_height: Array(48).fill(-1), sea_surface_temperature: Array(48).fill(NaN) }))!;
    expect(d.hourly[0].waveM).toBeNull();
    expect(d.hourly[0].seaTempC).toBeNull();
  });

  it('finds tide extremes', () => {
    const d = parseMarine(body(tide))!;
    const ex = tideExtremes(d.hourly);
    expect(ex.map((e) => `${e.kind}@${e.time.slice(11, 13)}`)).toEqual(['high@03', 'low@09', 'high@15', 'low@21', 'high@03', 'low@09', 'high@15', 'low@21']);
  });

  it('handles plateaus and null breaks', () => {
    const d = parseMarine(body([0, 1, 1, 0, null, 0.5, 0.2, 0.4]))!;
    const ex = tideExtremes(d.hourly);
    expect(ex).toEqual([expect.objectContaining({ kind: 'high', time: iso(1) }), expect.objectContaining({ kind: 'low', time: iso(6) })]);
  });

  it('reports rising/falling and the next extreme within 24 h', () => {
    const d = parseMarine(body(tide))!;
    expect(tideInfo(d, T0 + 4 * 3600_000 + 60_000)).toEqual({ trend: 'falling', next: expect.objectContaining({ kind: 'low', time: iso(9) }) });
    expect(tideInfo(d, T0 + 10 * 3600_000)).toEqual({ trend: 'rising', next: expect.objectContaining({ kind: 'high', time: iso(15) }) });
    // Near the end of the series there is no next extreme.
    expect(tideInfo(d, T0 + 45 * 3600_000)?.next).toBeNull();
  });

  it('omits tide when sea level is null', () => {
    const d = parseMarine(body(Array(48).fill(null)))!;
    expect(tideInfo(d, T0 + 3600_000)).toBeNull();
    const m = marineNow(d, T0 + 3600_000)!;
    expect(m.tide).toBeNull();
    expect(m.waveM).toBe(1.2);
    expect(m.seaTempC).toBe(16.4);
  });

  it('formats units (imperial with mph)', () => {
    expect(formatWaveHeight(1.2, 'kn')).toBe('1.2 m');
    expect(formatWaveHeight(1.2, 'ms')).toBe('1.2 m');
    expect(formatWaveHeight(1.2, 'mph')).toBe('3.9 ft');
    expect(formatWaterTemp(16.4, 'kn')).toBe('16 °C');
    expect(formatWaterTemp(16.4, 'mph')).toBe('62 °F');
  });

  it('gives a rough wetsuit hint', () => {
    expect(wetsuitHint(8)).toBe('drysuit or 5/6 mm');
    expect(wetsuitHint(10)).toBe('5/4 mm');
    expect(wetsuitHint(14.9)).toBe('5/4 mm');
    expect(wetsuitHint(15)).toBe('4/3 mm');
    expect(wetsuitHint(19)).toBe('3/2 mm or shorty');
    expect(wetsuitHint(22)).toBe('3/2 mm or shorty');
    expect(wetsuitHint(23)).toBe('boardshorts or lycra');
  });
});

describe('expired marine forecasts', () => {
  it('currentIndex rejects times after the last hour ends', async () => {
    const { currentIndex } = await import('../src/lib/marine');
    const h = [{ at: 0 }, { at: 3600_000 }] as never;
    expect(currentIndex(h, 3600_000 + 10)).toBe(1);
    expect(currentIndex(h, 2 * 3600_000)).toBe(-1);
    expect(currentIndex(h, 7 * 86_400_000)).toBe(-1);
    expect(currentIndex(h, -1)).toBe(-1);
  });
});
