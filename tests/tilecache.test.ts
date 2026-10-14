import { describe, expect, it } from 'vitest';
import { DEFAULT_TILE_TTL_MS, FETCHED_HEADER, isTileFresh, tileLifetimeMs } from '../src/lib/tilecache';

const T0 = Date.UTC(2025, 5, 1, 12);
const H = (h: Record<string, string>) => new Headers(h);
const DAY = 24 * 3600 * 1000;

describe('tileLifetimeMs', () => {
  it('uses Cache-Control max-age', () => {
    expect(tileLifetimeMs(H({ 'cache-control': 'max-age=3600, stale-while-revalidate=604800' }), T0)).toBe(3600_000);
    expect(tileLifetimeMs(H({ 'Cache-Control': 'public, MAX-AGE=60' }), T0)).toBe(60_000);
  });
  it('max-age wins over Expires', () => {
    expect(tileLifetimeMs(H({ 'cache-control': 'max-age=10', expires: new Date(T0 + DAY).toUTCString() }), T0)).toBe(10_000);
  });
  it('treats no-cache / no-store as immediately stale', () => {
    expect(tileLifetimeMs(H({ 'cache-control': 'no-cache' }), T0)).toBe(0);
    expect(tileLifetimeMs(H({ 'cache-control': 'private, no-store' }), T0)).toBe(0);
  });
  it('uses Expires relative to Date, else to the fetch time', () => {
    expect(tileLifetimeMs(H({ expires: new Date(T0 + 2 * DAY).toUTCString(), date: new Date(T0 + DAY).toUTCString() }), T0)).toBe(DAY);
    expect(tileLifetimeMs(H({ expires: new Date(T0 + 3 * DAY).toUTCString() }), T0)).toBe(3 * DAY);
    expect(tileLifetimeMs(H({ expires: new Date(T0 - DAY).toUTCString() }), T0)).toBe(0);
    expect(tileLifetimeMs(H({ expires: '0' }), T0)).toBe(0);
  });
  it('defaults to 7 days', () => {
    expect(DEFAULT_TILE_TTL_MS).toBe(7 * DAY);
    expect(tileLifetimeMs(H({}), T0)).toBe(7 * DAY);
    expect(tileLifetimeMs(H({ 'cache-control': 'public' }), T0)).toBe(7 * DAY);
  });
});

describe('isTileFresh', () => {
  const at = (extra: Record<string, string> = {}) => H({ [FETCHED_HEADER]: String(T0), ...extra });
  it('is fresh within the lifetime and stale after it', () => {
    expect(isTileFresh(at(), T0 + 6 * DAY)).toBe(true);
    expect(isTileFresh(at(), T0 + 7 * DAY)).toBe(false);
    expect(isTileFresh(at({ 'cache-control': 'max-age=3600' }), T0 + 3599_000)).toBe(true);
    expect(isTileFresh(at({ 'cache-control': 'max-age=3600' }), T0 + 3600_000)).toBe(false);
    expect(isTileFresh(at({ 'cache-control': 'no-cache' }), T0)).toBe(false);
  });
  it('treats entries without a valid fetch time as stale', () => {
    expect(isTileFresh(H({}), T0)).toBe(false);
    expect(isTileFresh(H({ [FETCHED_HEADER]: 'garbage' }), T0)).toBe(false);
    expect(isTileFresh(H({ [FETCHED_HEADER]: String(T0 + DAY) }), T0)).toBe(false); // from the future
  });
});
