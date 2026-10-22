'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { CitySoundscape } from '@/lib/city/city-soundscape';
import type { Locale } from '@/lib/i18n';
import messages from '@/lib/i18n/soundscape.json';
import './city-sound-controls.css';

export function citySoundText(locale: Locale, key: keyof typeof messages.en) {
  return messages[locale][key];
}

/** Rendering or reopening settings never grants audio permission. */
export function CitySoundControls({
  soundscape,
  locale,
}: {
  soundscape: CitySoundscape | null;
  locale: Locale;
}) {
  const id = useId();
  const [enabled, setEnabled] = useState(
    soundscape?.snapshot.requested ?? false,
  );
  const [volume, setVolume] = useState(soundscape?.snapshot.volume ?? 0.65);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(!!soundscape?.snapshot.error);
  const lifetime = useRef({ alive: true });
  const pending = useRef(false);
  useEffect(() => {
    const token = lifetime.current;
    token.alive = true;
    return () => {
      token.alive = false;
    };
  }, []);

  const toggle = async (value: boolean) => {
    if (!soundscape || pending.current) return;
    pending.current = true;
    const token = lifetime.current;
    setBusy(true);
    setFailed(false);
    // This call occurs inside the native change gesture, before any await.
    const succeeded = await soundscape.setEnabled(value);
    if (!token.alive) return;
    pending.current = false;
    setBusy(false);
    setEnabled(value && succeeded);
    setFailed(value && !succeeded);
  };

  return (
    <div className="city-sound-controls" data-city-sound-controls="true">
      <label className="layer-row" htmlFor={`${id}-enabled`}>
        <span>{citySoundText(locale, 'title')}</span>
        <input
          id={`${id}-enabled`}
          type="checkbox"
          role="switch"
          aria-checked={enabled}
          checked={enabled}
          disabled={!soundscape || busy}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            void toggle(event.currentTarget.checked);
          }}
        />
      </label>
      <p id={`${id}-hint`} className="settings-note">
        {citySoundText(locale, 'hint')}
      </p>
      <label className="city-sound-volume" htmlFor={`${id}-volume`}>
        <span>{citySoundText(locale, 'volume')}</span>
        <output>{Math.round(volume * 100)}%</output>
        <input
          id={`${id}-volume`}
          type="range"
          min="0"
          max="100"
          step="1"
          value={Math.round(volume * 100)}
          disabled={!soundscape}
          onChange={(event) => {
            const next = Number(event.currentTarget.value) / 100;
            soundscape?.setVolume(next);
            setVolume(next);
          }}
        />
      </label>
      <output className="city-sound-status" aria-live="polite">
        {failed ? citySoundText(locale, 'unavailable') : ''}
      </output>
    </div>
  );
}
