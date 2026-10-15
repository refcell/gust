import type { Settings } from '../lib/types';
import { fromKnots, toKnots, UNIT_LABEL, type SpeedUnit } from '../lib/units';
import { sanitize } from '../lib/settings';
import { useEffect, useState } from 'preact/hooks';
import { canPromptInstall, onInstallChange, promptInstall } from './install';
import { detectPlatform } from '../lib/platform';

function InstallRow() {
  const [can, setCan] = useState(canPromptInstall);
  useEffect(() => onInstallChange(() => setCan(canPromptInstall())), []);
  const p = detectPlatform();
  if (p.standalone) return null;
  if (can)
    return (
      <fieldset>
        <legend>Install</legend>
        <p class="small muted">Install gust to get it on your home screen and enable background alerts.</p>
        <button class="btn" onClick={() => promptInstall()}>
          Install gust
        </button>
      </fieldset>
    );
  if (p.ios)
    return (
      <fieldset>
        <legend>Install</legend>
        <p class="small muted">
          Tap Share, then Add to Home Screen. Notifications on iPhone only work from the installed app.
        </p>
      </fieldset>
    );
  return null;
}

export function SettingsPanel({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const u = settings.unit;
  const show = (kn: number) => (u === 'ms' ? Number(fromKnots(kn, u).toFixed(1)) : Math.round(fromKnots(kn, u)));
  const setSpeed = (key: 'minKn' | 'maxKn' | 'maxGustKn') => (e: Event) => {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(v)) onChange(sanitize({ ...settings, [key]: toKnots(v, u) }));
  };
  return (
    <section class="panel" aria-labelledby="settings-h">
      <h2 id="settings-h">Settings</h2>
      <InstallRow />
      <fieldset>
        <legend>Units</legend>
        <div class="seg" role="radiogroup" aria-label="Wind speed unit">
          {(Object.keys(UNIT_LABEL) as SpeedUnit[]).map((k) => (
            <label key={k} class={k === u ? 'on' : ''}>
              <input type="radio" name="unit" value={k} checked={k === u} onChange={() => onChange({ ...settings, unit: k })} />
              {UNIT_LABEL[k]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Wind window ({UNIT_LABEL[u]})</legend>
        <div class="row3">
          <label>
            Min
            <input type="number" inputMode="decimal" step={u === 'ms' ? 0.5 : 1} value={show(settings.minKn)} onChange={setSpeed('minKn')} />
          </label>
          <label>
            Max
            <input type="number" inputMode="decimal" step={u === 'ms' ? 0.5 : 1} value={show(settings.maxKn)} onChange={setSpeed('maxKn')} />
          </label>
          <label>
            Max gust
            <input type="number" inputMode="decimal" step={u === 'ms' ? 0.5 : 1} value={show(settings.maxGustKn)} onChange={setSpeed('maxGustKn')} />
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Search radius</legend>
        <label class="range">
          <input
            type="range"
            min={5}
            max={300}
            step={5}
            value={settings.radiusKm}
            onInput={(e) => onChange(sanitize({ ...settings, radiusKm: Number((e.currentTarget as HTMLInputElement).value) }))}
            aria-valuetext={`${settings.radiusKm} kilometers`}
          />
          <span>{settings.radiusKm} km</span>
        </label>
      </fieldset>
      <fieldset>
        <legend>Forecast</legend>
        <label class="check">
          <input type="checkbox" checked={settings.forecastAlerts} onChange={(e) => onChange({ ...settings, forecastAlerts: (e.currentTarget as HTMLInputElement).checked })} />
          Alert me about good windows in the next 24&nbsp;h
        </label>
        <label>
          Minimum window length (hours)
          <input
            type="number"
            min={1}
            max={12}
            value={settings.minWindowHours}
            onChange={(e) => onChange(sanitize({ ...settings, minWindowHours: Number((e.currentTarget as HTMLInputElement).value) }))}
          />
        </label>
      </fieldset>
      <p class="small muted">
        A spot is <strong>good</strong> when the wind is inside your window, gusts are under your limit, and the direction is rideable for that spot. Offshore wind is
        never rated good.
      </p>
      <p class="small muted">
        Wind data: <a href="https://open-meteo.com/">Open-Meteo</a> (CC BY 4.0). Spots: gust curated list and{' '}
        <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors.
      </p>
    </section>
  );
}
