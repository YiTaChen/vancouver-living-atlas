'use client';
import { useEffect, useState } from 'react';
import type {
  CityInteractions,
  InteractionView,
} from '@/lib/city/city-interactions';
import type { Locale } from '@/lib/i18n';
import { ProximityInteractionPrompt } from './proximity-interaction-prompt';

/** Keep moving world anchors local to this tiny overlay. Camera movement must
 * not cause the full atlas controls/page to render thirty times per second. */
export function CityInteractionOverlay({
  interactions,
  enabled,
  locale,
  touch,
}: {
  interactions: CityInteractions | null;
  enabled: boolean;
  locale: Locale;
  touch: boolean;
}) {
  const [view, setView] = useState<InteractionView>({
    snapshot: null,
    screen: null,
  });
  useEffect(() => {
    if (!interactions) return;
    const unsubscribe = interactions.subscribe(setView);
    interactions.setInputEnabled(enabled);
    interactions.update(performance.now(), true);
    return () => {
      interactions.setInputEnabled(false);
      unsubscribe();
    };
  }, [interactions, enabled]);
  return (
    <ProximityInteractionPrompt
      snapshot={view.snapshot}
      screen={view.screen}
      enabled={enabled}
      locale={locale}
      touch={touch}
      onInteract={() => {
        interactions?.interact(view.snapshot);
      }}
    />
  );
}
