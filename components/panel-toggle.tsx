'use client';
import { ChevronDown, ChevronUp } from 'lucide-react';
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
}: {
  locale: Locale;
  title: string;
  expanded: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const label = `${panelText(locale, expanded ? 'collapse' : 'expand')} ${title}`;
  return (
    <button
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
        onToggle();
      }}
    >
      {expanded ? (
        <ChevronUp size={18} aria-hidden="true" />
      ) : (
        <ChevronDown size={18} aria-hidden="true" />
      )}
      <span className="panel-toggle-label">{title}</span>
    </button>
  );
}
