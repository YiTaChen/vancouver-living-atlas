'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { stickAxes } from '@/lib/city/touch-input';

type DriftHoldProps = {
  label: string;
  hint?: string;
  onHeld: (held: boolean) => void;
  className?: string;
  disabled?: boolean;
};

export function DriftHoldButton(props: DriftHoldProps) {
  // A disabled control unmounts its captured-input owner, releasing every source.
  return props.disabled ? (
    <button
      type="button"
      className={props.className || 'touch-drift glass'}
      data-drift-hold="true"
      disabled
      aria-label={props.label}
      aria-keyshortcuts="X"
      aria-pressed={false}
      title={props.hint}
    >
      <span>{props.label}</span>
      <kbd aria-hidden="true">X</kbd>
    </button>
  ) : (
    <ActiveDriftHoldButton {...props} />
  );
}

/** A separate captured pointer leaves the steering/throttle finger untouched. */
function ActiveDriftHoldButton({
  label,
  hint,
  onHeld,
  className = 'touch-drift glass',
}: DriftHoldProps) {
  const pointer = useRef<number | null>(null),
    keyboard = useRef(false),
    pulse = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [held, setHeld] = useState(false);
  const publish = useCallback(() => {
    const next =
      pointer.current !== null || keyboard.current || pulse.current !== null;
    setHeld(next);
    onHeld(next);
  }, [onHeld]);
  const clearInput = useCallback(() => {
    pointer.current = null;
    keyboard.current = false;
    if (pulse.current !== null) clearTimeout(pulse.current);
    pulse.current = null;
    onHeld(false);
  }, [onHeld]);
  const reset = useCallback(() => {
    clearInput();
    setHeld(false);
  }, [clearInput]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) reset();
    };
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      clearInput();
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [reset, clearInput]);
  return (
    <button
      type="button"
      className={className}
      data-drift-hold="true"
      aria-label={label}
      aria-keyshortcuts="X"
      aria-pressed={held}
      title={hint || `${label} · X`}
      onPointerDown={(event) => {
        if (event.button !== 0 || pointer.current !== null) return;
        event.preventDefault();
        event.stopPropagation();
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        publish();
      }}
      onPointerUp={(event) => {
        if (event.pointerId !== pointer.current) return;
        event.preventDefault();
        event.stopPropagation();
        pointer.current = null;
        publish();
      }}
      onPointerMove={(event) => {
        if (event.pointerId !== pointer.current) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerCancel={(event) => {
        if (event.pointerId !== pointer.current) return;
        event.stopPropagation();
        pointer.current = null;
        publish();
      }}
      onLostPointerCapture={(event) => {
        if (event.pointerId !== pointer.current) return;
        pointer.current = null;
        publish();
      }}
      onKeyDown={(event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        keyboard.current = true;
        publish();
      }}
      onKeyUp={(event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        keyboard.current = false;
        publish();
      }}
      onBlur={reset}
      onClick={(event) => {
        // Assistive activation has no physical pointer/key-up. Keep it bounded.
        if (event.detail !== 0 || pointer.current !== null || keyboard.current)
          return;
        if (pulse.current !== null) clearTimeout(pulse.current);
        pulse.current = setTimeout(() => {
          pulse.current = null;
          publish();
        }, 220);
        publish();
      }}
    >
      <span>{label}</span>
      <kbd aria-hidden="true">X</kbd>
    </button>
  );
}

export function TravelJoystick({
  mode,
  label,
  brakeLabel,
  onMove,
  onBrake,
  driftLabel,
  driftHint,
  onDrift,
}: {
  mode: 'walk' | 'drive' | 'boat';
  label: string;
  brakeLabel: string;
  onMove: (x: number, y: number) => void;
  onBrake: (held: boolean) => void;
  driftLabel?: string;
  driftHint?: string;
  onDrift?: (held: boolean) => void;
}) {
  const root = useRef<HTMLButtonElement>(null),
    knob = useRef<HTMLSpanElement>(null);
  const pointer = useRef<number | null>(null),
    brakePointer = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const releaseStick = useCallback(() => {
    pointer.current = null;
    onMove(0, 0);
    if (knob.current) knob.current.style.transform = 'translate(0px, 0px)';
    if (root.current) root.current.dataset.active = 'false';
  }, [onMove]);
  const reset = useCallback(() => {
    releaseStick();
    brakePointer.current = null;
    onBrake(false);
  }, [releaseStick, onBrake]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) reset();
    };
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      reset();
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [mode, reset]);
  const move = (x: number, y: number) => {
    const dx = x - origin.current.x,
      dy = y - origin.current.y;
    const axes = stickAxes(dx, dy);
    onMove(axes.x, axes.y);
    const factor = Math.min(1, 44 / (Math.hypot(dx, dy) || 1));
    if (knob.current)
      knob.current.style.transform = `translate(${dx * factor}px, ${dy * factor}px)`;
  };
  return (
    <div className="touch-drive-controls ui-chrome">
      <button
        type="button"
        ref={root}
        className="travel-joystick"
        aria-label={label}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
        onPointerDown={(event) => {
          if (pointer.current !== null || event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          pointer.current = event.pointerId;
          const rect = event.currentTarget.getBoundingClientRect();
          origin.current = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.dataset.active = 'true';
          move(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.pointerId === pointer.current) {
            event.preventDefault();
            event.stopPropagation();
            move(event.clientX, event.clientY);
          }
        }}
        onPointerUp={(event) => {
          if (event.pointerId === pointer.current) {
            event.preventDefault();
            releaseStick();
          }
        }}
        onPointerCancel={(event) => {
          if (event.pointerId === pointer.current) releaseStick();
        }}
        onLostPointerCapture={(event) => {
          if (event.pointerId === pointer.current) releaseStick();
        }}
        onKeyDown={(event) => {
          const keys: Record<string, [number, number]> = {
            ArrowUp: [0, 1],
            ArrowDown: [0, -1],
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
          };
          if (keys[event.key]) {
            event.preventDefault();
            event.stopPropagation();
            onMove(...keys[event.key]);
          }
        }}
        onKeyUp={(event) => {
          if (event.key.startsWith('Arrow')) {
            event.preventDefault();
            event.stopPropagation();
            reset();
          }
        }}
        onBlur={reset}
      >
        <span className="stick-cross" aria-hidden="true" />
        <span ref={knob} className="stick-knob" aria-hidden="true" />
      </button>
      {mode !== 'walk' && (
        <button
          className="touch-brake glass"
          aria-label={brakeLabel}
          onPointerDown={(event) => {
            if (brakePointer.current !== null) return;
            event.preventDefault();
            event.stopPropagation();
            brakePointer.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            onBrake(true);
          }}
          onPointerUp={(event) => {
            if (event.pointerId === brakePointer.current) {
              brakePointer.current = null;
              onBrake(false);
            }
          }}
          onPointerCancel={() => {
            brakePointer.current = null;
            onBrake(false);
          }}
          onLostPointerCapture={() => {
            brakePointer.current = null;
            onBrake(false);
          }}
          onKeyDown={(event) => {
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              onBrake(true);
            }
          }}
          onKeyUp={() => onBrake(false)}
          onBlur={() => onBrake(false)}
        >
          {brakeLabel}
        </button>
      )}
      {mode === 'drive' && driftLabel && onDrift && (
        <DriftHoldButton label={driftLabel} hint={driftHint} onHeld={onDrift} />
      )}
    </div>
  );
}
