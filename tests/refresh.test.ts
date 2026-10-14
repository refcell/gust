import { describe, expect, it } from 'vitest';
import { FRESH_MS, splitFresh } from '../src/lib/openmeteo';
import { createCoalescer } from '../src/lib/coalesce';
import type { SpotWind } from '../src/lib/types';

const w = (fetchedAt: number): SpotWind => ({
  current: { time: '2025-01-01T00:00', speedKn: 10, gustKn: 12, dirDeg: 200 },
  hourly: [],
  utcOffsetSeconds: 0,
  fetchedAt,
  observedAt: fetchedAt,
});

describe('splitFresh', () => {
  const now = 1_000_000_000;
  it('reuses samples younger than 10 minutes and fetches missing or older ones', () => {
    const spots = [{ id: 'fresh' }, { id: 'old' }, { id: 'none' }, { id: 'edge' }, { id: 'future' }];
    const wind = { fresh: w(now - 60_000), old: w(now - FRESH_MS - 1), edge: w(now - FRESH_MS), future: w(now + 60_000) };
    const r = splitFresh(spots, wind, now);
    expect(Object.keys(r.fresh)).toEqual(['fresh']);
    expect(r.missing.map((s) => s.id)).toEqual(['old', 'none', 'edge', 'future']);
  });
  it('nothing to fetch when all are fresh (scoring-only change)', () => {
    expect(splitFresh([{ id: 'a' }], { a: w(now - 1000) }, now).missing).toEqual([]);
  });
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createCoalescer', () => {
  it('keeps one run in flight and coalesces requests during it into one follow-up', async () => {
    const runs: boolean[] = [];
    const gates: (() => void)[] = [];
    const trigger = createCoalescer(async (force) => {
      runs.push(force);
      await new Promise<void>((r) => gates.push(r));
    });
    const p1 = trigger();
    const p2 = trigger();
    const p3 = trigger(true);
    const p4 = trigger();
    await flush();
    expect(runs).toEqual([false]);
    gates[0]();
    await p1;
    await flush();
    expect(runs).toEqual([false, true]); // exactly one follow-up, force OR-ed
    gates[1]();
    await Promise.all([p2, p3, p4]);
    expect(runs).toHaveLength(2);
    // Idle again: a new trigger starts right away.
    const p5 = trigger();
    await flush();
    expect(runs).toEqual([false, true, false]);
    gates[2]();
    await p5;
  });

  it('survives a failing run', async () => {
    let n = 0;
    const trigger = createCoalescer(async () => {
      if (n++ === 0) throw new Error('x');
    });
    await trigger();
    await trigger();
    expect(n).toBe(2);
  });
});
