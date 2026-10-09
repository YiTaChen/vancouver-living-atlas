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
    if (busy || phase === 'loading' || snapshot?.aboard) return;
    setDetail(value);
    city.setBusVisitDetail(value);
    if (phase !== 'idle') await prepare(value);
  };
  const qualitySelect = (
    <select
      aria-label={tr('busVisitDetail')}
      value={detail}
      disabled={busy || phase === 'loading' || snapshot?.aboard}
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
        <button aria-label={tr('close')} onClick={() => city.closeBusVisit()}>
          <X size={17} />
        </button>
      </div>
      <p>{tr('busVisitDescription')}</p>
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
              disabled={!selected}
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
