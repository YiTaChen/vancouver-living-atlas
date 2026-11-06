'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import './hud-dock.css';

/** Each disclosure owns its state and content; the dock only arranges the
 * collapsed controls. The inline fallback also keeps server rendering usable. */
export function HudDockItem({
  id,
  essential = false,
  children,
}: {
  id: string;
  essential?: boolean;
  children: ReactNode;
}) {
  const [rail, setRail] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setRail(document.querySelector<HTMLElement>('[data-hud-dock-rail]'));
  }, []);
  if (!rail) return children;
  return createPortal(
    <div
      className="hud-dock-item"
      data-hud-dock-id={id}
      data-essential={essential || undefined}
    >
      {children}
    </div>,
    rail,
  );
}

const dockLabels: Record<
  string,
  { show: string; hide: string; group: string }
> = {
  en: {
    show: 'Show collapsed panels',
    hide: 'Hide collapsed panels',
    group: 'Collapsed panels',
  },
  fr: {
    show: 'Afficher les panneaux réduits',
    hide: 'Masquer les panneaux réduits',
    group: 'Panneaux réduits',
  },
  es: {
    show: 'Mostrar paneles contraídos',
    hide: 'Ocultar paneles contraídos',
    group: 'Paneles contraídos',
  },
  'zh-Hant': {
    show: '顯示收合的面板',
    hide: '隱藏收合的面板',
    group: '收合的面板',
  },
  'zh-Hans': {
    show: '显示收合的面板',
    hide: '隐藏收合的面板',
    group: '收合的面板',
  },
  de: {
    show: 'Eingeklappte Bereiche anzeigen',
    hide: 'Eingeklappte Bereiche ausblenden',
    group: 'Eingeklappte Bereiche',
  },
  ja: {
    show: '折りたたんだパネルを表示',
    hide: '折りたたんだパネルを隠す',
    group: '折りたたんだパネル',
  },
  ko: { show: '접힌 패널 표시', hide: '접힌 패널 숨기기', group: '접힌 패널' },
  uk: {
    show: 'Показати згорнуті панелі',
    hide: 'Приховати згорнуті панелі',
    group: 'Згорнуті панелі',
  },
  ru: {
    show: 'Показать свёрнутые панели',
    hide: 'Скрыть свёрнутые панели',
    group: 'Свёрнутые панели',
  },
};

function updateDockLabels(
  trigger: HTMLButtonElement,
  dock: HTMLElement,
  open: boolean,
) {
  const labels = dockLabels[document.documentElement.lang] ?? dockLabels.en;
  const label = open ? labels.hide : labels.show;
  trigger.setAttribute('aria-label', label);
  trigger.title = label;
  dock.setAttribute('aria-label', labels.group);
}

type Interval = { top: number; bottom: number };
type Rect = { left: number; right: number; top: number; bottom: number };
type Obstacle = { box: Rect; interactive: boolean };

/** Find the least obstructive edge position when even one dock item cannot fit.
 * Interactive controls count much more heavily than decorative panel surfaces. */
export function chooseOverflowPosition(
  frame: Rect,
  obstacles: Obstacle[],
  size = 44,
) {
  const lastY = Math.max(frame.top, frame.bottom - size);
  const positions = new Set([frame.top, lastY]);
  for (let y = frame.top; y < lastY; y += size / 2) positions.add(y);
  for (const { box } of obstacles) {
    positions.add(Math.max(frame.top, Math.min(lastY, box.top - size)));
    positions.add(Math.max(frame.top, Math.min(lastY, box.bottom)));
  }
  let best = {
    x: Math.max(frame.left, frame.right - size),
    y: frame.top,
    score: Infinity,
  };
  for (const x of [Math.max(frame.left, frame.right - size), frame.left]) {
    for (const y of positions) {
      let score = 0;
      for (const { box, interactive } of obstacles) {
        const overlapWidth = Math.max(
          0,
          Math.min(x + size, box.right) - Math.max(x, box.left),
        );
        const overlapHeight = Math.max(
          0,
          Math.min(y + size, box.bottom) - Math.max(y, box.top),
        );
        score += overlapWidth * overlapHeight * (interactive ? 1000 : 1);
      }
      if (score < best.score) best = { x, y, score };
    }
  }
  return best;
}

/** Keep a scrollable strip on a screen edge, in a free interval between the
 * HUD controls currently visible there. Scene input never belongs to the dock. */
export function HudDock() {
  const root = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const overflow = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const host = root.current;
    const dock = rail.current;
    const trigger = overflow.current;
    const atlas = host?.closest<HTMLElement>('.atlas');
    if (!host || !dock || !trigger || !atlas) return;
    let timer = 0;
    let stopped = false;
    const resize = new ResizeObserver(() => schedule());
    const observed = new Set<Element>();
    const layout = () => {
      timer = 0;
      if (stopped) return;
      const children = Array.from(dock.children) as HTMLElement[];
      const active = children.filter(
        (child) => child.getClientRects().length > 0,
      );
      if (!active.length) {
        dock.style.visibility = 'hidden';
        if (!trigger.hidden) trigger.hidden = true;
        host.dataset.overflow = 'false';
        host.dataset.open = 'false';
        if (trigger.getAttribute('aria-expanded') !== 'false')
          trigger.setAttribute('aria-expanded', 'false');
        updateDockLabels(trigger, dock, false);
        return;
      }
      const frame = host.getBoundingClientRect();
      const style = getComputedStyle(host);
      const left = frame.left + parseFloat(style.paddingLeft || '0');
      const right = frame.right - parseFloat(style.paddingRight || '0');
      const top = frame.top + parseFloat(style.paddingTop || '0');
      const bottom = frame.bottom - parseFloat(style.paddingBottom || '0');
      const width = Math.min(
        Math.max(...active.map((item) => item.offsetWidth)),
        Math.max(0, right - left),
      );
      const total =
        active.reduce((sum, item) => sum + item.offsetHeight, 0) +
        Math.max(0, active.length - 1) * 6;
      const obstacles = Array.from(
        atlas.querySelectorAll<HTMLElement>(
          '.ui-chrome, .flight-stick, .flight-yaw, .flight-cruise, .flight-power',
        ),
      ).filter((element) => {
        if (
          host.contains(element) ||
          element.closest('[data-panel-collapsed="true"], .rocket-is-collapsed')
        )
          return false;
        if (!element.getClientRects().length) return false;
        const computed = getComputedStyle(element);
        return computed.visibility !== 'hidden' && computed.display !== 'none';
      });
      for (const item of obstacles)
        if (!observed.has(item)) {
          resize.observe(item);
          observed.add(item);
        }
      for (const item of observed)
        if (!obstacles.includes(item as HTMLElement)) {
          resize.unobserve(item);
          observed.delete(item);
        }
      const candidates: {
        x: number;
        top: number;
        bottom: number;
        score: number;
      }[] = [];
      for (const x of [right - width, left]) {
        let intervals: Interval[] = [{ top, bottom }];
        for (const element of obstacles) {
          const box = element.getBoundingClientRect();
          if (box.right + 6 <= x || box.left - 6 >= x + width) continue;
          const blockedTop = box.top - 6;
          const blockedBottom = box.bottom + 6;
          intervals = intervals.flatMap((span) => {
            if (blockedBottom <= span.top || blockedTop >= span.bottom)
              return [span];
            return [
              { top: span.top, bottom: Math.min(span.bottom, blockedTop) },
              { top: Math.max(span.top, blockedBottom), bottom: span.bottom },
            ].filter((part) => part.bottom > part.top);
          });
        }
        for (const span of intervals) {
          const height = span.bottom - span.top;
          if (height >= 44)
            candidates.push({ x, ...span, score: Math.min(height, total) });
        }
      }
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];
      if (best) {
        if (!trigger.hidden) trigger.hidden = true;
        host.dataset.overflow = 'false';
        host.dataset.open = 'false';
        if (trigger.getAttribute('aria-expanded') !== 'false')
          trigger.setAttribute('aria-expanded', 'false');
        updateDockLabels(trigger, dock, false);
        const height = Math.max(44, Math.min(total, best.bottom - best.top));
        const y = best.top + Math.max(0, (best.bottom - best.top - height) / 2);
        dock.style.left = `${Math.round(best.x - frame.left)}px`;
        dock.style.top = `${Math.round(y - frame.top)}px`;
        dock.style.maxHeight = `${Math.round(height)}px`;
        dock.style.visibility = 'visible';
        return;
      }
      // If every full-width interval is blocked, shrink to one recoverable
      // 44px entry and minimise overlap, heavily favouring actionable controls.
      const actionable = Array.from(
        atlas.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, [role="button"], .travel-joystick, .flight-stick, .flight-yaw',
        ),
      ).filter((element) => {
        if (host.contains(element) || !element.getClientRects().length)
          return false;
        const computed = getComputedStyle(element);
        return computed.visibility !== 'hidden' && computed.display !== 'none';
      });
      const position = chooseOverflowPosition({ left, right, top, bottom }, [
        ...obstacles.map((element) => ({
          box: element.getBoundingClientRect(),
          interactive: false,
        })),
        ...actionable.map((element) => ({
          box: element.getBoundingClientRect(),
          interactive: true,
        })),
      ]);
      host.dataset.overflow = 'true';
      if (trigger.hidden) trigger.hidden = false;
      trigger.style.left = `${Math.round(position.x - frame.left)}px`;
      trigger.style.top = `${Math.round(position.y - frame.top)}px`;
      // The open list is temporary: place it inward beside the entry where
      // possible, leaving the entry available to close it again.
      const isRight = position.x > left + (right - left) / 2;
      const popupX = isRight
        ? Math.max(left, position.x - width - 6)
        : Math.min(right - width, position.x + 50);
      dock.style.left = `${Math.round(Math.max(left, popupX) - frame.left)}px`;
      const height = Math.max(44, Math.min(total, bottom - top));
      const popupY = Math.max(top, Math.min(bottom - height, position.y));
      dock.style.top = `${Math.round(popupY - frame.top)}px`;
      dock.style.maxHeight = `${Math.round(height)}px`;
      dock.style.visibility =
        host.dataset.open === 'true' ? 'visible' : 'hidden';
    };
    function schedule() {
      if (!timer && !stopped) timer = window.setTimeout(layout, 100);
    }
    const closeAfterAction = (event: MouseEvent) => {
      if (
        host.dataset.overflow !== 'true' ||
        !(event.target as Element).closest('button')
      )
        return;
      host.dataset.open = 'false';
      trigger.setAttribute('aria-expanded', 'false');
      updateDockLabels(trigger, dock, false);
      dock.style.visibility = 'hidden';
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        host.dataset.overflow !== 'true' ||
        host.dataset.open !== 'true'
      )
        return;
      event.stopPropagation();
      host.dataset.open = 'false';
      trigger.setAttribute('aria-expanded', 'false');
      updateDockLabels(trigger, dock, false);
      dock.style.visibility = 'hidden';
      trigger.focus();
    };
    dock.addEventListener('click', closeAfterAction);
    dock.addEventListener('keydown', closeOnEscape);
    updateDockLabels(trigger, dock, false);
    const language = new MutationObserver(() =>
      updateDockLabels(trigger, dock, host.dataset.open === 'true'),
    );
    language.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['lang'],
    });
    const mutations = new MutationObserver(schedule);
    mutations.observe(atlas, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'aria-expanded'],
    });
    resize.observe(host);
    resize.observe(dock);
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      resize.disconnect();
      mutations.disconnect();
      language.disconnect();
      dock.removeEventListener('click', closeAfterAction);
      dock.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', schedule);
    };
  }, []);
  return (
    <div ref={root} className="hud-dock-root">
      <button
        ref={overflow}
        className="hud-dock-overflow"
        type="button"
        hidden
        aria-label="Show collapsed panels"
        aria-controls="hud-dock-rail"
        aria-expanded="false"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter')
            event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          const host = root.current;
          const dock = rail.current;
          if (!host || !dock) return;
          const open = host.dataset.open !== 'true';
          host.dataset.open = String(open);
          event.currentTarget.setAttribute('aria-expanded', String(open));
          updateDockLabels(event.currentTarget, dock, open);
          dock.style.visibility = open ? 'visible' : 'hidden';
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </button>
      <div
        id="hud-dock-rail"
        ref={rail}
        className="hud-dock-rail"
        data-hud-dock-rail
        role="group"
        aria-label="Collapsed panels"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      />
    </div>
  );
}
