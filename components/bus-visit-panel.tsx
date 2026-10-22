'use client';
import { useState } from 'react';
import { BusFront, X } from 'lucide-react';
import type { CityEngine } from '@/lib/city/engine';
import type { BusVisitSnapshot } from '@/lib/city/bus-visit';
import { busVisitSelectedAnchor } from '@/lib/city/bus-visit-selection';
import { translate, type Locale } from '@/lib/i18n';

export function BusVisitPanel({
  city,
  snapshot,
  locale,
  visible,
  onPrepare,
}: {
  city: CityEngine | null;
  snapshot: BusVisitSnapshot | null;
  locale: Locale;
  visible: boolean;
  onPrepare: () => Promise<void>;
}) {
  const [anchor, setAnchor] = useState<string | null>(null);
  const [detail, setDetail] = useState<'auto' | 'light' | 'detailed'>('auto');
  const [busy, setBusy] = useState(false);
  const tr = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  if (!visible || !city) return null;
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
    if (busy || phase === 'loading' || snapshot?.aboard || rampLocked) return;
    setDetail(value);
    city.setBusVisitDetail(value);
    if (phase !== 'idle') await prepare(value);
  };
  const qualitySelect = (
    <select
      aria-label={tr('busVisitDetail')}
      value={detail}
      disabled={busy || phase === 'loading' || snapshot?.aboard || rampLocked}
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
  const selected = busVisitSelectedAnchor(snapshot, anchor);
  const choose = (id: string) => {
    if (!snapshot?.anchors.some((option) => option.id === id)) return;
    setAnchor(id);
    if (snapshot?.aboard) city.busVisit?.preview(id);
    city.publishBusVisit();
  };
  const label = (id: string, kind: 'seat' | 'standing') =>
    kind === 'seat'
      ? translate(locale, 'busVisitSeat', {
          number: Number(id.replace(/\D/g, '')),
        })
      : tr(
          id === 'wheelchair-stroller'
            ? 'busVisitOpenArea'
            : 'busVisitStanding',
        );
  return (
    <section
      className="bus-visit-panel glass ui-chrome"
      aria-label={tr('busInterior')}
    >
      <div className="bus-visit-heading">
        <strong>
          <BusFront size={17} /> {tr('busInterior')}
        </strong>
        <button
          aria-label={tr('close')}
          disabled={rampLocked}
          onClick={() => city.closeBusVisit()}
        >
          <X size={17} />
        </button>
      </div>
      <p>{tr('busVisitDescription')}</p>
      {ramp && (
        <div className="bus-visit-accessibility">
          <button
            className="bus-visit-accessibility-toggle"
            disabled={busy || ramp.moving}
            onClick={() => {
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
      {snapshot?.aboard && <p>{tr('busVisitQualityLocked')}</p>}
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
      {(phase === 'ready' || phase === 'aboard') && (
        <>
          <label className="bus-visit-viewpoint">
            <span>
              {tr(
                snapshot?.aboard
                  ? 'busVisitViewpoint'
                  : 'busVisitBoardingPlace',
              )}
            </span>
            <select
              value={selected ?? ''}
              disabled={!selected || ramp?.moving}
              onChange={(event) => choose(event.target.value)}
            >
              {snapshot?.anchors.map((option) => (
                <option key={option.id} value={option.id}>
                  {label(option.id, option.kind)}
                </option>
              ))}
            </select>
          </label>
          <p>{tr(snapshot?.aboard ? 'busVisitLook' : 'busVisitApproach')}</p>
          {snapshot?.error && (
            <p role="alert">
              {tr(snapshot.aboard ? 'busVisitExitBlocked' : 'busVisitApproach')}
            </p>
          )}
          {snapshot?.aboard ? (
            <button
              className="bus-visit-primary"
              disabled={!snapshot.canAlight}
              onClick={() => {
                city.busVisit?.alight();
                city.publishBusVisit();
              }}
            >
              {tr('busVisitAlight')}
            </button>
          ) : (
            <button
              className="bus-visit-primary"
              disabled={!snapshot?.canBoard || !selected}
              onClick={() => {
                if (selected) city.busVisit?.board(selected);
                city.publishBusVisit();
              }}
            >
              {tr('busVisitBoard')}
            </button>
          )}
        </>
      )}
    </section>
  );
}
