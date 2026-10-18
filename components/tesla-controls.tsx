'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowDown,
  Camera,
  Gauge,
  Infinity as InfinityIcon,
  Magnet,
  ParkingCircle,
  Rocket,
  RotateCcw,
  X,
  HelpCircle,
  Hand,
} from 'lucide-react';
import { TravelJoystick } from './travel-joystick';
import type { TeslaController, TeslaButton } from '@/lib/city/tesla-controller';
import type { TeslaSnapshot } from '@/lib/city/tesla-snapshot';
import type { TeslaQualityPreference } from '@/lib/city/tesla-quality';
import type { Locale } from '@/lib/i18n';
import messages from '@/lib/i18n/tesla.json';

type TextKey = keyof typeof messages.en;
export const teslaText = (locale: Locale, key: TextKey) =>
  messages[locale][key];

/** Independent captures let steering and thrust work together on a touch screen. */
function TeslaHold({
  controller,
  code,
  label,
  hotkey,
  children,
}: {
  controller: TeslaController;
  code: TeslaButton;
  label: string;
  hotkey: string;
  children: React.ReactNode;
}) {
  const pointer = useRef<number | null>(null);
  const release = () => {
    pointer.current = null;
    controller.setButton(code, false);
  };
  const press = () => {
    if (code === 'up') controller.command('jump');
    controller.setButton(code, true);
  };
  useEffect(() => () => controller.setButton(code, false), [controller, code]);
  return (
    <button
      type="button"
      data-tesla-hold={code}
      title={`${label} · ${hotkey}`}
      aria-label={`${label} (${hotkey})`}
      onPointerDown={(event) => {
        if (event.button !== 0 || pointer.current !== null) return;
        event.preventDefault();
        event.stopPropagation();
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        press();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onBlur={release}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) press();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          release();
        }
      }}
      onClick={(event) => {
        if (event.detail === 0) {
          if (code === 'up') controller.command('jump');
          controller.pulse(code);
        }
      }}
    >
      {children}
      <span>{label}</span>
      <kbd>{hotkey}</kbd>
    </button>
  );
}

export function TeslaControls({
  controller,
  state,
  locale,
  touch,
  controlsEnabled,
  panelVisible,
  optionsOpen,
  onCloseOptions,
}: {
  controller: TeslaController | null;
  state: TeslaSnapshot;
  locale: Locale;
  touch: boolean;
  controlsEnabled: boolean;
  panelVisible: boolean;
  optionsOpen: boolean;
  onCloseOptions: () => void;
}) {
  const [help, setHelp] = useState(false);
  const t = (key: TextKey) => teslaText(locale, key);
  const move = useCallback(
    (x: number, y: number) => controller?.setAxes(x, y),
    [controller],
  );
  const brake = useCallback(
    (held: boolean) => controller?.setButton('brake', held),
    [controller],
  );
  const enabled = state.active && controlsEnabled;
  useEffect(() => {
    controller?.setInputEnabled(enabled);
    return () => controller?.setInputEnabled(false);
  }, [controller, enabled]);
  if (!controller || !state.active) return null;
  const mode = state.parked
    ? 'parked'
    : state.transitioning
      ? 'transition'
      : state.mode === 'ground'
        ? 'ground'
        : state.mode === 'wall'
          ? 'wall'
          : 'air';
  const quality = (
    <label className="tesla-quality">
      <span>{t('quality')}</span>
      <select
        aria-label={t('quality')}
        value={state.quality}
        onChange={(event) =>
          controller.setQuality(event.target.value as TeslaQualityPreference)
        }
      >
        {(['auto', 'low', 'medium', 'high'] as const).map((q) => (
          <option key={q} value={q}>
            {q === 'auto' && state.quality === 'auto'
              ? `${t(q)} · ${t(state.effectiveQuality)}`
              : t(q)}
          </option>
        ))}
      </select>
    </label>
  );
  const camera = (
    <button
      type="button"
      className="tesla-camera"
      data-tesla-action="camera"
      title={`${t('camera')} · C`}
      onClick={() => controller.toggleView()}
    >
      <Camera size={18} />
      <span>{t(state.view === 'chase' ? 'cockpit' : 'chase')}</span>
      <kbd>C</kbd>
    </button>
  );
  const recover = (
    <button
      type="button"
      data-tesla-action="recover"
      onClick={() => controller.recover()}
    >
      <RotateCcw size={17} />
      <span>{t('recover')}</span>
      <kbd>R</kbd>
    </button>
  );
  const controls = (
    <>
      <TeslaHold
        controller={controller}
        code="up"
        label={t('up')}
        hotkey="Space"
      >
        <ArrowUp size={19} />
      </TeslaHold>
      <TeslaHold
        controller={controller}
        code="down"
        label={t('down')}
        hotkey="Q"
      >
        <ArrowDown size={19} />
      </TeslaHold>
      <TeslaHold
        controller={controller}
        code="boost"
        label={t('boost')}
        hotkey="Shift"
      >
        <Rocket size={19} />
      </TeslaHold>
      <TeslaHold
        controller={controller}
        code="brake"
        label={t('brake')}
        hotkey="B"
      >
        <Hand size={19} />
      </TeslaHold>
      <button
        type="button"
        data-tesla-action="grip"
        aria-pressed={state.adhesion}
        onClick={() => controller.command('adhesionToggle')}
      >
        <Magnet size={19} />
        <span>{t('adhesion')}</span>
        <kbd>E</kbd>
      </button>
      <button
        type="button"
        data-tesla-action="park"
        aria-pressed={state.parked}
        onClick={() => controller.command('park')}
      >
        <ParkingCircle size={19} />
        <span>{t('park')}</span>
        <kbd>P</kbd>
      </button>
      <button
        type="button"
        data-tesla-action="flight"
        aria-pressed={state.flightAssist && state.mode === 'air'}
        onClick={() => controller.command('flightToggle')}
      >
        <Rocket size={19} />
        <span>{t('flight')}</span>
        <kbd>F</kbd>
      </button>
      {camera}
    </>
  );
  return (
    <>
      {panelVisible && (!touch || optionsOpen) && (
        <section
          className={`tesla-panel glass ui-chrome ${touch ? 'mobile-travel-sheet' : ''}`}
          aria-label={t('options')}
        >
          <header>
            <Rocket size={19} />
            <strong>
              Tesla Roadster <small>Rocket</small>
            </strong>
            {touch && (
              <button aria-label={t('close')} onClick={onCloseOptions}>
                <X size={19} />
              </button>
            )}
          </header>
          <div className="tesla-instruments">
            <span>
              <Gauge size={16} />
              <b>{state.speedKph}</b> km/h
            </span>
            <span>{state.altitudeM} m</span>
            <strong>{t(mode)}</strong>
          </div>
          <span className="tesla-infinite">
            <InfinityIcon size={16} />
            {t('unlimited')}
          </span>
          {!touch && <div className="tesla-actions">{controls}</div>}
          {quality}
          <div className="tesla-secondary">
            {touch && camera}
            {recover}
            <button
              aria-label={t('help')}
              aria-expanded={help}
              onClick={() => setHelp(!help)}
            >
              <HelpCircle size={18} />
              {t('help')}
            </button>
          </div>
          {help && (
            <p className="tesla-help">
              {t(touch ? 'touchHint' : 'desktopHint')}
            </p>
          )}
        </section>
      )}
      {touch && enabled && !optionsOpen && (
        <>
          <TravelJoystick
            mode="drive"
            label={t('touchHint')}
            brakeLabel={t('brake')}
            onMove={move}
            onBrake={brake}
          />
          <div
            className="touch-drive-controls tesla-touch-controls ui-chrome"
            aria-label={t('help')}
          >
            {controls}
          </div>
          <div className="tesla-mobile-status glass ui-chrome">
            <Rocket size={15} />
            <span>Tesla</span>
            <b>{state.speedKph}</b>
            <small>km/h</small>
            <span>{t(mode)}</span>
            <InfinityIcon size={15} aria-label={t('unlimited')} />
          </div>
        </>
      )}
      {state.warning && state.warning !== 'no-spawn' && (
        <output className="tesla-warning glass ui-chrome">
          {t(state.warning === 'recovered' ? 'recovered' : 'boundary')}
        </output>
      )}
    </>
  );
}
