'use client';
import { Armchair, Eye, Hand, MessageCircle } from 'lucide-react';
import type { Locale } from '@/lib/i18n';
import type { InteractionPromptSnapshot } from '@/lib/city/proximity-interactions';
import messages from '@/lib/i18n/interactions.json';
import './proximity-interaction-prompt.css';

const actionKeys = ['sit', 'stand', 'use', 'talk', 'inspect'] as const;
export function interactionActionText(locale: Locale, action: string) {
  const key = actionKeys.find((id) => id === action) ?? 'use';
  return messages[locale][key];
}
export interface ProximityInteractionPromptProps {
  snapshot: InteractionPromptSnapshot | null;
  /** Normalized viewport position. null means occluded or outside the view. */
  screen: { x: number; y: number } | null;
  locale: Locale;
  touch: boolean;
  enabled: boolean;
  onInteract: () => void;
}

/** A single world-anchored affordance. Touch and F dispatch the same validated
 * controller action; translation remains a view concern, never a world ID. */
export function ProximityInteractionPrompt({
  snapshot,
  screen,
  locale,
  touch,
  enabled,
  onInteract,
}: ProximityInteractionPromptProps) {
  if (
    !enabled ||
    !snapshot ||
    !screen ||
    !Number.isFinite(screen.x) ||
    !Number.isFinite(screen.y) ||
    screen.x < 0 ||
    screen.x > 1 ||
    screen.y < 0 ||
    screen.y > 1
  )
    return null;
  const label = interactionActionText(locale, snapshot.action);
  const accessibleLabel = touch
    ? label
    : messages[locale].shortcut.replace('{action}', label);
  const Icon =
    snapshot.kind === 'seat'
      ? Armchair
      : snapshot.kind === 'person'
        ? MessageCircle
        : snapshot.action === 'inspect'
          ? Eye
          : Hand;
  return (
    <div
      className="proximity-interaction-anchor ui-chrome"
      data-interaction-id={snapshot.id}
      data-interaction-action={snapshot.action}
      style={{
        left: `clamp(128px, ${screen.x * 100}vw, calc(100vw - 128px))`,
        top: `clamp(max(144px, env(safe-area-inset-top) + 144px), ${screen.y * 100}dvh, calc(100dvh - max(96px, env(safe-area-inset-bottom) + 96px)))`,
      }}
    >
      <button
        type="button"
        className="proximity-interaction-button glass"
        aria-label={accessibleLabel}
        aria-keyshortcuts={touch ? undefined : 'F'}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (enabled) onInteract();
        }}
      >
        <Icon aria-hidden="true" size={20} />
        <span>{label}</span>
        {!touch && <kbd aria-hidden="true">F</kbd>}
      </button>
    </div>
  );
}
