import { describe, expect, it } from 'vitest';
import { createLatestSender, createRevisionedSender, nextRevision, pushSpots, subscribeBody, syncKey } from '../src/lib/pushsync';
import { MAX_PUSH_SPOTS } from '../src/lib/limits';
import { DEFAULT_SETTINGS, type Spot } from '../src/lib/types';

const spot = (id: string): Spot => ({ id, name: id.toUpperCase(), lat: 1, lon: 2, country: 'US', sectors: [[200, 300]] }) as Spot;

describe('subscribeBody', () => {
  it('excludes muted spots so the backend stops alerting for them', () => {
    const body = subscribeBody({
      subscription: { endpoint: 'e' },
      settings: { ...DEFAULT_SETTINGS, muted: ['b'] },
      watched: [spot('a'), spot('b'), { ...spot('c'), sectors: undefined }],
      loc: { lat: 3, lon: 4 },
      tz: 'UTC',
    });
    expect(body.spots).toEqual([
      { id: 'a', name: 'A', lat: 1, lon: 2, sectors: [[200, 300]] },
      { id: 'c', name: 'C', lat: 1, lon: 2, sectors: [] },
    ]);
    expect(body).toMatchObject({ subscription: { endpoint: 'e' }, location: { lat: 3, lon: 4 }, tz: 'UTC' });
  });
});

describe('syncKey', () => {
  it('changes when settings (e.g. mute) or watched ids change, not on identity', () => {
    const k = syncKey({ ...DEFAULT_SETTINGS }, [spot('a')]);
    expect(syncKey({ ...DEFAULT_SETTINGS }, [spot('a')])).toBe(k);
    expect(syncKey({ ...DEFAULT_SETTINGS, muted: ['a'] }, [spot('a')])).not.toBe(k);
    expect(syncKey({ ...DEFAULT_SETTINGS }, [spot('a'), spot('b')])).not.toBe(k);
  });
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function deferred() {
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  return { promise, resolve };
}

describe('createLatestSender', () => {
  it('serializes requests, skips superseded queued values, and flags stale results', async () => {
    const sent: string[] = [];
    const gates: ReturnType<typeof deferred>[] = [];
    const send = createLatestSender(async (v: string) => {
      sent.push(v);
      const d = deferred();
      gates.push(d);
      return d.promise;
    });
    const p1 = send('v1');
    await flush(); // v1 is now in flight
    const p2 = send('v2'); // queued, superseded by v3 before its turn
    const p3 = send('v3');
    await flush();
    expect(sent).toEqual(['v1']); // only one request in flight
    gates[0].resolve(true);
    expect(await p1).toEqual({ ok: true, stale: true }); // newer value pending: ignore this response
    expect(await p2).toEqual({ ok: false, stale: true }); // never sent
    await flush();
    expect(sent).toEqual(['v1', 'v3']); // the newest value is sent after the older one finished
    gates[1].resolve(true);
    expect(await p3).toEqual({ ok: true, stale: false });
  });

  it('coalesces a synchronous burst to the newest value', async () => {
    const sent: string[] = [];
    const send = createLatestSender(async (v: string) => (sent.push(v), true));
    const r = await Promise.all([send('a'), send('b'), send('c')]);
    expect(sent).toEqual(['c']);
    expect(r.map((x) => x.stale)).toEqual([true, true, false]);
  });

  it('reports failures (rejections included) without breaking later sends', async () => {
    let n = 0;
    const send = createLatestSender(async () => {
      if (n++ === 0) throw new Error('network');
      return true;
    });
    expect(await send('a')).toEqual({ ok: false, stale: false });
    expect(await send('b')).toEqual({ ok: true, stale: false });
  });
});

describe('createRevisionedSender', () => {
  it('two refreshes resolving in reverse order: the newer (muted) settings win', async () => {
    // A fake "persist + POST" target; the last write is what the backend/IDB keeps.
    let stored: { muted?: string[] } | null = null;
    const writes: number[] = [];
    const send = createRevisionedSender(async (v: { rev: number; settings: { muted?: string[] } }) => {
      writes.push(v.rev);
      stored = v.settings;
      return true;
    });
    // Refresh A starts with unmuted settings, then the user mutes and refresh B starts.
    const revA = nextRevision();
    const a = { rev: revA, settings: { ...DEFAULT_SETTINGS, muted: [] } };
    const revB = nextRevision();
    const b = { rev: revB, settings: { ...DEFAULT_SETTINGS, muted: ['x'] } };
    // B finishes first, A (older) last.
    expect(await send(b.rev, b)).toEqual({ ok: true, stale: false });
    expect(await send(a.rev, a)).toEqual({ ok: false, stale: true });
    expect(writes).toEqual([revB]); // the older intent was dropped before persisting / posting
    expect(stored).toEqual({ ...DEFAULT_SETTINGS, muted: ['x'] });
  });

  it('drops a queued older revision that is overtaken while another request is in flight', async () => {
    const sent: number[] = [];
    const gate = deferred();
    const send = createRevisionedSender(async (v: number) => {
      sent.push(v);
      return v === 1 ? gate.promise : true;
    });
    const p1 = send(1, 1);
    await flush();
    const p2 = send(2, 2);
    const p3 = send(3, 3);
    const late = send(2, 2); // an older intent arriving late
    gate.resolve(true);
    expect((await Promise.all([p1, p2, p3, late])).map((r) => r.stale)).toEqual([true, true, false, true]);
    expect(sent).toEqual([1, 3]);
  });
});

describe('pushSpots', () => {
  const at = (id: string, lat: number): Spot => ({ id, name: id, lat, lon: 0 }) as Spot;

  it('caps at the server limit: favourites first (nearest first), then nearest others; muted left out', () => {
    const watched = [at('o3', 3), at('f2', 20), at('o1', 1), at('m', 0), at('f1', 10), at('o2', 2)];
    const s = { ...DEFAULT_SETTINGS, favorites: ['f2', 'f1', 'gone'], muted: ['m'] };
    const r = pushSpots(watched, s, [{ lat: 0, lon: 0 }], 4);
    expect(r.spots.map((x) => x.id)).toEqual(['f1', 'f2', 'o1', 'o2']);
    expect(r.total).toBe(5);
  });

  it('uses the nearest origin, keeps input order without origins, and never exceeds MAX_PUSH_SPOTS', () => {
    const watched = [at('a', 10), at('b', 0)];
    expect(pushSpots(watched, DEFAULT_SETTINGS, [{ lat: 50, lon: 0 }, { lat: 9, lon: 0 }]).spots.map((x) => x.id)).toEqual(['a', 'b']);
    expect(pushSpots(watched, DEFAULT_SETTINGS, []).spots.map((x) => x.id)).toEqual(['a', 'b']);
    const many = Array.from({ length: 100 }, (_, i) => at(`s${i}`, i / 10));
    const body = subscribeBody({ subscription: {}, settings: { ...DEFAULT_SETTINGS, favorites: ['s99'] }, watched: many, loc: { lat: 0, lon: 0 }, tz: 'UTC' });
    expect(body.spots).toHaveLength(MAX_PUSH_SPOTS);
    expect(body.spots[0].id).toBe('s99');
    expect(body.spots[1].id).toBe('s0');
  });
});
