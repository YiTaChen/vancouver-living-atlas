'use client';
import { Switch } from './ui/switch';
import { Slider } from './ui/slider';
import {
  DEFAULT_SKY,
  MOON_PHASES,
  type SkySettings,
} from '@/lib/city/sky-state';
import type { MessageKey } from '@/lib/i18n';
export function SkyControls({
  value,
  onChange,
  tr,
}: {
  value: SkySettings;
  onChange: (p: Partial<SkySettings>) => void;
  tr: (k: MessageKey) => string;
}) {
  const toggles = [
    ['sun', 'skySun'],
    ['moon', 'skyMoon'],
    ['stars', 'skyStars'],
    ['aurora', 'skyAurora'],
    ['meteors', 'skyMeteors'],
  ] as const;
  const bars = [
    ['starDensity', 'skyStarDensity'],
    ['auroraIntensity', 'skyAuroraIntensity'],
    ['auroraDensity', 'skyAuroraDensity'],
    ['meteorFrequency', 'skyMeteorFrequency'],
  ] as const;
  return (
    <details className="sky-controls">
      <summary>{tr('skyTitle')}</summary>
      <p className="settings-note">{tr('skyHint')}</p>
      {toggles.map(([key, label]) => (
        <label key={key} className="layer-row">
          <span>{tr(label)}</span>
          <Switch
            aria-label={tr(label)}
            checked={value[key]}
            onCheckedChange={(v) => onChange({ [key]: v })}
          />
        </label>
      ))}
      <label className="clock-field-label" htmlFor="moon-phase">
        {tr('skyPhase')}
      </label>
      <select
        id="moon-phase"
        value={value.moonPhase}
        onChange={(e) =>
          onChange({ moonPhase: e.target.value as SkySettings['moonPhase'] })
        }
      >
        {MOON_PHASES.map((p) => (
          <option key={p} value={p}>
            {tr(('skyPhase_' + p) as MessageKey)}
          </option>
        ))}
      </select>
      <label className="clock-field-label" htmlFor="aurora-mode">
        {tr('skyAuroraMode')}
      </label>
      <select
        id="aurora-mode"
        value={value.auroraMode}
        onChange={(e) =>
          onChange({ auroraMode: e.target.value as SkySettings['auroraMode'] })
        }
      >
        <option value="auto">{tr('skyAuroraAuto')}</option>
        <option value="always">{tr('skyAuroraAlways')}</option>
      </select>
      {bars.map(([key, label]) => (
        <div className="sky-slider" key={key}>
          <label className="clock-field-label">
            {tr(label)} <span>{Math.round(value[key] * 100)}%</span>
          </label>
          <Slider
            aria-label={tr(label)}
            min={0}
            max={100}
            step={1}
            value={[value[key] * 100]}
            onValueChange={(v) =>
              onChange({ [key]: (Array.isArray(v) ? v[0] : v) / 100 })
            }
          />
        </div>
      ))}
      <p className="settings-note">{tr('skyCycleHint')}</p>
      <button
        className="sky-reset"
        onClick={() => onChange({ ...DEFAULT_SKY })}
      >
        {tr('skyReset')}
      </button>
    </details>
  );
}
