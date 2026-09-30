'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Footprints,
  FlaskConical,
  MapPin,
  Pause,
  RefreshCw,
  Stamp,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import type { CityEngine } from '@/lib/city/engine';
import { translate, type Locale } from '@/lib/i18n';
import {
  DISCOVERY_ROUTES,
  discoveryCopy,
  discoveryRoute,
  discoveryRouteLength,
  type DiscoveryRoute,
} from '@/lib/city/discovery-routes';
import {
  collectDiscovery,
  DISCOVERY_STORAGE_KEY,
  DiscoveryLeg,
  emptyDiscoverySave,
  readDiscoverySave,
  startDiscovery,
  type DiscoverySave,
  type DiscoveryStatus,
} from '@/lib/city/discovery';
import { discoverySample } from '@/lib/city/discovery-runtime';
import './discovery-panel.css';
import { LightLabPanel } from './light-lab-panel';
import { lightLabCopy } from '@/lib/city/light-lab-copy';

const EN = {
  title: 'City field notes',
  intro:
    'Three short walks, nine observations and an indoor light lab. Explore the city and build your Vancouver passport.',
  notes: 'notes',
  stamps: 'walking stamps',
  close: 'Close field notes',
  start: 'Start walk',
  resume: 'Rejoin last stop',
  replay: 'Walk again',
  collect: 'Collect field note',
  collected: 'Field note collected',
  complete: 'Trail complete · stamp earned',
  next: 'Choose another walk',
  paused: 'Walk paused',
  pause: 'Pause trail',
  walk: 'Continue on foot',
  reach: 'Walk to the marked stop',
  approach: 'Explore the stretch on foot before collecting.',
  reconnect: 'Your location changed. Rejoin the last stop to continue.',
  saved: 'Progress saved in this browser.',
  memory: 'Storage is unavailable. Progress lasts for this visit.',
  joining:
    'Start and rejoin place you at the last completed stop. Walk normally between stops.',
  failed:
    'This route is not clear in the current scene. Please try another trail.',
  map: 'Follow the gold marker and local map.',
  help: 'WASD / arrow keys to walk · Shift to run · drag to look. On touch screens, use the joystick.',
  unlocked: 'Collected notes',
  locked: 'Walk this trail to collect its notes.',
  about: 'Virtual city walks; not real-world walking directions.',
  open: 'Open passport',
  source: 'City source',
  contentLanguage: 'Field notes are available in English and Chinese.',
  left: 'm to go',
  walked: 'm walked',
  step: 'Stop',
};
const HANT: typeof EN = {
  title: '城市探索手帳',
  intro:
    '三條短程散步、九篇觀察筆記，還有室內光色實驗室。走進城市，收集你的溫哥華探索印章。',
  notes: '篇筆記',
  stamps: '枚散步印章',
  close: '關閉探索手帳',
  start: '開始散步',
  resume: '從上一站繼續',
  replay: '再走一次',
  collect: '收集這篇筆記',
  collected: '已收集探索筆記',
  complete: '路線完成 · 獲得印章',
  next: '選擇下一條路線',
  paused: '散步已暫停',
  pause: '暫停路線',
  walk: '切回步行繼續',
  reach: '走向標記的觀察點',
  approach: '先步行探索這段街道，再收集筆記。',
  reconnect: '所在位置已改變，可從上一站繼續。',
  saved: '進度已保存在這個瀏覽器。',
  memory: '瀏覽器無法儲存，進度僅保留於這次造訪。',
  joining: '開始或繼續時會移至上一個完成的站點，之後請步行探索各站。',
  failed: '目前場景無法通過這條路線，請選擇另一條。',
  map: '跟隨金色標記與區域地圖前進。',
  help: 'WASD／方向鍵步行 · Shift 跑步 · 拖曳環顧。觸控裝置使用搖桿。',
  unlocked: '已收集的筆記',
  locked: '走過這條路線，就能收集筆記。',
  about: '虛擬城市探索，非現實世界的步行導航。',
  open: '打開探索手帳',
  source: '城市資料來源',
  contentLanguage: '探索筆記提供英文與中文。',
  left: '公尺到達',
  walked: '公尺已步行',
  step: '觀察點',
};
const HANS: typeof EN = {
  title: '城市探索手帐',
  intro:
    '三条短程散步、九篇观察笔记，还有室内光色实验室。走进城市，收集你的温哥华探索印章。',
  notes: '篇笔记',
  stamps: '枚散步印章',
  close: '关闭探索手帐',
  start: '开始散步',
  resume: '从上一站继续',
  replay: '再走一次',
  collect: '收集这篇笔记',
  collected: '已收集探索笔记',
  complete: '路线完成 · 获得印章',
  next: '选择下一条路线',
  paused: '散步已暂停',
  pause: '暂停路线',
  walk: '切回步行继续',
  reach: '走向标记的观察点',
  approach: '先步行探索这段街道，再收集笔记。',
  reconnect: '所在位置已改变，可从上一站继续。',
  saved: '进度已保存在这个浏览器。',
  memory: '浏览器无法储存，进度仅保留于这次访问。',
  joining: '开始或继续时会移至上一个完成的站点，之后请步行探索各站。',
  failed: '目前场景无法通过这条路线，请选择另一条。',
  map: '跟随金色标记与区域地图前进。',
  help: 'WASD／方向键步行 · Shift 跑步 · 拖曳环顾。触控设备使用摇杆。',
  unlocked: '已收集的笔记',
  locked: '走过这条路线，就能收集笔记。',
  about: '虚拟城市探索，非现实世界的步行导航。',
  open: '打开探索手帐',
  source: '城市资料来源',
  contentLanguage: '探索笔记提供英文与中文。',
  left: '米到达',
  walked: '米已步行',
  step: '观察点',
};
const EMPTY: DiscoveryStatus = {
  distance: Infinity,
  bearing: 0,
  walked: 0,
  required: 0,
  eligible: false,
  walking: false,
  discontinuity: false,
};
export interface DiscoveryTarget {
  x: number;
  z: number;
  label: string;
}
interface Props {
  city: CityEngine | null;
  locale: Locale;
  visible: boolean;
  onBegin(route: DiscoveryRoute, next: number): boolean;
  onBeginLab(): boolean;
  onTargetChange(target: DiscoveryTarget | null): void;
}
function DiscoveryMoveButton({
  city,
  direction,
  label,
  children,
}: {
  city: CityEngine | null;
  direction: 'forward' | 'backward' | 'left' | 'right';
  label: string;
  children: React.ReactNode;
}) {
  const pulse = useRef<ReturnType<typeof setTimeout> | null>(null);
  const release = useCallback(() => {
    if (pulse.current !== null) clearTimeout(pulse.current);
    pulse.current = null;
    city?.navigation?.hold(direction, false);
  }, [city, direction]);
  useEffect(() => release, [release]);
  const press = () => {
    if (city?.navigation?.mode === 'walk')
      city.navigation.hold(direction, true);
  };
  return (
    <button
      aria-label={label}
      title={label}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        press();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onBlur={release}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          if (!event.repeat) press();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') release();
      }}
      onClick={(event) => {
        if (event.detail === 0) {
          press();
          pulse.current = setTimeout(release, 200);
        }
      }}
    >
      {children}
    </button>
  );
}

export function DiscoveryPanel({
  city,
  locale,
  visible,
  onBegin,
  onBeginLab,
  onTargetChange,
}: Props) {
  const text = locale === 'zh-Hant' ? HANT : locale === 'zh-Hans' ? HANS : EN;
  const contentLocale = locale.startsWith('zh') ? locale : 'en';
  const labText = lightLabCopy(locale);
  const [labRequest, setLabRequest] = useState(0);
  const [labActive, setLabActive] = useState(false);
  const [save, setSave] = useState(emptyDiscoverySave);
  const saveRef = useRef(save);
  const [open, setOpen] = useState(false),
    [running, setRunning] = useState(false),
    [finished, setFinished] = useState(false);
  const [status, setStatus] = useState<DiscoveryStatus>(EMPTY);
  const [storage, setStorage] = useState(true),
    [announcement, setAnnouncement] = useState(''),
    [failure, setFailure] = useState(false);
  const [recent, setRecent] = useState<{
    routeId: string;
    stop: number;
  } | null>(null);
  const leg = useRef<DiscoveryLeg | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [qaWalking, setQAWalking] = useState(false);
  const qaTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopQA = useCallback(() => {
    if (qaTimer.current !== null) clearInterval(qaTimer.current);
    qaTimer.current = null;
    city?.navigation?.hold('forward', false);
    setQAWalking(false);
  }, [city]);
  useEffect(() => {
    try {
      const value = readDiscoverySave(
        localStorage.getItem(DISCOVERY_STORAGE_KEY),
      );
      saveRef.current = value;
      setSave(value);
    } catch {
      setStorage(false);
    }
  }, []);
  const persist = useCallback((value: DiscoverySave) => {
    saveRef.current = value;
    setSave(value);
    try {
      localStorage.setItem(DISCOVERY_STORAGE_KEY, JSON.stringify(value));
      setStorage(true);
    } catch {
      setStorage(false);
    }
  }, []);
  const route = discoveryRoute(save.selected)!;
  const progress = save.routes[route.id];
  const checkpoint = route.stops[progress.next];
  useEffect(() => {
    if (labActive) return;
    const target =
      running && checkpoint
        ? {
            x: checkpoint.position[0],
            z: checkpoint.position[1],
            label: discoveryCopy(checkpoint.title, locale),
          }
        : null;
    onTargetChange(target);
    return () => onTargetChange(null);
  }, [running, checkpoint, locale, labActive, onTargetChange]);
  useEffect(() => {
    if (!city || !running) return;
    const sample = () => {
      if (leg.current) setStatus(leg.current.sample(discoverySample(city)));
    };
    sample();
    const timer = setInterval(sample, 250);
    const visibility = () => {
      sample();
      if (document.hidden) stopQA();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [city, running, stopQA]);
  useEffect(() => () => stopQA(), [stopQA]);
  useEffect(() => {
    if (!visible) {
      setOpen(false);
      stopQA();
    }
  }, [visible, stopQA]);
  const openJournal = () => {
    stopQA();
    city?.navigation?.blur();
    setFailure(false);
    setOpen(true);
  };
  const begin = (selected: DiscoveryRoute) => {
    stopQA();
    const nextSave = startDiscovery(saveRef.current, selected);
    const next = nextSave.routes[selected.id].next;
    if (!onBegin(selected, next)) {
      setFailure(true);
      return;
    }
    persist(nextSave);
    leg.current = new DiscoveryLeg(selected, next);
    setStatus(city ? leg.current.sample(discoverySample(city)) : EMPTY);
    setRunning(true);
    setFinished(false);
    setFailure(false);
    setRecent(null);
    setOpen(false);
    setAnnouncement('');
  };
  const collect = useCallback(() => {
    if (!city || !leg.current || !running) return;
    const current = saveRef.current;
    const selected = leg.current.route;
    const next = collectDiscovery(current, leg.current, discoverySample(city));
    if (next === current) return;
    stopQA();
    city.navigation?.blur();
    const index = next.routes[selected.id].next;
    persist(next);
    setRecent({ routeId: selected.id, stop: index - 1 });
    if (index === selected.stops.length) {
      leg.current = null;
      setRunning(false);
      setFinished(true);
      setAnnouncement(text.complete);
    } else {
      leg.current = new DiscoveryLeg(selected, index);
      setStatus(leg.current.sample(discoverySample(city)));
      setAnnouncement(text.collected);
    }
  }, [city, running, persist, stopQA, text]);
  useEffect(() => {
    if (!visible || open || !running) return;
    const key = (event: KeyboardEvent) => {
      if (
        event.code !== 'KeyE' ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="combobox"], [role="listbox"]',
        )
      )
        return;
      event.preventDefault();
      collect();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [collect, running, visible, open]);
  const pause = () => {
    stopQA();
    city?.navigation?.blur();
    leg.current = null;
    setRunning(false);
    setFinished(false);
    setRecent(null);
    setAnnouncement(text.paused);
  };
  const noteCount = Object.values(save.routes).reduce(
    (sum, item) => sum + item.best,
    0,
  );
  const stamps = Object.values(save.routes).filter(
    (item) => item.stamped,
  ).length;
  const recentRoute = recent && discoveryRoute(recent.routeId);
  const recentStop = recentRoute && recentRoute.stops[recent!.stop];
  const qaWalk = () => {
    if (
      process.env.VANCOUVER_VISUAL_QA !== '1' ||
      !city?.navigation ||
      !running ||
      !leg.current
    )
      return;
    if (qaWalking) {
      stopQA();
      return;
    }
    const started = performance.now(),
      activeLeg = leg.current;
    city.navigation.hold('forward', true);
    setQAWalking(true);
    qaTimer.current = setInterval(() => {
      const sample = discoverySample(city),
        current = activeLeg.sample(sample);
      if (
        document.hidden ||
        sample.mode !== 'walk' ||
        !sample.grounded ||
        leg.current !== activeLeg ||
        performance.now() - started > 45000 ||
        current.distance <= 8 ||
        current.discontinuity
      )
        stopQA();
    }, 100);
  };
  return (
    <>
      {visible && !running && !finished && !labActive && (
        <button
          ref={trigger}
          className="discovery-launch glass ui-chrome"
          onClick={openJournal}
          aria-label={text.open}
          aria-haspopup="dialog"
        >
          <BookOpen size={18} />
          <span>{text.title}</span>
          <small>{stamps}/3</small>
        </button>
      )}
      {visible && (running || finished) && (
        <section
          className={`discovery-hud glass ui-chrome ${finished ? 'discovery-finished' : ''}`}
          aria-label={text.title}
          lang={contentLocale}
        >
          <header>
            <button onClick={openJournal} aria-label={text.open}>
              <BookOpen size={16} />
              <span>{discoveryCopy(route.title, locale)}</span>
            </button>
            <button
              className="discovery-icon"
              onClick={pause}
              aria-label={text.pause}
            >
              <Pause size={15} />
            </button>
          </header>
          {finished ? (
            <>
              <div className="discovery-earned">
                <Stamp size={28} />
                <strong>{text.complete}</strong>
              </div>
              <button className="discovery-primary" onClick={openJournal}>
                {text.next}
                <ArrowUpRight size={16} />
              </button>
            </>
          ) : (
            checkpoint && (
              <>
                <div className="discovery-objective">
                  <span className="discovery-bearing" aria-hidden="true">
                    <MapPin size={22} />
                  </span>
                  <div>
                    <small>
                      {text.step} {progress.next + 1} / {route.stops.length}
                    </small>
                    <strong>{discoveryCopy(checkpoint.title, locale)}</strong>
                  </div>
                  <b>
                    {Number.isFinite(status.distance)
                      ? Math.round(status.distance)
                      : '—'}
                    <small>m</small>
                  </b>
                </div>
                <progress
                  aria-label={`${Math.round(status.walked)} ${text.walked}`}
                  value={Math.min(status.walked, status.required)}
                  max={status.required || 1}
                />
                <p className="discovery-hint">
                  {!status.walking
                    ? text.walk
                    : status.discontinuity
                      ? text.reconnect
                      : status.distance <= 12 && !status.eligible
                        ? text.approach
                        : text.map}
                </p>
                <div className="discovery-actions">
                  <button
                    className="discovery-primary"
                    onClick={collect}
                    disabled={!status.eligible}
                  >
                    <MapPin size={15} />
                    {text.collect}
                    <kbd>E</kbd>
                  </button>
                  {(!status.walking || status.discontinuity) && (
                    <button
                      className="discovery-rejoin"
                      onClick={() => begin(route)}
                      aria-label={text.resume}
                      title={text.resume}
                    >
                      <RefreshCw size={16} />
                    </button>
                  )}
                </div>
                {process.env.VANCOUVER_VISUAL_QA === '1' && (
                  <button className="discovery-qa" onClick={qaWalk}>
                    {qaWalking
                      ? 'Cancel discovery walking QA'
                      : 'Discovery walk to next stop'}
                  </button>
                )}
              </>
            )
          )}
          <details className="discovery-walk-help">
            <summary>{translate(locale, 'movementHelp')}</summary>
            <p>
              {translate(locale, 'speedHelp')} · {translate(locale, 'lookHelp')}
            </p>
            <div className="discovery-walk-buttons">
              <DiscoveryMoveButton
                city={city}
                direction="left"
                label={translate(locale, 'turnLeft')}
              >
                <ArrowLeft size={17} />
              </DiscoveryMoveButton>
              <DiscoveryMoveButton
                city={city}
                direction="forward"
                label={translate(locale, 'moveForward')}
              >
                <ArrowUp size={17} />
              </DiscoveryMoveButton>
              <DiscoveryMoveButton
                city={city}
                direction="backward"
                label={translate(locale, 'moveBackward')}
              >
                <ArrowDown size={17} />
              </DiscoveryMoveButton>
              <DiscoveryMoveButton
                city={city}
                direction="right"
                label={translate(locale, 'turnRight')}
              >
                <ArrowRight size={17} />
              </DiscoveryMoveButton>
            </div>
          </details>
          {recentStop && (
            <details className="discovery-recent">
              <summary>
                <Check size={13} />
                {discoveryCopy(recentStop.title, locale)}
              </summary>
              <p>{discoveryCopy(recentStop.note, locale)}</p>
            </details>
          )}
        </section>
      )}
      <LightLabPanel
        city={city}
        locale={locale}
        visible={visible}
        request={labRequest}
        onBegin={onBeginLab}
        onTargetChange={onTargetChange}
        onActiveChange={setLabActive}
      />
      <span className="sr-only" role="status">
        {announcement}
      </span>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (value) city?.navigation?.blur();
          setOpen(value);
        }}
      >
        <DialogContent
          className="discovery-journal"
          showCloseButton={false}
          lang={contentLocale}
          finalFocus={() =>
            city?.navigation?.mode !== 'orbit'
              ? (city?.renderer.domElement ?? true)
              : (trigger.current ?? true)
          }
        >
          <DialogClose className="discovery-close" aria-label={text.close}>
            <X size={20} />
          </DialogClose>
          <DialogHeader>
            <div className="discovery-eyebrow">VANCOUVER · FIELD NOTES</div>
            <DialogTitle className="discovery-title">{text.title}</DialogTitle>
            <DialogDescription>{text.intro}</DialogDescription>
          </DialogHeader>
          <div className="discovery-totals">
            <span>
              <BookOpen size={16} />
              <b>{noteCount}/9</b> {text.notes}
            </span>
            <span>
              <Stamp size={17} />
              <b>{stamps}/3</b> {text.stamps}
            </span>
          </div>
          {failure && (
            <p role="alert" className="discovery-error">
              {text.failed}
            </p>
          )}
          <div className="discovery-route-list">
            <article className="discovery-route light-lab-card">
              <div className="discovery-stamp" aria-hidden="true">
                <FlaskConical size={25} />
                <span>LAB</span>
              </div>
              <div className="discovery-route-body">
                <h3>{labText.title}</h3>
                <p>{labText.intro}</p>
                <small>
                  {labText.place} · 3 {labText.progress}
                </small>
                <button
                  className="discovery-primary"
                  onClick={() => {
                    pause();
                    setOpen(false);
                    setLabRequest((value) => value + 1);
                  }}
                >
                  {labText.open}
                  <ArrowUpRight size={16} />
                </button>
              </div>
            </article>
            {DISCOVERY_ROUTES.map((item, index) => {
              const stored = save.routes[item.id];
              return (
                <article
                  className="discovery-route"
                  key={item.id}
                  style={
                    { '--trail-accent': item.accent } as React.CSSProperties
                  }
                >
                  <div
                    className={`discovery-stamp ${stored.stamped ? 'earned' : ''}`}
                    aria-label={`${index + 1}${stored.stamped ? ` · ${text.complete}` : ''}`}
                  >
                    {stored.stamped ? (
                      <Stamp size={25} />
                    ) : (
                      <Footprints size={25} />
                    )}
                    <span>{String(index + 1).padStart(2, '0')}</span>
                  </div>
                  <div className="discovery-route-body">
                    <h3>{discoveryCopy(item.title, locale)}</h3>
                    <p>{discoveryCopy(item.subtitle, locale)}</p>
                    <small>
                      {Math.round(discoveryRouteLength(item))} m · {stored.best}
                      /{item.stops.length} {text.notes}
                    </small>
                    <button
                      className="discovery-primary"
                      onClick={() => begin(item)}
                    >
                      {stored.next === item.stops.length
                        ? text.replay
                        : stored.next
                          ? text.resume
                          : text.start}
                      <ArrowUpRight size={16} />
                    </button>
                    {stored.best > 0 && (
                      <details className="discovery-notes">
                        <summary>
                          {text.unlocked} · {stored.best}
                        </summary>
                        {item.stops.slice(0, stored.best).map((stop) => (
                          <div key={stop.id}>
                            <h4>{discoveryCopy(stop.title, locale)}</h4>
                            <p>{discoveryCopy(stop.note, locale)}</p>
                            {stop.source && (
                              <a
                                className="discovery-source"
                                href={stop.source}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {text.source}
                                <ArrowUpRight size={12} />
                              </a>
                            )}
                          </div>
                        ))}
                      </details>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <div className="discovery-footer">
            <p>{text.joining}</p>
            <p>{text.help}</p>
            <p>{storage ? text.saved : text.memory}</p>
            <small>{text.about}</small>
            {!locale.startsWith('zh') && locale !== 'en' && (
              <small>{text.contentLanguage}</small>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
