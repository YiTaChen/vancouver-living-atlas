'use client';
import { useCallback, useEffect, useState } from 'react';
import { BusFront, ChevronDown, ChevronUp, X } from 'lucide-react';
import type { CityEngine } from '@/lib/city/engine';
import type { BusVisitSnapshot } from '@/lib/city/bus-visit';
import { translate, type Locale } from '@/lib/i18n';
import messages from '@/lib/i18n/bus-passenger.json';
import interactions from '@/lib/i18n/interactions.json';
import { TravelJoystick } from './travel-joystick';

type TextKey = keyof typeof messages.en;
export const busPassengerText = (locale: Locale, key: TextKey) =>
  messages[locale][key];
const noop = () => {};

export function BusVisitPanel({
  city,
  snapshot,
  locale,
  visible,
  onPrepare,
  touch = false,
  controlsEnabled = true,
  onMove = noop,
}: {
  city: CityEngine | null;
  snapshot: BusVisitSnapshot | null;
  locale: Locale;
  visible: boolean;
  onPrepare: () => Promise<void>;
  touch?: boolean;
  controlsEnabled?: boolean;
  onMove?: (x: number, y: number) => void;
}) {
  const [detail, setDetail] = useState<'auto' | 'light' | 'detailed'>('auto');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const tr = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const t = (key: TextKey) => busPassengerText(locale, key);
  const phase = snapshot?.phase ?? 'idle';
  const ramp = snapshot?.accessibility;
  const rampLocked = !!ramp && ramp.phase !== 'stowed';
  const rampCopy =
    locale === 'zh-Hant'
      ? {
          deploy: '展開無障礙坡板',
          stow: '收起坡板',
          phases: {
            stowed: '坡板已收起',
            kneeling: '正在降低車身…',
            deploying: '正在展開坡板…',
            deployed: '坡板已展開；收起後可切換車內細節或離開',
            retracting: '正在收起坡板…',
            raising: '正在恢復車身高度…',
          },
          errors: {
            'front-door-closed': '請等候前門完全開啟。',
            'landing-unavailable': '附近沒有可承接坡板的實際路面。',
            'landing-too-steep': '路面高低差不適合展開坡板。',
            'landing-uneven': '坡板落點不平或沒有足夠承接空間。',
            'ramp-obstructed': '坡板展開路徑有障礙，請換一個停靠位置。',
            'clear-ramp-area': '請先退到坡板側邊，再展開坡板。',
            'bus-moved': '公車位置已改變，請重新準備停靠。',
          },
        }
      : locale === 'zh-Hans'
        ? {
            deploy: '展开无障碍坡板',
            stow: '收起坡板',
            phases: {
              stowed: '坡板已收起',
              kneeling: '正在降低车身…',
              deploying: '正在展开坡板…',
              deployed: '坡板已展开；收起后可切换车内细节或离开',
              retracting: '正在收起坡板…',
              raising: '正在恢复车身高度…',
            },
            errors: {
              'front-door-closed': '请等候前门完全开启。',
              'landing-unavailable': '附近没有可承接坡板的实际路面。',
              'landing-too-steep': '路面高低差不适合展开坡板。',
              'landing-uneven': '坡板落点不平或没有足够承接空间。',
              'ramp-obstructed': '坡板展开路径有障碍，请换一个停靠位置。',
              'clear-ramp-area': '请先退到坡板侧边，再展开坡板。',
              'bus-moved': '公交车位置已改变，请重新准备停靠。',
            },
          }
        : {
            deploy: 'Deploy accessibility ramp',
            stow: 'Stow ramp',
            phases: {
              stowed: 'Ramp stowed',
              kneeling: 'Lowering bus…',
              deploying: 'Deploying ramp…',
              deployed:
                'Ramp deployed; stow it before changing cabin detail or leaving',
              retracting: 'Stowing ramp…',
              raising: 'Restoring ride height…',
            },
            errors: {
              'front-door-closed': 'Wait for the front door to open fully.',
              'landing-unavailable':
                'No measured, walkable landing surface is available.',
              'landing-too-steep':
                'The ground height difference is too large for this ramp.',
              'landing-uneven': 'The landing area is uneven or too small.',
              'ramp-obstructed':
                'An obstacle blocks the ramp sweep. Choose another parking position.',
              'clear-ramp-area':
                'Step to the side of the ramp before deploying it.',
              'bus-moved': 'The bus moved. Prepare a new parked visit.',
            },
          };
  const aboard = snapshot?.aboard ?? false;
  const walking =
    visible &&
    controlsEnabled &&
    aboard &&
    Boolean(snapshot?.canWalkCabin) &&
    !snapshot?.seated &&
    !ramp?.moving;
  const move = useCallback((x: number, y: number) => onMove(x, y), [onMove]);
  useEffect(() => {
    if (!walking) onMove(0, 0);
    return () => onMove(0, 0);
  }, [walking, onMove]);
  if (!visible || !city) return null;
  const locked = busy || phase === 'loading' || (aboard && !controlsEnabled);
  const prepare = async (requested = detail) => {
    if (busy) return;
    city.setBusVisitDetail(requested);
    setBusy(true);
    try {
      await onPrepare();
    } finally {
      setBusy(false);
    }
  };
  const chooseDetail = async (value: 'auto' | 'light' | 'detailed') => {
    if (locked || aboard || rampLocked) return;
    setDetail(value);
    city.setBusVisitDetail(value);
    if (phase !== 'idle') await prepare(value);
  };
  const qualitySelect = (
    <select
      aria-label={tr('busVisitDetail')}
      value={detail}
      disabled={locked || aboard || rampLocked}
      onChange={(event) => {
        void chooseDetail(event.target.value as 'auto' | 'light' | 'detailed');
      }}
    >
      <option value="auto">{tr('busVisitDetailAuto')}</option>
      <option value="light">{tr('busVisitDetailLight')}</option>
      <option value="detailed">{tr('busVisitDetailDetailed')}</option>
    </select>
  );
  if (phase === 'idle')
    return (
      <div className="bus-visit-launcher glass ui-chrome">
        <button onClick={() => void prepare()} disabled={busy}>
          <BusFront size={17} />
          {busy ? tr('busVisitLoading') : tr('busVisitEnter')}
        </button>
        {qualitySelect}
      </div>
    );
  const ridePhase = snapshot?.ridePhase ?? 'parked';
  const status = t(
    ridePhase === 'moving'
      ? 'moving'
      : ridePhase === 'closing'
        ? 'closing'
        : ridePhase === 'opening'
          ? 'opening'
          : ridePhase === 'complete'
            ? 'complete'
            : 'parked',
  );
  const stopped =
    Number.isFinite(snapshot?.speedMps ?? 0) &&
    Math.abs(snapshot?.speedMps ?? 0) <= 0.05 &&
    (ridePhase === 'parked' || ridePhase === 'complete');
  const canAlight =
    !locked &&
    !rampLocked &&
    aboard &&
    stopped &&
    !snapshot?.seated &&
    Boolean(snapshot?.canAlight);
  const canRide =
    !locked && !rampLocked && aboard && stopped && Boolean(snapshot?.canRide);
  const hint = snapshot?.seated
    ? touch
      ? interactions[locale].stand
      : interactions[locale].shortcut.replace(
          '{action}',
          interactions[locale].stand,
        )
    : t(touch ? 'touchHint' : 'desktopHint');
  const showBody = !aboard || expanded;
  return (
    <>
      <section
        className={`bus-visit-panel glass ui-chrome${aboard ? ' is-aboard' : ''}`}
        aria-label={tr('busInterior')}
      >
        <div className="bus-visit-heading">
          <strong>
            <BusFront size={17} />
            {tr('busInterior')}
          </strong>
          <div className="bus-visit-heading-actions">
            {aboard && (
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls="bus-visit-details"
                aria-label={t(expanded ? 'collapse' : 'expand')}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
            )}
            <button
              type="button"
              aria-label={tr('close')}
              disabled={rampLocked || (aboard && !canAlight)}
              onClick={() => city.closeBusVisit()}
            >
              <X size={17} />
            </button>
          </div>
        </div>
        {aboard && (
          <output className="bus-visit-status" aria-live="polite">
            {status}
          </output>
        )}
        <div id="bus-visit-details" hidden={!showBody}>
          <p>{aboard ? hint : t('boardHint')}</p>
          {ramp && (
            <div className="bus-visit-accessibility">
              <button
                className="bus-visit-accessibility-toggle"
                disabled={locked || ramp.moving || !stopped}
                onClick={() => {
                  if (locked || ramp.moving || !stopped) return;
                  if (ramp.phase === 'deployed') city.busVisit?.stowRamp();
                  else city.busVisit?.deployRamp();
                  city.publishBusVisit();
                }}
              >
                {ramp.phase === 'deployed' ? rampCopy.stow : rampCopy.deploy}
              </button>
              <output aria-live="polite">
                {ramp.error
                  ? rampCopy.errors[ramp.error]
                  : rampCopy.phases[ramp.phase]}
              </output>
            </div>
          )}

          <div className="bus-visit-viewpoint bus-visit-quality">
            <span>{tr('busVisitDetail')}</span>
            {qualitySelect}
          </div>
          {snapshot?.profile && (
            <p>
              {tr(
                snapshot.profile === 'budget'
                  ? 'busVisitProfileBudget'
                  : snapshot.profile === 'reference-lod0'
                    ? 'busVisitProfileReference0'
                    : 'busVisitProfileReference1',
              )}
            </p>
          )}
          {snapshot?.fallback && (
            <output className="bus-visit-quality-note">
              {tr('busVisitQualityFallback')}
            </output>
          )}
          {aboard && <p>{tr('busVisitQualityLocked')}</p>}
          {aboard && <p>{t('rideHint')}</p>}
          {aboard && <p>{t('alightHint')}</p>}
        </div>
        {(phase === 'loading' || busy) && (
          <output>{tr('busVisitLoading')}</output>
        )}
        {phase === 'error' && (
          <>
            <p role="alert">{tr('busVisitLoadError')}</p>
            <button onClick={() => void prepare()} disabled={busy}>
              {tr('busVisitRetry')}
            </button>
          </>
        )}
        {phase === 'ready' && (
          <button
            className="bus-visit-primary"
            disabled={!snapshot?.canBoard || locked || !!ramp?.moving}
            onClick={() => {
              if (snapshot?.canBoard && !locked && !ramp?.moving) {
                city.busVisit?.board();
                city.publishBusVisit();
              }
            }}
          >
            {tr('busVisitBoard')}
          </button>
        )}
        {snapshot?.error && phase !== 'error' && (
          <p role="alert">
            {tr(aboard ? 'busVisitExitBlocked' : 'busVisitApproach')}
          </p>
        )}
        {aboard && (
          <>
            <div className="bus-visit-actions">
              <button
                className="bus-visit-primary"
                disabled={!canRide}
                onClick={() => {
                  if (canRide) {
                    city.busVisit?.startRide();
                    city.publishBusVisit();
                  }
                }}
              >
                {t('ride')}
              </button>
              <button
                className="bus-visit-primary"
                disabled={!canAlight}
                onClick={() => {
                  if (canAlight) {
                    city.busVisit?.alight();
                    city.publishBusVisit();
                  }
                }}
              >
                {tr('busVisitAlight')}
              </button>
            </div>
            {!expanded && <p className="bus-visit-movement-hint">{hint}</p>}
            {expanded && !snapshot?.canRide && ridePhase === 'parked' && (
              <p>{t('noRide')}</p>
            )}
          </>
        )}
      </section>
      {touch && walking && (
        <TravelJoystick
          mode="walk"
          label={t('walkCabin')}
          brakeLabel=""
          onMove={move}
          onBrake={noop}
        />
      )}
    </>
  );
}
