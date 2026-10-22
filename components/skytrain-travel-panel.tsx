'use client';
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, TrainFront } from 'lucide-react';
import type { Locale } from '@/lib/i18n';
import {
  SKYTRAIN_LINES,
  SKYTRAIN_STATIONS,
  planSkyTrainJourney,
  type LineId,
  type StationId,
} from '@/lib/city/skytrain-network';
import type { SkyTrainTravelSnapshot } from '@/lib/city/skytrain-travel-types';
import messages from '@/lib/i18n/skytrain-travel.json';
import { TravelJoystick } from './travel-joystick';
import './skytrain-travel-panel.css';

type TextKey = keyof typeof messages.en;
export function skyTrainTravelText(locale: Locale, key: TextKey) {
  return messages[locale][key];
}
export interface SkyTrainTravelPanelProps {
  locale: Locale;
  snapshot: SkyTrainTravelSnapshot;
  visible: boolean;
  touch: boolean;
  controlsEnabled?: boolean;
  onEnter: (stationId: StationId) => void | Promise<void>;
  onDestination: (stationId: StationId) => void;
  onGoPlatform: () => void;
  onGoConcourse: () => void;
  onBoard: () => void;
  onAlight: () => void;
  onLeave: () => void;
  onMove: (x: number, y: number) => void;
}
const noop = () => {};
const stationName = (id: StationId | null) =>
  SKYTRAIN_STATIONS.find((station) => station.id === id)?.name ?? '';
const stationId = (value: string): value is StationId =>
  SKYTRAIN_STATIONS.some((station) => station.id === value);
const lineName = (id: LineId | null) => (id ? SKYTRAIN_LINES[id].name : '');

/** This panel requests actions; the world controller owns all boarding proofs. */
export function SkyTrainTravelPanel({
  locale,
  snapshot,
  visible,
  touch,
  controlsEnabled = true,
  onEnter,
  onDestination,
  onGoPlatform,
  onGoConcourse,
  onBoard,
  onAlight,
  onLeave,
  onMove,
}: SkyTrainTravelPanelProps) {
  const [entry, setEntry] = useState<StationId>('waterfront');
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const t = (key: TextKey) => skyTrainTravelText(locale, key);
  const active = snapshot.phase === 'station' || snapshot.phase === 'riding';
  const loading = snapshot.phase === 'loading' || Boolean(snapshot.busy);
  const locked = loading || !controlsEnabled;
  const source = active || loading ? (snapshot.stationId ?? entry) : entry;
  const destination = snapshot.destinationId;
  const route =
    source !== destination ? planSkyTrainJourney(source, destination) : null;
  const canBoard =
    !locked &&
    snapshot.phase === 'station' &&
    snapshot.level === 'platform' &&
    snapshot.doorsOpen &&
    snapshot.canBoard &&
    Number.isFinite(snapshot.speedMps) &&
    Math.abs(snapshot.speedMps) <= 0.05 &&
    source !== destination &&
    (!snapshot.plannedLineId || snapshot.plannedLineId === snapshot.lineId);
  const canAlight =
    !locked &&
    snapshot.phase === 'riding' &&
    snapshot.doorsOpen &&
    snapshot.canAlight &&
    Number.isFinite(snapshot.speedMps) &&
    Math.abs(snapshot.speedMps) <= 0.05;
  const canChangeLevel =
    !locked && snapshot.phase === 'station' && snapshot.canChangeLevel;
  const canExit =
    !locked &&
    snapshot.phase === 'station' &&
    snapshot.level === 'concourse' &&
    snapshot.canExit &&
    snapshot.canLeave !== false;
  const walking =
    visible && controlsEnabled && !loading && snapshot.phase === 'station';
  const move = useCallback((x: number, y: number) => onMove(x, y), [onMove]);
  useEffect(() => {
    if (!walking) onMove(0, 0);
    return () => onMove(0, 0);
  }, [walking, onMove]);
  if (!visible) return null;

  const board = () => {
    if (canBoard) onBoard();
  };
  const alight = () => {
    if (canAlight) onAlight();
  };
  const changeLevel = () => {
    if (!canChangeLevel) return;
    if (snapshot.level === 'concourse') onGoPlatform();
    else onGoConcourse();
  };
  const enter = () => {
    if (!locked && !active) {
      setPlannerOpen(false);
      void onEnter(source);
    }
  };
  const action =
    snapshot.phase === 'riding'
      ? {
          label: t(canAlight ? 'alight' : 'riding'),
          enabled: canAlight,
          run: alight,
        }
      : canBoard
        ? { label: t('board'), enabled: true, run: board }
        : {
            label:
              snapshot.level === 'concourse'
                ? `${t('platform')}${snapshot.plannedLineId ? ` · ${lineName(snapshot.plannedLineId)}` : ''}`
                : t('concourseAction'),
            enabled: canChangeLevel,
            run: changeLevel,
          };
  const status = loading
    ? t('loading')
    : snapshot.phase === 'riding'
      ? snapshot.doorsOpen
        ? t('doorsOpen')
        : t('riding')
      : snapshot.phase === 'station'
        ? t(snapshot.level === 'platform' ? 'platformLevel' : 'concourse')
        : t('startHint');
  const hint = snapshot.hint
    ? ({
        'approach-access': 'approachAccess',
        'approach-door': 'approachDoor',
        board: 'boardHint',
        alight: 'alightHint',
        'choose-destination': 'chooseDestination',
        wait: 'wait',
        transfer: 'transferHint',
      } as const)
    : null;
  const showBody = active
    ? !touch || expanded
    : plannerOpen || loading || snapshot.phase === 'error';
  const panelOpen = active ? expanded : plannerOpen;

  if (!active && !loading && !plannerOpen && snapshot.phase !== 'error')
    return (
      <div className="skytrain-travel-launcher glass ui-chrome">
        <button
          type="button"
          aria-expanded={false}
          aria-controls="skytrain-travel-body"
          onClick={() => setPlannerOpen(true)}
        >
          <TrainFront size={17} /> {t('title')}
        </button>
      </div>
    );

  return (
    <>
      <section
        className={`skytrain-travel-panel glass ui-chrome${active ? ' is-active' : ''}${showBody ? ' is-expanded' : ''}`}
        aria-label={t('title')}
        aria-busy={loading}
      >
        <div className="skytrain-travel-heading">
          <strong>
            <TrainFront size={17} /> {t('title')}
          </strong>
          {(touch || !active) && (
            <button
              type="button"
              aria-label={t(panelOpen ? 'collapse' : 'expand')}
              aria-expanded={panelOpen}
              aria-controls="skytrain-travel-body"
              onClick={() => {
                if (active) setExpanded((value) => !value);
                else setPlannerOpen((value) => !value);
              }}
            >
              {panelOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
            </button>
          )}
        </div>
        {active && (
          <output className="skytrain-travel-status" aria-live="polite">
            <span>
              {snapshot.phase === 'riding' &&
              !snapshot.doorsOpen &&
              snapshot.nextStationId
                ? `${t('nextStop')} · ${stationName(snapshot.nextStationId)}`
                : stationName(snapshot.stationId)}
            </span>
            <span>
              {snapshot.lineId ? `${lineName(snapshot.lineId)} · ` : ''}
              {status}
            </span>
          </output>
        )}
        <div id="skytrain-travel-body" hidden={!showBody}>
          {!active && (
            <label className="skytrain-travel-field">
              <span>{t('entryStation')}</span>
              <select
                value={entry}
                disabled={locked}
                onChange={(event) => {
                  if (!locked && stationId(event.target.value))
                    setEntry(event.target.value);
                }}
              >
                {SKYTRAIN_STATIONS.map((station) => (
                  <option key={station.id} value={station.id}>
                    {station.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="skytrain-travel-field">
            <span>{t('destination')}</span>
            <select
              value={destination === source ? '' : destination}
              disabled={locked || snapshot.phase === 'riding'}
              onChange={(event) => {
                const id = event.target.value;
                if (
                  !locked &&
                  snapshot.phase !== 'riding' &&
                  stationId(id) &&
                  id !== source
                )
                  onDestination(id);
              }}
            >
              <option value="" disabled>
                {t('chooseDestination')}
              </option>
              {SKYTRAIN_STATIONS.map((station) => (
                <option
                  key={station.id}
                  value={station.id}
                  disabled={station.id === source}
                >
                  {station.name}
                </option>
              ))}
            </select>
          </label>
          {route && (
            <ol className="skytrain-travel-itinerary" aria-label={t('journey')}>
              {route.legs.map((leg, index) => (
                <li key={`${leg.lineId}-${index}`}>
                  <span className="skytrain-travel-line" data-line={leg.lineId}>
                    {lineName(leg.lineId)}
                  </span>
                  <span>
                    {stationName(leg.from)} → {stationName(leg.to)}
                  </span>
                  <small>{leg.stops.map(stationName).join(' → ')}</small>
                </li>
              ))}
            </ol>
          )}
          {route?.transferStation && (
            <p className="skytrain-travel-transfer">
              {t('transferAt')} Waterfront
            </p>
          )}
          {snapshot.lineId && active && (
            <p className="skytrain-travel-current-line">
              <span
                className="skytrain-travel-line"
                data-line={snapshot.lineId}
              >
                {lineName(snapshot.lineId)}
              </span>
              {snapshot.plannedLineId &&
                snapshot.plannedLineId !== snapshot.lineId && (
                  <span>
                    {t('usePlatform')} {lineName(snapshot.plannedLineId)}
                  </span>
                )}
            </p>
          )}
          {snapshot.phase === 'riding' && (
            <div className="skytrain-travel-ride">
              <p>
                {t('nextStop')}{' '}
                <strong>{stationName(snapshot.nextStationId)}</strong>
              </p>
              <progress
                aria-label={t('progress')}
                max={1}
                value={
                  Number.isFinite(snapshot.travelProgress)
                    ? Math.max(0, Math.min(1, snapshot.travelProgress))
                    : 0
                }
              />
              <p>{t(snapshot.doorsOpen ? 'doorsOpen' : 'stayAboard')}</p>
            </div>
          )}
          {snapshot.phase === 'error' && (
            <p className="skytrain-travel-error" role="alert">
              {t('error')}
            </p>
          )}
          {hint && snapshot.hint && (
            <p className="skytrain-travel-hint">{t(hint[snapshot.hint])}</p>
          )}
          {!active ? (
            <>
              <p className="skytrain-travel-hint">{t('startHint')}</p>
              <button
                type="button"
                className="skytrain-travel-primary"
                disabled={locked}
                onClick={enter}
              >
                {loading
                  ? t('loading')
                  : t(snapshot.phase === 'error' ? 'retry' : 'enter')}
              </button>
            </>
          ) : (
            <>
              <div className="skytrain-travel-actions">
                {snapshot.phase === 'station' ? (
                  <>
                    <button
                      type="button"
                      disabled={!canChangeLevel}
                      onClick={changeLevel}
                    >
                      {t(
                        snapshot.level === 'concourse'
                          ? 'platform'
                          : 'concourseAction',
                      )}
                    </button>
                    <button
                      type="button"
                      className="skytrain-travel-primary"
                      disabled={!canBoard}
                      onClick={board}
                    >
                      {t('board')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="skytrain-travel-primary"
                    disabled={!canAlight}
                    onClick={alight}
                  >
                    {t('alight')}
                  </button>
                )}
                <button
                  type="button"
                  disabled={!canExit}
                  onClick={() => {
                    if (canExit) onLeave();
                  }}
                >
                  {t('exit')}
                </button>
              </div>
              <p className="skytrain-travel-hint">
                {t(touch ? 'touchHint' : 'desktopHint')}
              </p>
            </>
          )}
        </div>
      </section>
      {touch && walking && (
        <div className="skytrain-travel-walk-controls">
          <TravelJoystick
            mode="walk"
            label={t('move')}
            brakeLabel={t('stop')}
            onMove={move}
            onBrake={noop}
          />
        </div>
      )}
      {touch && active && (
        <div className="skytrain-travel-touch-action">
          <button
            type="button"
            className="glass"
            disabled={!action.enabled}
            onClick={action.run}
          >
            <TrainFront size={20} />
            <span>{action.label}</span>
          </button>
        </div>
      )}
    </>
  );
}
