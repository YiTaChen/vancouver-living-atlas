'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  Plane,
  Helicopter,
  Navigation,
  X,
  RotateCcw,
  Camera,
  HelpCircle,
  ArrowDown,
  MoveLeft,
  MoveRight,
} from 'lucide-react';
import { Slider } from './ui/slider';
import { TravelJoystick } from './travel-joystick';
import type { FlightController } from '@/lib/city/flight-controller';
import type { FlightSnapshot } from '@/lib/city/flight-snapshot';
import type { Locale } from '@/lib/i18n';
import messages from '@/lib/i18n/flight.json';
export function flightText(locale: Locale, key: keyof typeof messages.en) {
  return messages[locale][key];
}
export function FlightControls({
  controller,
  state,
  locale,
  touch,
  controlsEnabled = true,
  panelVisible = true,
}: {
  controller: FlightController | null;
  state: FlightSnapshot;
  locale: Locale;
  touch: boolean;
  controlsEnabled?: boolean;
  panelVisible?: boolean;
}) {
  const [help, setHelp] = useState(false);
  const t = (key: keyof typeof messages.en) => flightText(locale, key);
  const move = useCallback(
    (x: number, y: number) => {
      controller?.setStick(x, y);
    },
    [controller],
  );
  const noop = useCallback(() => {}, []);
  const canPilot =
    controlsEnabled && state.attached && state.phase !== 'crashed';
  useEffect(() => {
    const reset = () => {
      controller?.clearInput();
    };
    if (!canPilot) reset();
    return reset;
  }, [controller, canPilot]);
  if (!controller) return null;
  const hold = (field: 'yaw' | 'descend', value: number | boolean) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      controller.setHold(field, value);
    },
    onPointerUp: () => controller.setHold(field, field === 'yaw' ? 0 : false),
    onPointerCancel: () =>
      controller.setHold(field, field === 'yaw' ? 0 : false),
    onLostPointerCapture: () =>
      controller.setHold(field, field === 'yaw' ? 0 : false),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        controller.setHold(field, value);
      }
    },
    onKeyUp: () => controller.setHold(field, field === 'yaw' ? 0 : false),
    onBlur: () => controller.setHold(field, field === 'yaw' ? 0 : false),
  });
  return (
    <>
      {state.placing && (
        <section
          className="flight-placement glass ui-chrome"
          aria-label={t('fly')}
        >
          <Plane size={20} />
          <span>{t('placement')}</span>
          {!touch && (
            <>
              <button onClick={() => controller.quick('seaplane')}>
                {t('quickPlane')}
              </button>
              <button onClick={() => controller.quick('helicopter')}>
                {t('quickHeli')}
              </button>
            </>
          )}
          <button
            onClick={() => controller.cancelPlacement()}
            aria-label={t('cancel')}
          >
            <X size={19} />
            {t('cancel')}
          </button>
          {state.warning === 'invalid' && <output>{t('invalid')}</output>}
        </section>
      )}
      {panelVisible && state.exists && !state.attached && !state.placing && (
        <button
          className="flight-return glass ui-chrome"
          onClick={() => controller.attach()}
        >
          <RotateCcw size={18} />
          {t('returnAircraft')}
        </button>
      )}
      {state.attached && (
        <>
          {panelVisible && (
            <section
              className="flight-panel glass ui-chrome"
              aria-label={t('fly')}
            >
              <header>
                {state.kind === 'helicopter' ? (
                  <Helicopter size={19} />
                ) : (
                  <Plane size={19} />
                )}
                <strong>{t(state.kind || 'seaplane')}</strong>
                <button
                  aria-label={t('help')}
                  aria-expanded={help}
                  onClick={() => setHelp(!help)}
                >
                  <HelpCircle size={18} />
                </button>
              </header>
              <div className="flight-instruments">
                <span>
                  {t('altitude')} <b>{state.altitude} m</b>
                </span>
                <span>
                  {t('airspeed')} <b>{state.speed} kn</b>
                </span>
              </div>
              <div className="flight-actions">
                <button
                  aria-pressed={state.cruise}
                  disabled={state.phase === 'crashed'}
                  onClick={() => controller.cruise()}
                >
                  <Navigation size={15} />
                  {t(state.cruise ? 'pauseCruise' : 'cruise')}
                </button>
                {state.kind === 'helicopter' && (
                  <button
                    aria-pressed={state.hover}
                    disabled={state.phase === 'crashed'}
                    onClick={() => controller.hover()}
                  >
                    {t('hover')}
                  </button>
                )}
              </div>
              <button
                className="flight-new"
                onClick={() => controller.beginPlacement()}
              >
                {t('newFlight')}
              </button>
              <fieldset className="flight-views" aria-label={t('cockpit')}>
                {(['cockpit', 'clear', 'chase'] as const).map((v) => (
                  <button
                    key={v}
                    aria-pressed={state.view === v}
                    onClick={() => controller.setView(v)}
                  >
                    {v === 'chase' && <Camera size={14} />}
                    {t(v)}
                  </button>
                ))}
              </fieldset>
              {state.cruise && (
                <small>{t(state.join ? 'joining' : 'circling')}</small>
              )}
              {help && (
                <div className="flight-help">
                  <p>{t('intro')}</p>
                  <p>{touch ? t('touchHint') : t('controls')}</p>
                  <p>
                    {t('powerHint')} · H: {t('hover')} · X: {t('descend')} · C:{' '}
                    {t('cruise')}
                  </p>
                  <p>{t('cruiseHint')}</p>
                </div>
              )}
            </section>
          )}
          {state.phase !== 'crashed' && controlsEnabled && (
            <>
              <section
                className="flight-power glass"
                aria-label={t(
                  state.kind === 'helicopter' ? 'collective' : 'throttle',
                )}
              >
                <label id="flight-power-label">
                  {t(state.kind === 'helicopter' ? 'collective' : 'throttle')}
                </label>
                <strong>{Math.round(state.power * 100)}%</strong>
                <div className="flight-power-track">
                  <Slider
                    orientation="vertical"
                    aria-labelledby="flight-power-label"
                    min={0}
                    max={100}
                    step={1}
                    value={[Math.round(state.power * 100)]}
                    onValueChange={(v) =>
                      controller.setPower((Array.isArray(v) ? v[0] : v) / 100)
                    }
                  />
                </div>
                {!touch && <small>R / F</small>}
              </section>
              {touch && (
                <TravelJoystick
                  mode="walk"
                  label={t('touchHint')}
                  brakeLabel=""
                  onMove={move}
                  onBrake={noop}
                />
              )}
              <div className="flight-yaw glass">
                <button aria-label={t('left')} {...hold('yaw', -1)}>
                  <MoveLeft size={22} />
                </button>
                {state.kind === 'helicopter' && (
                  <button aria-label={t('descend')} {...hold('descend', true)}>
                    <ArrowDown size={22} />
                  </button>
                )}
                <button aria-label={t('right')} {...hold('yaw', 1)}>
                  <MoveRight size={22} />
                </button>
              </div>
            </>
          )}
          {(state.stalled ||
            state.phase === 'crashed' ||
            state.warning === 'boundary') && (
            <output className="flight-alert glass">
              {state.phase === 'crashed'
                ? `${t('crashed')} · ${t('crashHint').replace('{seconds}', String(state.crashSeconds))}`
                : t(state.stalled ? 'stall' : 'boundary')}
            </output>
          )}
        </>
      )}
    </>
  );
}
