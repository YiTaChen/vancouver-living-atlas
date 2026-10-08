'use client';
import { useState } from 'react';
import { BusFront, X } from 'lucide-react';
import type { CityEngine } from '@/lib/city/engine';
import type { BusVisitSnapshot } from '@/lib/city/bus-visit';
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
  const [anchor, setAnchor] = useState('main-aisle');
  const [busy, setBusy] = useState(false);
  const tr = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  if (!visible || !city) return null;
  const phase = snapshot?.phase ?? 'idle';
  const prepare = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onPrepare();
    } finally {
      setBusy(false);
    }
  };
  if (phase === 'idle')
    return (
      <button
        className="bus-visit-launcher glass ui-chrome"
        onClick={prepare}
        disabled={busy}
      >
        <BusFront size={17} />
        {busy ? tr('busVisitLoading') : tr('busVisitEnter')}
      </button>
    );
  const selected = snapshot?.aboard ? (snapshot.viewAnchor ?? anchor) : anchor;
  const choose = (id: string) => {
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
      {(phase === 'loading' || busy) && (
        <output>{tr('busVisitLoading')}</output>
      )}
      {phase === 'error' && (
        <>
          <p role="alert">{tr('busVisitLoadError')}</p>
          <button onClick={prepare} disabled={busy}>
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
              value={selected}
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
              disabled={!snapshot?.canBoard}
              onClick={() => {
                city.busVisit?.board(anchor);
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
