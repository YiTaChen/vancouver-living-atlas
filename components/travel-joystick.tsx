'use client';
import { useEffect, useRef } from 'react';
import { stickAxes } from '@/lib/city/touch-input';

export function TravelJoystick({
  mode,
  label,
  brakeLabel,
  onMove,
  onBrake,
}: {
  mode: 'walk' | 'drive' | 'boat';
  label: string;
  brakeLabel: string;
  onMove: (x: number, y: number) => void;
  onBrake: (held: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    knob = useRef<HTMLSpanElement>(null);
  const pointer = useRef<number | null>(null),
    brakePointer = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const releaseStick = () => {
    pointer.current = null;
    onMove(0, 0);
    if (knob.current) knob.current.style.transform = 'translate(0px, 0px)';
    if (root.current) root.current.dataset.active = 'false';
  };
  const reset = () => {
    releaseStick();
    brakePointer.current = null;
    onBrake(false);
  };
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
  }, [mode, onMove, onBrake]);
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
      <div
        ref={root}
        className="travel-joystick"
        role="group"
        tabIndex={0}
        aria-label={label}
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
      </div>
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
    </div>
  );
}
