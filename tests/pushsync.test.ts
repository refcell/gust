import { describe, expect, it } from 'vitest';
import { createLatestSender, subscribeBody, syncKey } from '../src/lib/pushsync';
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
