'use client';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { HudDockItem } from './hud-dock';
import type { Locale } from '@/lib/i18n';
import messages from '@/lib/i18n/panels.json';
import './panel-toggle.css';

export const panelText = (locale: Locale, key: keyof typeof messages.en) =>
  messages[locale][key];

/** A visual HUD control: changing disclosure never changes simulation state. */
export function PanelToggle({
  locale,
  title,
  expanded,
  onToggle,
  className = '',
  dockId,
  icon,
  essential = false,
}: {
  locale: Locale;
  title: string;
  expanded: boolean;
  onToggle: () => void;
  className?: string;
  dockId?: string;
  icon?: ReactNode;
  essential?: boolean;
}) {
  const label = `${panelText(locale, expanded ? 'collapse' : 'expand')} ${title}`;
  const button = (
    <button
      id={dockId ? `panel-toggle-${dockId}` : undefined}
      type="button"
      className={`panel-toggle ${expanded ? '' : 'is-collapsed'} ${className}`}
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.pointerType === 'mouse') event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        // Reparenting a focused disclosure into or out of the dock replaces its
        // DOM node. Preserve keyboard focus without stealing the scene's focus.
        const current = event.currentTarget;
        const doc = current?.ownerDocument;
        const restoreFocus = Boolean(
          doc && current && doc.activeElement === current,
        );
        onToggle();
        if (restoreFocus && dockId) {
          doc.defaultView?.requestAnimationFrame(() =>
            doc.getElementById(`panel-toggle-${dockId}`)?.focus(),
          );
        }
      }}
    >
      {expanded ? (
        <ChevronUp size={18} aria-hidden="true" />
      ) : (
        <span className="panel-toggle-icon" aria-hidden="true">
          {icon ?? <ChevronDown size={18} />}
        </span>
      )}
      <span className="panel-toggle-label">{title}</span>
    </button>
  );
  return !expanded && dockId ? (
    <HudDockItem id={dockId} essential={essential}>
      {button}
    </HudDockItem>
  ) : (
    button
  );
}
