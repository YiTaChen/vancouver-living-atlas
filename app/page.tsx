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
    [panel, setPanel] = useState(false),
    [about, setAbout] = useState(false),
    [tour, setTour] = useState(false),
    [clean, setClean] = useState(false),
    [notice, setNotice] = useState('');
  const [stats, setStats] = useState<SceneStats>({
    buildings: 0,
    roads: 0,
    trees: 0,
    fps: 0,
    distance: 0,
    elevation: 0,
  });
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
        setClean(false);
        setPanel(false);
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
        if (a.hour !== undefined) setSettings((s) => ({ ...s, hour: a.hour! }));
        await new Promise((r) => setTimeout(r, 1900));
        return {
          viewpoint: a.viewpoint,
          hour: a.hour ?? settingsRef.current.hour,
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
  const current = VIEWS.find((v) => v.id === view)!;
  const capture = () => {
    const url = engine.current?.screenshot();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `Vancouver-${view}-${String(settings.hour).replace('.', '-')}.png`;
    a.click();
    setNotice('savedImage');
  };
  const switchMode = (mode: string) => {
    setTour(false);
    change({ mode: mode as Settings['mode'], autoRotate: false });
    if (mode === 'orbit') go(view);
    if (mode !== 'orbit') setNotice('streetNotice');
  };
  return (
    <main
      className={`atlas ${clean ? 'clean' : ''} ${settings.mode !== 'orbit' ? 'street-mode' : ''}`}
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
          value={settings.mode}
          onValueChange={switchMode}
          className="mode-radio"
          aria-label={tr('explorationMode')}
        >
          {[
            { id: 'orbit', name: tr('orbit'), icon: Orbit },
            { id: 'walk', name: tr('walk'), icon: Footprints },
            { id: 'drive', name: tr('drive'), icon: Car },
          ].map((m) => (
            <label
              className={`mode-pill ${settings.mode === m.id ? 'active' : ''}`}
              key={m.id}
            >
              <RadioGroupItem value={m.id} className="mode-radio-dot" />
              <m.icon size={15} />
              {m.name}
            </label>
          ))}
        </RadioGroup>
      </div>
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
              <span className="view-number">0{i + 1}</span>
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
            {tour ? `${tourIndex.current + 1} / 8` : tr('viewpointCount')}
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
          title={tr('lightingLayers')}
          aria-label={tr('lightingLayers')}
          aria-expanded={panel}
          className={panel ? 'active' : ''}
          onClick={() => setPanel((p) => !p)}
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
      {panel && (
        <section
          className="settings-panel glass ui-chrome"
          aria-label={tr('lightingSettings')}
        >
          <div className="settings-title">
            <h2>{tr('lightingLayers')}</h2>
            <button
              className="icon-button"
              aria-label={tr('closeSettings')}
              onClick={() => setPanel(false)}
            >
              <X size={17} />
            </button>
          </div>
          <div className="sun-readout">
            <Sun size={20} />
            <span>
              {settings.hour >= 6 && settings.hour < 18
                ? tr('day')
                : settings.hour >= 18 && settings.hour < 21
                  ? tr('dusk')
                  : tr('night')}
            </span>
            <strong>
              {String(Math.floor(settings.hour)).padStart(2, '0')}:
              {settings.hour % 1 ? '30' : '00'}
            </strong>
          </div>
          <Slider
            aria-label={tr('simulatedTime')}
            min={0}
            max={23.5}
            step={0.5}
            value={[settings.hour]}
            onValueChange={(v) => change({ hour: Array.isArray(v) ? v[0] : v })}
          />
          <div className="time-presets">
            {[
              { label: tr('morning'), hour: 8 },
              { label: tr('afternoon'), hour: 15 },
              { label: tr('sunset'), hour: 18 },
              { label: tr('afterDark'), hour: 22 },
            ].map((t) => (
              <button key={t.hour} onClick={() => change({ hour: t.hour })}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="settings-divider" />
          {[
            { key: 'buildings', label: tr('buildingsLayer') },
            { key: 'trees', label: tr('treesLayer') },
            { key: 'traffic', label: tr('trafficLayer') },
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
          <p className="settings-note">{tr('simulatedNote')}</p>
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
              {settings.mode === 'drive' ? tr('streetDrive') : tr('streetWalk')}
            </span>
            {settings.mode === 'drive' && (
              <b>
                {Math.abs(stats.speed || 0)} <small>km/h</small>
              </b>
            )}
          </div>
          <div className="street-shortcuts">
            <button
              onClick={() =>
                engine.current?.navigation?.setMode(settings.mode, 'WATER ST')
              }
            >
              Gastown
            </button>
            <button
              onClick={() =>
                engine.current?.navigation?.setMode(settings.mode, 'ROBSON ST')
              }
            >
              Robson
            </button>
            <button
              onClick={() =>
                engine.current?.navigation?.setMode(settings.mode, 'BEACH AV')
              }
            >
              Beach Ave
            </button>
            <button
              onClick={() => engine.current?.navigation?.startBridge('burrard')}
            >
              Burrard
            </button>
          </div>
          <p>
            {tr('movementHelp')}
            <br />
            {settings.mode === 'drive' ? tr('brakeHelp') : tr('speedHelp')} ·{' '}
            {tr('lookHelp')}
          </p>
          <div className="dpad">
            <button
              aria-label={tr('turnLeft')}
              onClick={() => engine.current?.navigation?.step('left')}
            >
              <ChevronLeft />
            </button>
            <button
              aria-label={tr('moveForward')}
              onClick={() => engine.current?.navigation?.step('forward')}
            >
              <ChevronsUp />
            </button>
            <button
              aria-label={tr('moveBackward')}
              onClick={() => engine.current?.navigation?.step('backward')}
            >
              <ChevronDown />
            </button>
            <button
              aria-label={tr('turnRight')}
              onClick={() => engine.current?.navigation?.step('right')}
            >
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
