'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Compass,
  Plus,
  Minus,
  RotateCcw,
  MapPin,
  Mountain,
  MoveUpRight,
  Play,
  Pause,
  Layers,
  Sun,
  Camera,
  Info,
  X,
  Footprints,
  Car,
  Orbit,
  ChevronsUp,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Maximize,
  Minimize,
  Languages,
  PersonStanding,
  Clock3,
  TrainFront,
  Ship,
  Plane,
  Helicopter,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  DEFAULT_SETTINGS,
  VIEWS,
  type SceneStats,
  type Settings,
} from '@/lib/city/types';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  DEFAULT_LOCALE,
  LANGUAGES,
  LOCALE_STORAGE_KEY,
  resolveLocale,
  translate,
  viewText,
  type Locale,
  type MessageKey,
} from '@/lib/i18n';
import type { CityEngine } from '@/lib/city/engine';
import type { PlacementPreview } from '@/lib/city/placement';
import {
  canSwitchStreetMode,
  type TravelMode,
} from '@/lib/city/placement-geometry';
import {
  DEFAULT_CLOCK,
  CLOCK_RATES,
  formatClock,
  type ClockState,
} from '@/lib/city/clock';

export default function Home() {
  const host = useRef<HTMLDivElement>(null),
    labelHost = useRef<HTMLDivElement>(null),
    minimap = useRef<HTMLCanvasElement>(null),
    engine = useRef<CityEngine | null>(null);
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const tr = useCallback(
    (key: MessageKey, values?: Record<string, string | number>) =>
      translate(locale, key, values),
    [locale],
  );
  const number = (value: number) => value.toLocaleString(locale);
  const language = LANGUAGES.find((item) => item.id === locale)!;
  const chooseLocale = (value: unknown) => {
    const next = resolveLocale(value);
    setLocale(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* Storage can be disabled. */
    }
  };
  useEffect(() => {
    try {
      setLocale(resolveLocale(localStorage.getItem(LOCALE_STORAGE_KEY)));
    } catch {
      /* English remains the default. */
    }
  }, []);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [view, setView] = useState('overview'),
    [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS),
    [panel, setPanel] = useState<'layers' | 'time' | null>(null),
    [hideTime, setHideTime] = useState(false),
    [about, setAbout] = useState(false),
    [tour, setTour] = useState(false),
    [clean, setClean] = useState(false),
    [notice, setNotice] = useState('');
  const [placing, setPlacing] = useState<TravelMode | null>(null);
  const [placementPreview, setPlacementPreview] =
    useState<PlacementPreview | null>(null);
  const [stats, setStats] = useState<SceneStats>({
    buildings: 0,
    roads: 0,
    trees: 0,
    fps: 0,
    distance: 0,
    elevation: 0,
  });
  const clock = stats.clock || DEFAULT_CLOCK;
  const clockLabel = formatClock(clock.hour);
  const changeClock = (patch: Partial<ClockState>) =>
    engine.current?.setClock(patch);
  const restoreStreetFocus = () => {
    const city = engine.current;
    return city?.navigation && city.navigation.mode !== 'orbit'
      ? city.renderer.domElement
      : true;
  };
  const tourIndex = useRef(0),
    settingsRef = useRef(settings);
  settingsRef.current = settings;
  const go = useCallback((id: string) => {
    setView(id);
    setSettings((s) => ({ ...s, mode: 'orbit' }));
    engine.current?.flyTo(id);
  }, []);
  useEffect(() => {
    let stopped = false;
    import('@/lib/city/engine').then(({ CityEngine }) => {
      if (stopped || !host.current) return;
      try {
        engine.current = new CityEngine(
          host.current,
          setStats,
          () => {
            setReady(true);
            engine.current?.setLocale(localeRef.current);
            if (labelHost.current)
              engine.current?.attachLabels(labelHost.current, go);
            if (minimap.current) engine.current?.drawMinimap(minimap.current);
          },
          (message) => {
            setError(message);
            setReady(false);
          },
        );
      } catch (e) {
        setError(String(e));
      }
    });
    return () => {
      stopped = true;
      engine.current?.destroy();
    };
  }, [go]);
  useEffect(() => {
    const placement = engine.current?.placement;
    if (!ready || !placement) return;
    placement.onPreview = setPlacementPreview;
    placement.onCancel = () => setPlacing(null);
    placement.onCommit = (mode) => {
      setPlacing(null);
      setSettings((s) => ({ ...s, mode, autoRotate: false }));
      setNotice('placementStarted');
    };
    return () => {
      placement.onPreview = () => {};
      placement.onCancel = () => {};
      placement.onCommit = () => {};
    };
  }, [ready]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = tr('pageTitle');
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', tr('pageDescription'));
    engine.current?.setLocale(locale);
  }, [locale, ready, tr]);
  useEffect(() => {
    engine.current?.applySettings(settings);
  }, [settings]);
  useEffect(() => {
    if (!tour) return;
    tourIndex.current = 0;
    go(VIEWS[0].id);
    setSettings((s) => ({ ...s, autoRotate: true }));
    const timer = setInterval(() => {
      tourIndex.current = (tourIndex.current + 1) % VIEWS.length;
      go(VIEWS[tourIndex.current].id);
    }, 9500);
    return () => {
      clearInterval(timer);
      setSettings((s) => ({ ...s, autoRotate: false }));
    };
  }, [tour, go]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        if (
          ev.target instanceof Element &&
          ev.target.closest(
            '[role="dialog"], [role="listbox"], [role="option"]',
          )
        )
          return;
        if (engine.current?.placement?.mode) {
          ev.preventDefault();
          engine.current.placement.cancel();
          return;
        }
        setClean(false);
        setPanel(null);
        setTour(false);
        if (settingsRef.current.mode !== 'orbit') go('overview');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [go]);
  // Feature-detected WebMCP navigation follows the same visible UI actions.
  useEffect(() => {
    if (!ready) return;
    const context = (document as Document & { modelContext?: any })
      .modelContext;
    if (!context?.registerTool) return;
    const life = new AbortController();
    const register = (tool: any) => {
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: life.signal }),
        ).catch(() => {});
      } catch {}
    };
    register({
      name: 'read_atlas',
      description:
        'Read available Vancouver viewpoints and the current visible exploration settings.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: () => ({
        viewpoints: VIEWS.map((v) => ({
          id: v.id,
          name: viewText(localeRef.current, v.id, 'name'),
        })),
        settings: settingsRef.current,
        clock: engine.current?.clock.snapshot(),
        language: localeRef.current,
      }),
    });
    register({
      name: 'explore_vancouver',
      description:
        'Move the 3D Vancouver camera to a geographic viewpoint and optionally change simulated time of day.',
      inputSchema: {
        type: 'object',
        properties: {
          viewpoint: { type: 'string', enum: VIEWS.map((v) => v.id) },
          hour: { type: 'number', minimum: 0, maximum: 24 },
        },
        required: ['viewpoint'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async (input: unknown) => {
        const a = input as { viewpoint?: string; hour?: number };
        if (
          !a ||
          !VIEWS.some((v) => v.id === a.viewpoint) ||
          (a.hour !== undefined &&
            (!Number.isFinite(a.hour) || a.hour < 0 || a.hour > 24))
        )
          throw new Error(translate(localeRef.current, 'invalidView'));
        setTour(false);
        go(a.viewpoint!);
        if (a.hour !== undefined) engine.current?.setClock({ hour: a.hour });
        await new Promise((r) => setTimeout(r, 1900));
        return {
          viewpoint: a.viewpoint,
          hour: engine.current?.clock.hour ?? DEFAULT_CLOCK.hour,
        };
      },
    });
    return () => life.abort();
  }, [ready, go]);
  const change = (patch: Partial<Settings>) =>
    setSettings((s) => ({ ...s, ...patch }));
  const selectView = (id: string) => {
    setTour(false);
    go(id);
  };
  const findTrain = (kind: 'steam' | 'skytrain') => {
    if (!ready) return;
    setTour(false);
    setPanel(null);
    setView(kind === 'steam' ? 'railway' : 'skytrain');
    change({ mode: 'orbit', autoRotate: false, trains: true });
    engine.current?.focusTrain(kind);
  };
  const findHarbour = (kind: 'cruise' | 'seaplane' | 'helicopter') => {
    if (!ready) return;
    setTour(false);
    setPanel(null);
    setView('harbour');
    change({ mode: 'orbit', autoRotate: false, harbour: true });
    engine.current?.focusHarbour(kind);
  };
  const current = VIEWS.find((v) => v.id === view)!;
  const capture = () => {
    const url = engine.current?.screenshot();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `Vancouver-${view}-${formatClock(engine.current?.clock.hour ?? DEFAULT_CLOCK.hour).replace(':', '-')}.png`;
    a.click();
    setNotice('savedImage');
  };
  const beginPlacement = (mode: TravelMode) => {
    if (!ready || !engine.current?.placement) {
      setNotice('placementUnavailable');
      return;
    }
    setTour(false);
    setPanel(null);
    setClean(false);
    setNotice('');
    setPlacing(mode);
    change({ mode: 'orbit', autoRotate: false });
    engine.current.placement.begin(mode);
  };
  const switchInScene = (mode: TravelMode) => {
    const city = engine.current;
    if (
      !ready ||
      city?.placement?.mode ||
      !city?.navigation?.switchStreetMode(mode)
    )
      return false;
    setTour(false);
    setPanel(null);
    setNotice('');
    change({ mode, autoRotate: false });
    return true;
  };
  const switchMode = (mode: string) => {
    if (mode === 'orbit') {
      setTour(false);
      engine.current?.placement?.cancel();
      change({ mode: 'orbit', autoRotate: false });
      go(view);
    } else if (!switchInScene(mode as TravelMode))
      beginPlacement(mode as TravelMode);
  };
  const dragFigure = (
    event: React.PointerEvent<HTMLElement>,
    mode: TravelMode,
  ) => {
    if (event.button !== 0 || !ready) return;
    event.preventDefault();
    event.stopPropagation();
    if (switchInScene(mode)) {
      engine.current?.renderer.domElement.focus({ preventScroll: true });
      return;
    }
    beginPlacement(mode);
    event.currentTarget.setPointerCapture(event.pointerId);
    engine.current?.placement?.startDrag(event.nativeEvent);
  };
  const quickStart = (street: string) => {
    if (!placing || !engine.current?.navigation) return;
    const mode = placing;
    engine.current.placement?.cancel();
    engine.current.navigation.setMode(mode, street);
    const actual = engine.current.navigation.mode;
    engine.current.settings.mode = actual;
    change({ mode: actual, autoRotate: false });
    setNotice('streetNotice');
  };
  const helmControl = (direction: string) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (settings.mode !== 'boat') return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      engine.current?.navigation?.hold(direction, true);
    },
    onPointerUp: () => {
      if (settings.mode === 'boat')
        engine.current?.navigation?.hold(direction, false);
    },
    onPointerCancel: () => engine.current?.navigation?.hold(direction, false),
    onLostPointerCapture: () =>
      engine.current?.navigation?.hold(direction, false),
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      if (settings.mode !== 'boat' || event.detail === 0) {
        if (direction === 'neutral') {
          if (engine.current?.navigation)
            engine.current.navigation.boat.state.throttle = 0;
        } else engine.current?.navigation?.step(direction);
      }
    },
  });
  return (
    <main
      className={`atlas ${clean ? 'clean' : ''} ${settings.mode !== 'orbit' ? 'street-mode' : ''} ${placing ? 'placement-mode' : ''}`}
    >
      <div className="scene" ref={host} />
      <div
        className={`map-labels ${!settings.labels || clean ? 'hide-labels' : ''}`}
        ref={labelHost}
      />
      <header className="masthead ui-chrome">
        <a className="brand" href="/" aria-label="Vancouver Living Atlas">
          <span className="brand-mark">
            <Mountain size={22} />
          </span>
          <span>
            VANCOUVER
            <span className="brand-sub">{tr('brandSubtitle')}</span>
          </span>
        </a>
        <div className="header-meta">
          <span className="status-dot" />
          {tr('region')}
          <span className="coord">49°17′ N · 123°08′ W</span>
        </div>
        <div className="language-control">
          <Select value={locale} onValueChange={chooseLocale}>
            <SelectTrigger
              className="language-trigger"
              aria-label={tr('language')}
              title={tr('language')}
            >
              <Languages size={16} />
              <span className="language-full">{language.label}</span>
              <span className="language-short">{language.short}</span>
            </SelectTrigger>
            <SelectContent
              finalFocus={restoreStreetFocus}
              align="end"
              alignItemWithTrigger={false}
              className="language-menu"
            >
              {LANGUAGES.map((item) => (
                <SelectItem key={item.id} value={item.id} lang={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <button
          className="text-button about-button"
          aria-label={tr('about')}
          onClick={() => setAbout(true)}
        >
          <Info size={15} />
          <span>{tr('about')}</span>
        </button>
        <a
          className="github-link"
          href="https://github.com/YiTaChen/vancouver-living-atlas"
          target="_blank"
          rel="noreferrer"
        >
          GitHub <ArrowUpRight size={15} />
        </a>
      </header>
      <div className="mode-switch glass ui-chrome">
        <RadioGroup
          value={placing || settings.mode}
          onValueChange={switchMode}
          className="mode-radio"
          aria-label={tr('explorationMode')}
        >
          {[
            { id: 'orbit', name: tr('orbit'), icon: Orbit },
            { id: 'walk', name: tr('walk'), icon: PersonStanding },
            { id: 'drive', name: tr('drive'), icon: Car },
            { id: 'boat', name: tr('boat'), icon: Ship },
          ].map((m) => (
            <label
              className={`mode-pill ${(placing || settings.mode) === m.id ? 'active' : ''} ${m.id !== 'orbit' && (placing || !canSwitchStreetMode(settings.mode, m.id)) ? 'figure-handle' : ''}`}
              key={m.id}
              title={
                m.id === 'orbit' ||
                (!placing && canSwitchStreetMode(settings.mode, m.id))
                  ? m.name
                  : tr(
                      m.id === 'walk'
                        ? 'placementDragWalk'
                        : m.id === 'boat'
                          ? 'placementDragBoat'
                          : 'placementDragDrive',
                    )
              }
              onPointerDownCapture={
                m.id === 'orbit'
                  ? undefined
                  : (event) => dragFigure(event, m.id as TravelMode)
              }
              onClickCapture={
                m.id === 'orbit'
                  ? undefined
                  : (event) => {
                      if (event.detail > 0) {
                        event.preventDefault();
                        event.stopPropagation();
                      }
                    }
              }
            >
              <RadioGroupItem
                value={m.id}
                disabled={!ready}
                className="mode-radio-dot"
              />
              <m.icon size={15} />
              {m.name}
            </label>
          ))}
        </RadioGroup>
      </div>
      {placing && (
        <>
          <section
            className="placement-panel glass ui-chrome"
            aria-label={tr(
              placing === 'walk'
                ? 'placeWalk'
                : placing === 'boat'
                  ? 'placeBoat'
                  : 'placeDrive',
            )}
          >
            <div className="placement-heading">
              <button
                className="placement-figure figure-handle"
                aria-label={tr(
                  placing === 'walk'
                    ? 'placementDragWalk'
                    : placing === 'boat'
                      ? 'placementDragBoat'
                      : 'placementDragDrive',
                )}
                onPointerDown={(event) => dragFigure(event, placing)}
                onClick={(event) => {
                  if (event.detail === 0) {
                    engine.current?.placement?.aimCentre();
                    engine.current?.renderer.domElement.focus();
                  }
                }}
              >
                {placing === 'walk' ? (
                  <PersonStanding size={29} />
                ) : placing === 'boat' ? (
                  <Ship size={29} />
                ) : (
                  <Car size={29} />
                )}
              </button>
              <h2>
                {tr(
                  placing === 'walk'
                    ? 'placeWalk'
                    : placing === 'boat'
                      ? 'placeBoat'
                      : 'placeDrive',
                )}
              </h2>
              <button
                className="icon-button placement-cancel"
                aria-label={tr('cancelPlacement')}
                title={tr('cancelPlacement')}
                onClick={() => engine.current?.placement?.cancel()}
              >
                <X size={18} />
              </button>
            </div>
            <p>{tr('placementHint')}</p>
            <p className="placement-detail">
              {tr(
                placing === 'walk'
                  ? 'placementWalkHint'
                  : placing === 'boat'
                    ? 'placementBoatHint'
                    : 'placementDriveHint',
              )}
            </p>
            <div
              className={`placement-readout ${placementPreview?.result.valid ? 'valid' : 'invalid'}`}
            >
              <b role="status" aria-live="polite">
                {placementPreview
                  ? placementPreview.result.valid
                    ? tr('placementReady')
                    : tr(placementPreview.result.reason)
                  : tr('placementMoveHint')}
              </b>
              {placementPreview && (
                <span>
                  {tr('placementLocation', {
                    lat: placementPreview.coordinate[1].toFixed(5),
                    lon: placementPreview.coordinate[0].toFixed(5),
                    height: Math.round(placementPreview.height),
                  })}
                </span>
              )}
              {placementPreview?.result.valid && placing === 'drive' && (
                <span>
                  {tr('placementRoad', {
                    name:
                      placementPreview.result.point.name ||
                      tr('placementUnnamedRoad'),
                  })}{' '}
                  ·{' '}
                  {tr('placementRoadSnap', {
                    distance: Math.round(
                      placementPreview.result.point.snappedDistance,
                    ),
                  })}
                </span>
              )}
            </div>
            <div className="placement-actions">
              <button
                className="placement-start"
                disabled={!placementPreview?.result.valid}
                onClick={() => engine.current?.placement?.commit()}
              >
                {tr('placementStart')} <ArrowUpRight size={15} />
              </button>
              <button onClick={() => engine.current?.placement?.cancel()}>
                {tr('cancelPlacement')}
              </button>
            </div>
            <div className="placement-quick">
              <span>{tr('placementQuick')}</span>
              {(placing === 'boat'
                ? [
                    [tr('coalHarbour'), 'coal-harbour'],
                    [tr('falseCreek'), 'false-creek'],
                    [tr('lostLagoon'), 'lost-lagoon'],
                  ]
                : [
                    ['Gastown', 'WATER ST'],
                    ['Robson', 'ROBSON ST'],
                    ['Beach Ave', 'BEACH AV'],
                  ]
              ).map(([label, street]) => (
                <button key={street} onClick={() => quickStart(street)}>
                  {label}
                </button>
              ))}
            </div>
            <p className="sr-only">{tr('placementAim')}</p>
          </section>
          {placementPreview && (
            <div
              className={`placement-marker ${placementPreview.result.valid ? 'valid' : 'invalid'}`}
              style={{
                left: placementPreview.screen[0],
                top: placementPreview.screen[1],
              }}
              aria-hidden="true"
            >
              {placing === 'walk' ? (
                <PersonStanding size={30} />
              ) : placing === 'boat' ? (
                <Ship size={30} />
              ) : (
                <Car size={30} />
              )}
              <span>{placementPreview.result.valid ? '✓' : '×'}</span>
            </div>
          )}
        </>
      )}
      <section className="explore-panel glass ui-chrome">
        <div className="explore-heading">
          <div className="eyebrow">{tr('exploreCoast')}</div>
          <h1>{tr('exploreTitle')}</h1>
          <p className="panel-intro">{tr('exploreIntro')}</p>
        </div>
        <div className="view-list">
          {VIEWS.map((v, i) => (
            <button
              key={v.id}
              aria-pressed={view === v.id}
              className={`view-button ${view === v.id ? 'selected' : ''}`}
              onClick={() => selectView(v.id)}
            >
              <span className="view-number">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span>
                <b>{viewText(locale, v.id, 'name')}</b>
                <small>{viewText(locale, v.id, 'tag')}</small>
              </span>
              <MoveUpRight size={15} />
            </button>
          ))}
        </div>
        <button
          className={`tour-button ${tour ? 'active' : ''}`}
          onClick={() => setTour((t) => !t)}
        >
          {tour ? <Pause size={16} /> : <Play size={16} />}
          <span>{tour ? tr('pauseTour') : tr('startTour')}</span>
          <span className="tour-time">
            {tour
              ? `${tourIndex.current + 1} / ${VIEWS.length}`
              : tr('viewpointCount', { count: VIEWS.length })}
          </span>
        </button>
        <div className="panel-foot">
          <span className="status-dot" /> {tr('originalBuild')}
        </div>
      </section>
      <div className="nav-tools glass ui-chrome">
        <button
          title={tr('zoomIn')}
          aria-label={tr('zoomIn')}
          onClick={() => engine.current?.zoom(0.75)}
          disabled={settings.mode !== 'orbit'}
        >
          <Plus size={20} />
        </button>
        <button
          title={tr('zoomOut')}
          aria-label={tr('zoomOut')}
          onClick={() => engine.current?.zoom(1.33)}
          disabled={settings.mode !== 'orbit'}
        >
          <Minus size={20} />
        </button>
        <span />
        <button
          title={tr('resetView')}
          aria-label={tr('resetView')}
          onClick={() => selectView('overview')}
        >
          <RotateCcw size={18} />
        </button>
        <button
          title={tr('northView')}
          aria-label={tr('northView')}
          onClick={() => {
            selectView('overview');
            engine.current?.fly({ ...VIEWS[0], azimuth: 0 });
          }}
        >
          <Compass
            size={20}
            style={{
              transform: `rotate(${(-(stats.heading || 0) * 180) / Math.PI}deg)`,
            }}
          />
        </button>
        <span />
        <button
          title={
            hideTime
              ? tr('timeControls')
              : `${tr('timeControls')} · ${clockLabel}`
          }
          aria-label={
            hideTime
              ? tr('timeControls')
              : tr('timeClockLabel', {
                  time: clockLabel,
                  state: tr(clock.running ? 'timeRunning' : 'timeFixed'),
                })
          }
          aria-expanded={panel === 'time'}
          aria-controls="time-panel"
          className={`clock-tool ${hideTime ? 'time-hidden' : ''} ${panel === 'time' ? 'active' : ''} ${clock.running ? 'running' : 'fixed'}`}
          disabled={!ready}
          onClick={() => setPanel((p) => (p === 'time' ? null : 'time'))}
        >
          <Clock3 size={17} />
          {!hideTime && <span className="clock-tool-time">{clockLabel}</span>}
        </button>
        <button
          title={tr('lightingLayers')}
          aria-label={tr('lightingLayers')}
          aria-expanded={panel === 'layers'}
          aria-controls="layers-panel"
          className={panel === 'layers' ? 'active' : ''}
          onClick={() => setPanel((p) => (p === 'layers' ? null : 'layers'))}
        >
          <Layers size={19} />
        </button>
        <button
          title={tr('downloadImage')}
          aria-label={tr('downloadImage')}
          onClick={capture}
        >
          <Camera size={19} />
        </button>
        <button
          title={tr('immersiveView')}
          aria-label={tr('immersiveView')}
          onClick={() => setClean(true)}
        >
          <Maximize size={18} />
        </button>
      </div>
      {panel === 'time' && (
        <section
          id="time-panel"
          className="settings-panel time-panel glass ui-chrome"
          aria-label={tr('timeControls')}
        >
          <div className="settings-title">
            <h2>
              <Clock3 size={18} />
              {tr('timeControls')}
            </h2>
            <button
              className="icon-button"
              aria-label={tr('closeTime')}
              onClick={() => setPanel(null)}
            >
              <X size={17} />
            </button>
          </div>
          <div className="sun-readout">
            <Sun size={20} />
            <span>
              {clock.hour >= 6 && clock.hour < 18
                ? tr('day')
                : clock.hour >= 18 && clock.hour < 21
                  ? tr('dusk')
                  : tr('night')}
            </span>
            <strong>{clockLabel}</strong>
          </div>
          <label className="layer-row time-flow-switch">
            <span>{tr('timeHide')}</span>
            <Switch
              aria-label={tr('timeHide')}
              aria-describedby="time-hide-hint"
              checked={hideTime}
              onCheckedChange={setHideTime}
            />
          </label>
          <p className="clock-background-note" id="time-hide-hint">
            {tr('timeHideHint')}
          </p>
          <label className="layer-row time-flow-switch">
            <span>{tr('timeFlow')}</span>
            <Switch
              aria-label={tr('timeFlow')}
              checked={clock.running}
              onCheckedChange={(running) => changeClock({ running })}
            />
          </label>
          <p className={`clock-state ${clock.running ? 'running' : 'fixed'}`}>
            {clock.running ? <Play size={12} /> : <Pause size={12} />}
            {tr(clock.running ? 'timeRunning' : 'timeFixed')}
          </p>
          <div className="settings-divider" />
          <label className="clock-field-label" id="time-speed-label">
            {tr('timeSpeed')}
          </label>
          <Select
            value={String(clock.rate)}
            onValueChange={(value) => {
              if (value !== null) changeClock({ rate: Number(value) });
            }}
          >
            <SelectTrigger
              className="clock-rate-trigger"
              aria-labelledby="time-speed-label"
            >
              <span>
                {tr('timeRate', { rate: clock.rate })}
                {clock.rate === 1
                  ? ` · ${tr('realTime')}`
                  : clock.rate === DEFAULT_CLOCK.rate
                    ? ` · ${tr('timeDefault')}`
                    : ''}
              </span>
            </SelectTrigger>
            <SelectContent
              finalFocus={restoreStreetFocus}
              alignItemWithTrigger={false}
              className="language-menu"
            >
              {CLOCK_RATES.map((rate) => (
                <SelectItem key={rate} value={String(rate)}>
                  {tr('timeRate', { rate })}
                  {rate === 1
                    ? ` · ${tr('realTime')}`
                    : rate === DEFAULT_CLOCK.rate
                      ? ` · ${tr('timeDefault')}`
                      : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="clock-explanation">
            {tr('timeRateHint', { minutes: number(clock.rate) })}
            <br />
            {tr('timeDayLength', { minutes: number(1440 / clock.rate) })}
          </p>
          <div className="settings-divider" />
          <label className="clock-field-label">{tr('timeSeek')}</label>
          <Slider
            aria-label={tr('timeSeek')}
            min={0}
            max={1439}
            step={1}
            value={[Math.floor(clock.hour * 60)]}
            onValueChange={(value) =>
              changeClock({
                hour: (Array.isArray(value) ? value[0] : value) / 60,
              })
            }
          />
          <div className="clock-range">
            <span>00:00</span>
            <span>12:00</span>
            <span>23:59</span>
          </div>
          <div className="time-presets">
            {[
              { label: tr('morning'), hour: 8 },
              { label: tr('afternoon'), hour: 15 },
              { label: tr('sunset'), hour: 18 },
              { label: tr('afterDark'), hour: 22 },
            ].map((preset) => (
              <button
                key={preset.hour}
                onClick={() => changeClock({ hour: preset.hour })}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="settings-note">
            {tr(clock.running ? 'timeFlowHint' : 'timeFixedHint')}
          </p>
          <p className="clock-background-note">
            {tr('timeBackgroundHint')} {tr('simulatedNote')}
          </p>
        </section>
      )}
      {panel === 'layers' && (
        <section
          id="layers-panel"
          className="settings-panel glass ui-chrome"
          aria-label={tr('lightingSettings')}
        >
          <div className="settings-title">
            <h2>{tr('lightingLayers')}</h2>
            <button
              className="icon-button"
              aria-label={tr('closeSettings')}
              onClick={() => setPanel(null)}
            >
              <X size={17} />
            </button>
          </div>
          {[
            { key: 'buildings', label: tr('buildingsLayer') },
            { key: 'trees', label: tr('treesLayer') },
            { key: 'traffic', label: tr('trafficLayer') },
            { key: 'trains', label: tr('trainsLayer') },
            { key: 'harbour', label: tr('harbourLayer') },
            { key: 'labels', label: tr('labelsLayer') },
            { key: 'autoRotate', label: tr('autoRotate') },
          ].map((s) => (
            <label className="layer-row" key={s.key}>
              <span>{s.label}</span>
              <Switch
                aria-label={s.label}
                checked={Boolean(settings[s.key as keyof Settings])}
                onCheckedChange={(v) => change({ [s.key]: v })}
              />
            </label>
          ))}
          <div className="rail-actions">
            <button disabled={!ready} onClick={() => findTrain('steam')}>
              <TrainFront size={16} /> {tr('findSteamTrain')}
            </button>
            <button disabled={!ready} onClick={() => findTrain('skytrain')}>
              <TrainFront size={16} /> {tr('findSkyTrain')}
            </button>
          </div>
          <p className="clock-background-note">{tr('railNote')}</p>
          <div className="rail-actions">
            <button
              onClick={() => {
                setPanel(null);
                change({ harbour: true });
                selectView('harbour');
              }}
            >
              <Ship size={16} />
              {tr('findHarbour')}
            </button>
          </div>
          <div className="rail-actions">
            {(
              [
                { id: 'seaplane', icon: Plane, label: 'findSeaplane' },
                { id: 'helicopter', icon: Helicopter, label: 'findHelicopter' },
                { id: 'cruise', icon: Ship, label: 'findCruise' },
              ] as const
            ).map((a) => (
              <button
                key={a.id}
                disabled={!ready}
                onClick={() => findHarbour(a.id)}
              >
                <a.icon size={16} />
                {tr(a.label)}
              </button>
            ))}
          </div>
          <p className="clock-background-note">{tr('harbourNote')}</p>
          <div className="settings-divider" />
          <label className="quality-label">{tr('quality')}</label>
          <RadioGroup
            aria-label={tr('quality')}
            value={settings.quality}
            onValueChange={(q) => change({ quality: q as Settings['quality'] })}
            className="quality-options"
          >
            <label>
              <RadioGroupItem value="high" />
              {tr('highQuality')}
            </label>
            <label>
              <RadioGroupItem value="balanced" />
              {tr('balancedQuality')}
            </label>
          </RadioGroup>
        </section>
      )}
      <section className="map-inset glass ui-chrome">
        <div className="mini-title">
          <span>{tr('peninsula')}</span>
          <span>N ↑</span>
        </div>
        <canvas
          ref={minimap}
          width={340}
          height={268}
          aria-label={tr('minimap')}
          onClick={(ev) => {
            if (settings.mode !== 'orbit') return;
            engine.current?.navigateMinimap(ev.nativeEvent);
          }}
        />
        <div className="mini-caption">
          <span>Stanley Park ↔ Science World</span>
          <span>5 km</span>
        </div>
      </section>
      {settings.mode !== 'orbit' && (
        <div className="street-controls glass ui-chrome">
          <div className="street-title">
            <span>
              {settings.mode === 'drive'
                ? tr('streetDrive')
                : settings.mode === 'boat'
                  ? tr('streetBoat')
                  : tr('streetWalk')}
            </span>
            {(settings.mode === 'drive' || settings.mode === 'boat') && (
              <b>
                {settings.mode === 'boat'
                  ? (Math.abs(stats.speed || 0) / 1.852).toFixed(1)
                  : Math.abs(stats.speed || 0)}{' '}
                <small>{settings.mode === 'boat' ? 'kn' : 'km/h'}</small>
              </b>
            )}
          </div>
          <button
            className="choose-start"
            onClick={() => beginPlacement(settings.mode as TravelMode)}
          >
            <MapPin size={16} />
            {tr('placementChange')}
          </button>
          <div className="street-shortcuts">
            {(settings.mode === 'boat'
              ? [
                  [tr('coalHarbour'), 'coal-harbour'],
                  [tr('falseCreek'), 'false-creek'],
                  [tr('lostLagoon'), 'lost-lagoon'],
                ]
              : [
                  ['Gastown', 'WATER ST'],
                  ['Robson', 'ROBSON ST'],
                  ['Beach Ave', 'BEACH AV'],
                ]
            ).map(([label, id]) => (
              <button
                key={id}
                onClick={() =>
                  engine.current?.navigation?.setMode(settings.mode, id)
                }
              >
                {label}
              </button>
            ))}
            {settings.mode !== 'boat' && (
              <button
                onClick={() =>
                  engine.current?.navigation?.startBridge('burrard')
                }
              >
                Burrard
              </button>
            )}
          </div>
          <p>
            {tr(settings.mode === 'boat' ? 'boatMovementHelp' : 'movementHelp')}
            <br />
            {settings.mode === 'boat'
              ? tr('boatNeutralHelp')
              : settings.mode === 'drive'
                ? tr('brakeHelp')
                : tr('speedHelp')}{' '}
            · {tr('lookHelp')}
          </p>
          {settings.mode === 'boat' && (
            <button className="boat-neutral" {...helmControl('neutral')}>
              {tr('boatNeutral')}
            </button>
          )}
          <div className="dpad">
            <button aria-label={tr('turnLeft')} {...helmControl('left')}>
              <ChevronLeft />
            </button>
            <button aria-label={tr('moveForward')} {...helmControl('forward')}>
              <ChevronsUp />
            </button>
            <button
              aria-label={tr('moveBackward')}
              {...helmControl('backward')}
            >
              <ChevronDown />
            </button>
            <button aria-label={tr('turnRight')} {...helmControl('right')}>
              <ChevronRight />
            </button>
          </div>
        </div>
      )}
      <div className="view-caption ui-chrome">
        <span>
          {viewText(locale, current.id, 'tag')} /{' '}
          {String(VIEWS.indexOf(current) + 1).padStart(2, '0')}
        </span>
        <h2>{viewText(locale, current.id, 'name')}</h2>
        <p>{viewText(locale, current.id, 'description')}</p>
      </div>
      <footer className="bottom-bar glass ui-chrome">
        <div>
          <MapPin size={15} />
          <b>
            {settings.mode === 'orbit'
              ? viewText(locale, current.id, 'name')
              : settings.mode === 'walk'
                ? tr('streetWalk')
                : settings.mode === 'boat'
                  ? tr('streetBoat')
                  : tr('streetDrive')}
          </b>
          <span className="muted">
            {settings.mode === 'orbit'
              ? tr('viewDistance', { distance: number(stats.distance) })
              : tr('elevation', { height: number(stats.elevation) })}
          </span>
        </div>
        <div className="scene-count">
          <span>{tr('buildingCount', { count: number(stats.buildings) })}</span>
          <span>{tr('treeCount', { count: number(stats.trees) })}</span>
          <span>{stats.fps} FPS</span>
        </div>
        <p>{settings.mode === 'orbit' ? tr('orbitHelp') : tr('escapeHelp')}</p>
      </footer>
      <div className="attribution ui-chrome">
        <a
          href="https://opendata.vancouver.ca/pages/licence/"
          target="_blank"
          rel="noreferrer"
        >
          City of Vancouver · OGL
        </a>
        <span> / </span>
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap · ODbL
        </a>
      </div>
      {clean && (
        <button className="exit-clean glass" onClick={() => setClean(false)}>
          <Minimize size={16} />
          {tr('restoreControls')}
        </button>
      )}
      {notice && (
        <div className="toast glass" role="status">
          {tr(notice as MessageKey)}
        </div>
      )}
      <Dialog open={about} onOpenChange={setAbout}>
        <DialogContent className="about-dialog" showCloseButton={false}>
          <DialogClose
            className="about-close icon-button"
            aria-label={tr('close')}
          >
            <X size={18} />
          </DialogClose>
          <DialogHeader>
            <DialogTitle>{tr('pageTitle')}</DialogTitle>
            <DialogDescription>{tr('aboutIntro')}</DialogDescription>
          </DialogHeader>
          <p>{tr('aboutBody')}</p>
          <dl>
            {(['terrain', 'buildings', 'detail', 'license'] as const).map(
              (section) => (
                <div key={section}>
                  <dt>{tr(`${section}Heading`)}</dt>
                  <dd>{tr(`${section}Body`)}</dd>
                </div>
              ),
            )}
          </dl>
          <div className="about-links">
            <a
              href="https://github.com/YiTaChen/vancouver-living-atlas"
              target="_blank"
              rel="noreferrer"
            >
              {tr('sourceHistory')} <ArrowUpRight size={14} />
            </a>
            <a
              href="https://github.com/YiTaChen/vancouver-living-atlas/blob/main/DATA_SOURCES.md"
              target="_blank"
              rel="noreferrer"
            >
              {tr('dataAccuracy')} <ArrowUpRight size={14} />
            </a>
          </div>
        </DialogContent>
      </Dialog>
      {!ready && (
        <div className="loading-overlay">
          <div className="loading-brand">
            <Mountain size={40} />
            <h2>VANCOUVER</h2>
            <p>{error ? tr('loadFailed') : tr('loading')}</p>
            {error ? (
              <>
                <p>
                  {tr(
                    error === 'graphics-context-lost'
                      ? 'graphicsError'
                      : 'loadErrorDetail',
                  )}
                </p>
                <button onClick={() => location.reload()}>
                  {tr('reload')}
                </button>
              </>
            ) : (
              <>
                <div className="loading-line" />
                <p>{tr('loadingDetails')}</p>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
