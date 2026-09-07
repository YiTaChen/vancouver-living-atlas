'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plane,
  Helicopter,
  Navigation,
  X,
  RotateCcw,
  Camera,
  HelpCircle,
  ArrowDown,
  ArrowUp,
  MoveLeft,
  MoveRight,
  Plus,
  Minus,
} from 'lucide-react';
import { Slider } from './ui/slider';
import { TravelJoystick } from './travel-joystick';
import type { FlightController } from '@/lib/city/flight-controller';
import type { FlightSnapshot } from '@/lib/city/flight-snapshot';
import { translate, type Locale } from '@/lib/i18n';
import messages from '@/lib/i18n/flight.json';
export function flightText(locale: Locale, key: keyof typeof messages.en) {
  return messages[locale][key];
}

/** Pointer capture keeps each held control independent of the other hand. */
function FlightHoldButton({
  controller,
  code,
  label,
  children,
}: {
  controller: FlightController;
  code: string;
  label: string;
  children: React.ReactNode;
}) {
  const pointer = useRef<number | null>(null);
  const release = () => {
    pointer.current = null;
    controller.setButtonKey(code, false);
  };
  useEffect(
    () => () => controller.setButtonKey(code, false),
    [controller, code],
  );
  const press = () => {
    // A quick tap changes power too; holding continues smoothly in the flight loop.
    if (code === 'r' || code === 'f')
      controller.setPower(
        controller.snapshot.power + (code === 'r' ? 0.025 : -0.025),
      );
    controller.setButtonKey(code, true);
  };
  return (
    <button
      type="button"
      data-flight-key={code}
      aria-label={`${label} (${code.toUpperCase()})`}
      title={`${label} · ${code.toUpperCase()}`}
      onPointerDown={(event) => {
        if (event.button !== 0 || pointer.current !== null) return;
        event.preventDefault();
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        press();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          if (!event.repeat) press();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') release();
      }}
      onBlur={release}
      onClick={(event) => {
        // Assistive technologies can activate a button without pointer/key events.
        if (event.detail === 0 && (code === 'r' || code === 'f'))
          controller.setPower(
            controller.snapshot.power + (code === 'r' ? 0.025 : -0.025),
          );
      }}
    >
      {children}
      <kbd>{code.toUpperCase()}</kbd>
    </button>
  );
}

export function FlightControls({
  controller,
  state,
  locale,
  touch,
  controlsEnabled = true,
  panelVisible = true,
  optionsOpen = false,
  onCloseOptions,
}: {
  controller: FlightController | null;
  state: FlightSnapshot;
  locale: Locale;
  touch: boolean;
  controlsEnabled?: boolean;
  panelVisible?: boolean;
  optionsOpen?: boolean;
  onCloseOptions?: () => void;
}) {
  const [help, setHelp] = useState(false);
  const t = (key: keyof typeof messages.en) => flightText(locale, key);
  const move = useCallback(
    (x: number, y: number) => {
      controller?.setStick(x, y);
      // With no separate mobile pedals, coordinate the helicopter's heading
      // with the stick; floatplanes already turn through banking.
      controller?.setHold(
        'yaw',
        controller.snapshot.kind === 'helicopter' ? x : 0,
      );
    },
    [controller],
  );
  const noop = useCallback(() => {}, []);
  const canPilot =
    controlsEnabled && state.attached && state.phase !== 'crashed';
  useEffect(() => {
    controller?.setInputEnabled(canPilot);
    return () => controller?.setInputEnabled(false);
  }, [controller, canPilot]);
  if (!controller) return null;
  const isHeli = state.kind === 'helicopter';
  const keyButton = (
    code: string,
    label: keyof typeof messages.en,
    icon: React.ReactNode,
  ) => (
    <FlightHoldButton controller={controller} code={code} label={t(label)}>
      {icon}
    </FlightHoldButton>
  );
  return (
    <>
      {state.placing && (
        <>
          {state.preview && (
            <figure
              className={`placement-marker flight-placement-marker ${state.preview.valid ? 'valid' : 'invalid'}`}
              style={{
                left: state.preview.screen[0],
                top: state.preview.screen[1],
              }}
              aria-label={
                state.preview.valid
                  ? t(state.preview.kind || 'fly')
                  : t('invalid')
              }
            >
              {state.preview.kind === 'helicopter' ? (
                <Helicopter size={32} />
              ) : (
                <Plane size={32} />
              )}
              <span>{state.preview.valid ? '✓' : '×'}</span>
            </figure>
          )}
          <section
            className="flight-placement glass ui-chrome"
            aria-label={t('fly')}
          >
            {!touch && (
              <>
                <Plane size={20} />
                <span>{t('placement')}</span>
                <button onClick={() => controller.quick('seaplane')}>
                  {t('quickPlane')}
                </button>
                <button onClick={() => controller.quick('helicopter')}>
                  {t('quickHeli')}
                </button>
              </>
            )}
            <button onClick={() => controller.cancelPlacement()}>
              <X size={19} />
              {t('cancel')}
            </button>
            {!touch && state.warning === 'invalid' && (
              <output>{t('invalid')}</output>
            )}
          </section>
        </>
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
          {panelVisible && optionsOpen && (
            <section
              className={`flight-panel glass ui-chrome ${touch ? 'mobile-travel-sheet' : ''}`}
              aria-label={t('fly')}
            >
              <header>
                {isHeli ? <Helicopter size={19} /> : <Plane size={19} />}
                <strong>{t(state.kind || 'seaplane')}</strong>
                <button
                  aria-label={translate(locale, 'close')}
                  onClick={onCloseOptions}
                >
                  <X size={19} />
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
              <div id="flight-options" className="flight-options">
                {isHeli && (
                  <div className="flight-actions">
                    {isHeli && (
                      <button
                        aria-pressed={state.hover}
                        disabled={state.phase === 'crashed'}
                        onClick={() => controller.hover()}
                      >
                        {t('hover')}
                        <kbd>H</kbd>
                      </button>
                    )}
                  </div>
                )}
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
                <button
                  className="flight-new"
                  onClick={() => controller.beginPlacement()}
                >
                  {t('newFlight')}
                </button>
                <button
                  className="flight-help-toggle"
                  aria-expanded={help}
                  onClick={() => setHelp(!help)}
                >
                  <HelpCircle size={16} />
                  {t('help')}
                </button>
                {help && (
                  <div className="flight-help">
                    <p>{t('intro')}</p>
                    <p>{touch ? t('touchHint') : t('controls')}</p>
                    <p>
                      {t('powerHint')}
                      {isHeli && (
                        <>
                          {' '}
                          · H: {t('hover')} · X: {t('descend')}
                        </>
                      )}{' '}
                      · C: {t('cruise')}
                    </p>
                    <p>{t('cruiseHint')}</p>
                  </div>
                )}
              </div>
              {state.cruise && (
                <small>{t(state.join ? 'joining' : 'circling')}</small>
              )}
            </section>
          )}
          {canPilot && (
            <>
              <div className="flight-helm">
                <button
                  className="flight-cruise glass"
                  aria-label={t('cruise')}
                  aria-pressed={state.cruise}
                  title={t(
                    state.cruise
                      ? state.join
                        ? 'joining'
                        : 'circling'
                      : 'cruise',
                  )}
                  onClick={() => controller.cruise()}
                >
                  <Navigation size={18} />
                  <span>{t('cruise')}</span>
                  {!touch && <kbd>C</kbd>}
                </button>
                <section
                  className="flight-power glass"
                  data-flight-power
                  aria-label={t(isHeli ? 'collective' : 'throttle')}
                >
                  <label id="flight-power-label">
                    {t(isHeli ? 'collective' : 'throttle')}
                  </label>
                  <strong>{Math.round(state.power * 100)}%</strong>
                  {keyButton('r', 'powerUp', <Plus size={18} />)}
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
                  {keyButton('f', 'powerDown', <Minus size={18} />)}
                </section>
              </div>
              {touch ? (
                <TravelJoystick
                  mode="walk"
                  label={t('touchHint')}
                  brakeLabel=""
                  onMove={move}
                  onBrake={noop}
                />
              ) : (
                <fieldset
                  className="flight-stick glass"
                  aria-label={t('controls')}
                >
                  {keyButton('w', 'pitchDown', <ArrowDown size={19} />)}
                  {keyButton('a', 'bankLeft', <MoveLeft size={19} />)}
                  {keyButton('s', 'pitchUp', <ArrowUp size={19} />)}
                  {keyButton('d', 'bankRight', <MoveRight size={19} />)}
                </fieldset>
              )}
              {!touch && (
                <fieldset className="flight-yaw glass" aria-label={t('help')}>
                  {keyButton('q', 'left', <MoveLeft size={19} />)}
                  {keyButton('e', 'right', <MoveRight size={19} />)}
                  {isHeli && keyButton('x', 'descend', <ArrowDown size={19} />)}
                </fieldset>
              )}
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
