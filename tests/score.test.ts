import { describe, expect, it } from 'vitest';
import { directionFit, scoreWind } from '../src/lib/score';
import { DEFAULT_SETTINGS } from '../src/lib/types';
import type { Sector } from '../src/lib/sectors';

const S = DEFAULT_SETTINGS; // 15–30 kn, gusts <= 35
const WEST: Sector[] = [[225, 315]];

describe('directionFit', () => {
  it('classifies', () => {
    expect(directionFit(270, WEST)).toBe('rideable');
    expect(directionFit(320, WEST)).toBe('marginal');
    expect(directionFit(90, WEST)).toBe('offshore');
    expect(directionFit(90, [])).toBe('unknown');
    expect(directionFit(90, undefined)).toBe('unknown');
  });
});

describe('scoreWind', () => {
  it('rates in-window rideable wind good', () => {
    const r = scoreWind({ speedKn: 22, gustKn: 27, dirDeg: 270 }, WEST, S);
    expect(r.rating).toBe('good');
    expect(r.score).toBeGreaterThan(90);
  });
  it('never rates offshore wind good', () => {
    const r = scoreWind({ speedKn: 22, gustKn: 25, dirDeg: 90 }, WEST, S);
    expect(r.rating).toBe('offshore');
    expect(r.score).toBe(0);
  });
  it('caps marginal direction at ok', () => {
    const r = scoreWind({ speedKn: 22, gustKn: 25, dirDeg: 325 }, WEST, S);
    expect(r.rating).toBe('ok');
    expect(r.score).toBeLessThan(70);
  });
  it('rates light and too-light wind', () => {
    expect(scoreWind({ speedKn: 13, gustKn: 16, dirDeg: 270 }, WEST, S).rating).toBe('light');
    expect(scoreWind({ speedKn: 5, gustKn: 8, dirDeg: 270 }, WEST, S).rating).toBe('poor');
  });
  it('rates too strong wind and gusts', () => {
    expect(scoreWind({ speedKn: 34, gustKn: 34, dirDeg: 270 }, WEST, S).rating).toBe('strong');
    const g = scoreWind({ speedKn: 22, gustKn: 40, dirDeg: 270 }, WEST, S);
    expect(g.rating).toBe('strong');
    expect(g.reason).toMatch(/Gusts/);
  });
  it('scores unknown direction on speed only', () => {
    const r = scoreWind({ speedKn: 22, gustKn: 25, dirDeg: 90 }, undefined, S);
    expect(r.rating).toBe('good');
    expect(r.direction).toBe('unknown');
    expect(r.score).toBeLessThan(scoreWind({ speedKn: 22, gustKn: 25, dirDeg: 270 }, WEST, S).score);
  });
  it('respects custom windows', () => {
    const light = { ...S, minKn: 10, maxKn: 18, maxGustKn: 22 };
    expect(scoreWind({ speedKn: 12, gustKn: 15, dirDeg: 270 }, WEST, light).rating).toBe('good');
    expect(scoreWind({ speedKn: 20, gustKn: 21, dirDeg: 270 }, WEST, light).rating).toBe('strong');
  });
  it('scores the middle of the window highest', () => {
    const mid = scoreWind({ speedKn: 22.5, gustKn: 25, dirDeg: 270 }, WEST, S).score;
    const edge = scoreWind({ speedKn: 15, gustKn: 18, dirDeg: 270 }, WEST, S).score;
    expect(mid).toBeGreaterThan(edge);
  });
});
