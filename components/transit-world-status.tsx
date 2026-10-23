'use client';
import { useState } from 'react';
import { BusFront, TrainFront } from 'lucide-react';
import { PanelToggle, panelText } from './panel-toggle';
import type { Locale } from '@/lib/i18n';
import type { SkyTrainTravelSnapshot } from '@/lib/city/skytrain-travel-types';
import type { BusVisitSnapshot } from '@/lib/city/bus-visit';
import { SKYTRAIN_STATIONS } from '@/lib/city/skytrain-network';
import messages from '@/lib/i18n/skytrain-travel.json';
import interactions from '@/lib/i18n/interactions.json';
import './transit-world-status.css';

/** Context only: walking and F/tap are the same world interactions on both
 * devices. This HUD cannot summon a vehicle, change a floor or teleport. */
export function TransitWorldStatus({
  locale,
  train,
  bus,
  visible,
  touch,
}: {
  locale: Locale;
  train: SkyTrainTravelSnapshot;
  bus: BusVisitSnapshot | null;
  visible: boolean;
  touch: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const trainActive = train.phase === 'station' || train.phase === 'riding',
    aboard = train.phase === 'riding' || Boolean(bus?.aboard),
    active = trainActive || Boolean(bus?.aboard),
    seated = trainActive ? train.seated : bus?.seated;
  if (!visible || !active) return null;
  const t = messages[locale],
    name = trainActive
      ? SKYTRAIN_STATIONS.find((s) => s.id === train.stationId)?.name
      : bus?.serviceHeadsign;
  return (
    <>
      <section
        className="transit-world-status glass ui-chrome collapsible-panel"
        data-panel-collapsed={!expanded}
        aria-label={trainActive ? t.title : 'Bus'}
        aria-live="polite"
      >
        <PanelToggle
          locale={locale}
          title={trainActive ? t.title : panelText(locale, 'status')}
          expanded={expanded}
          onToggle={() => setExpanded((value) => !value)}
        />
        <strong>
          {trainActive ? <TrainFront size={18} /> : <BusFront size={18} />}{' '}
          {train.headsign && aboard ? train.headsign : name || t.title}
        </strong>
        {trainActive && train.nextStopName && (
          <span>
            {t.nextStop}: {train.nextStopName.replace(' @ ', ' · ')}
          </span>
        )}
        <span>
          {aboard
            ? `${Math.round((trainActive ? train.speedMps : (bus?.speedMps ?? 0)) * 3.6)} km/h · `
            : ''}
          {trainActive
            ? train.doorsOpen
              ? t.doorsOpen
              : train.phase === 'station'
                ? train.level === 'platform'
                  ? t.platformLevel
                  : t.concourse
                : t.riding
            : bus?.doorsOpen
              ? t.doorsOpen
              : t.riding}
        </span>
        {!touch && (
          <small>
            {seated
              ? interactions[locale].shortcut.replace(
                  '{action}',
                  interactions[locale].stand,
                )
              : t.desktopHint}
          </small>
        )}
      </section>
    </>
  );
}
