'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Rocket,
  X,
  AlertTriangle,
  ShieldCheck,
  Camera,
  CircleCheck,
  RotateCcw,
  Map,
  HelpCircle,
  Flame,
  Wrench,
  Navigation,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { TravelJoystick } from './travel-joystick';
import type { RocketController } from '@/lib/city/rocket-controller';
import type { RocketSnapshot } from '@/lib/city/rocket-snapshot';
import type { Locale } from '@/lib/i18n';
import './rocket-controls.css';

const en = {
  rocket: 'Rocket',
  title: 'Vancouver launch program',
  choose: 'Choose your rocket',
  chooseHint:
    'Build a rocket anywhere in the city, then pilot it to the edge of space.',
  small: 'Scout · Small rocket',
  large: 'Atlas · Heavy rocket',
  smallHint:
    'Agile and light. Roof launches are possible, but wind can tip it.',
  largeHint: 'More stable in flight. Needs a strong, open launch foundation.',
  placement: 'Click or tap the city to place your rocket.',
  placementHint:
    'Water and rooftops are allowed. Their physical risks still apply.',
  cancel: 'Cancel',
  close: 'Close',
  building: 'Assembly in progress',
  buildingHint:
    'The crew is assembling your rocket while flight and space systems load.',
  loading: 'Preparing flight and space systems…',
  ready: 'Ready for launch',
  launch: 'Begin 5-second countdown',
  launchShort: 'Launch',
  countdown: 'Launch countdown',
  ignition: 'Ignition',
  flight: 'Ascent',
  space: 'Space reached',
  sinking: 'Foundation lost · sinking',
  crashed: 'Rocket lost',
  aborted: 'Launch aborted',
  abort: 'Abort launch',
  city: 'Back to Vancouver',
  newRocket: 'New rocket',
  retry: 'Rebuild at this site',
  loadError:
    'Flight systems could not load. Your rocket is safe to rebuild or retry.',
  retryLoad: 'Retry loading',
  auto: 'Autopilot',
  manual: 'Manual',
  guidance: 'Guidance',
  stabilization: 'Stability assist',
  on: 'On',
  off: 'Off',
  first: 'First person',
  chase: 'Third person',
  view: 'Camera view',
  throttle: 'Throttle',
  altitude: 'Altitude',
  speed: 'Speed',
  fuel: 'Fuel',
  tilt: 'Tilt',
  wind: 'Wind',
  support: 'Support',
  ground: 'Ground foundation',
  platform: 'Strong launch platform',
  roofSmall: 'Small rooftop',
  roofLarge: 'Large rooftop',
  ocean: 'Ocean surface',
  river: 'River surface',
  lake: 'Unstable lake bed',
  groundRisk:
    'Open ground offers solid support. Keep clear of trees and buildings.',
  platformRisk: 'A broad platform provides strong support for a heavy launch.',
  smallRoofRisk:
    'A small rocket can launch here. Exhaust and wind may damage the roof.',
  heavyRoofRisk:
    'Heavy rocket: exhaust can destroy this roof, collapse its support, and tip the vehicle.',
  largeRoofRisk:
    'A broad roof offers more support, but exhaust can still weaken the building.',
  seaRisk: 'No floating launch platform: the rocket will sink into the sea.',
  riverRisk:
    'No floating launch platform: the rocket will sink into the river.',
  lakeRisk:
    'The lake bed is unstable. Support can settle unevenly and tip the rocket.',
  consequence:
    'Ignition produces heat and blast pressure: nearby buildings, trees, vehicles, and street objects can be damaged.',
  help: 'Flight guide',
  controls:
    'W/S: pitch · A/D: bank · R/F: throttle · Space: launch · C: camera · M: guidance · X: abort · Esc: city',
  touchHint:
    'Drag the stick gently to steer. Use the throttle on the right to control engine power.',
  manualHint:
    'Small corrections work best. Excessive tilt can lead to an inverted fall. Stability assist reduces rotation; autopilot also guides the ascent.',
  gameplay:
    'A stylized flight simulation. Time, distance, and blast effects are scaled for play.',
  complete: 'Mission complete',
  completeHint:
    'You crossed 100 km above Earth. Take in the Sun, Moon, and planets from your rocket.',
  staySpace: 'Observe space',
  mission: 'Target · 100 km',
  peak: 'Altitude reached',
  damage: 'Buildings damaged',
  burning: 'Fires',
  debris: 'Debris fragments',
  resetDamage: 'Restore city',
  resetHint:
    'Restores buildings, vegetation, and objects affected by this rocket session.',
  lowFuel: 'Fuel reserve low',
  unstable: 'High tilt · reduce steering input',
  supportLost: 'Foundation collapsing',
  sound: 'Launch sound',
  returnHint: 'Returning to Vancouver restores the city after this launch.',
  autoShort: 'Auto',
  manualShort: 'Manual',
  cityShort: 'City view',
  cancelBuild: 'Cancel build',
  groundShort: 'Solid ground. Exhaust can damage nearby objects.',
  platformShort: 'Strong platform. Keep the exhaust area clear.',
  smallRoofShort: 'Roof launch: watch for wind and exhaust damage.',
  heavyRoofShort: 'Weak roof: heavy exhaust can collapse it.',
  largeRoofShort: 'Roof support may weaken under exhaust.',
  waterShort: 'Water cannot support the rocket. It will sink.',
  lakeShort: 'Unstable lake bed: settling may tip the rocket.',
  attitude: 'Flight attitude',
  pitch: 'Pitch',
  roll: 'Roll',
  climb: 'Climb',
} as const;

type RocketTextKey = keyof typeof en;
const zh: Record<RocketTextKey, string> = {
  rocket: '火箭',
  title: '溫哥華太空計畫',
  choose: '選擇你的火箭',
  chooseHint: '在城市任意地點搭建火箭，親自駕駛或自動飛向太空。',
  small: 'Scout · 小型火箭',
  large: 'Atlas · 大型火箭',
  smallHint: '輕巧、轉向靈活。可從屋頂起飛，但容易受風偏移。',
  largeHint: '飛行較穩定。需要寬廣且堅固的發射地基。',
  placement: '點選城市中的地點來放置火箭。',
  placementHint: '可以放在水面與屋頂，但仍會承受對應的物理風險。',
  cancel: '取消',
  close: '關閉',
  building: '火箭搭建中',
  buildingHint: '工作團隊正在組裝火箭，同時載入飛行與太空系統。',
  loading: '正在準備飛行與太空系統…',
  ready: '準備發射',
  launch: '開始 5 秒倒數',
  launchShort: '發射',
  countdown: '發射倒數',
  ignition: '點火',
  flight: '升空中',
  space: '抵達太空',
  sinking: '失去地基支撐 · 下沉中',
  crashed: '火箭墜毀',
  aborted: '發射已中止',
  abort: '中止發射',
  city: '返回溫哥華',
  newRocket: '新火箭',
  retry: '在此重新搭建',
  loadError: '飛行系統載入失敗。可以重試載入或重新搭建火箭。',
  retryLoad: '重試載入',
  auto: '自動駕駛',
  manual: '手動操控',
  guidance: '飛行控制',
  stabilization: '穩定輔助',
  on: '開啟',
  off: '關閉',
  first: '第一視角',
  chase: '第三視角',
  view: '鏡頭視角',
  throttle: '推力',
  altitude: '高度',
  speed: '速度',
  fuel: '燃料',
  tilt: '傾斜',
  wind: '風速',
  support: '地基',
  ground: '地面地基',
  platform: '堅固平台',
  roofSmall: '小型建築屋頂',
  roofLarge: '大型建築屋頂',
  ocean: '海面',
  river: '河面',
  lake: '不穩定湖床',
  groundRisk: '開闊地面提供良好支撐。請注意周圍的樹木與建築物。',
  platformRisk: '寬廣平台能為大型火箭提供堅固的發射支撐。',
  smallRoofRisk: '小火箭可以在這裡發射，但噴流與風壓仍可能損壞屋頂。',
  heavyRoofRisk: '大型火箭的噴流可能摧毀屋頂，造成地基垮塌與火箭失衡。',
  largeRoofRisk: '寬廣屋頂有較強支撐，但噴流仍可能削弱建築結構。',
  seaRisk: '沒有浮動發射平台，火箭會沉入海中。',
  riverRisk: '沒有浮動發射平台，火箭會沉入河中。',
  lakeRisk: '湖床地基不穩，可能不均勻下沉，導致火箭傾斜。',
  consequence:
    '點火會產生高熱與風壓：附近建築、樹木、車輛及街道物件都可能受損。',
  help: '飛行指南',
  controls:
    'W/S：俯仰 · A/D：側傾 · R/F：推力 · Space：發射 · C：視角 · M：控制模式 · X：中止 · Esc：返回城市',
  touchHint: '輕推左側搖桿來轉向，使用右側推力控制引擎。',
  manualHint:
    '請小幅修正方向。過度傾斜可能倒置墜落。穩定輔助會抑制旋轉，自動駕駛也會引導升空路線。',
  gameplay: '這是風格化飛行模擬，時間、距離與噴流效果會依遊戲體驗縮放。',
  complete: '任務完成',
  completeHint: '你已穿越地球上方 100 公里，現在可以觀察太陽、月球與其他行星。',
  staySpace: '留在太空觀察',
  mission: '目標 · 100 公里',
  peak: '抵達高度',
  damage: '受損建築',
  burning: '起火',
  debris: '碎片',
  resetDamage: '修復城市',
  resetHint: '恢復這次火箭模擬中受損的建築、植被與物件。',
  lowFuel: '燃料存量偏低',
  unstable: '傾斜過大 · 請減少轉向操作',
  supportLost: '地基正在垮塌',
  sound: '發射音效',
  returnHint: '返回溫哥華時，會重置這次發射對城市造成的影響。',
  autoShort: '自動',
  manualShort: '手動',
  cityShort: '城市視角',
  cancelBuild: '取消搭建',
  groundShort: '地面穩固，噴流可能損壞周圍物件。',
  platformShort: '堅固平台，請留意噴流影響範圍。',
  smallRoofShort: '屋頂發射：請注意風力與噴流損壞。',
  heavyRoofShort: '屋頂脆弱，大型火箭的噴流可能造成垮塌。',
  largeRoofShort: '噴流仍可能削弱屋頂結構。',
  waterShort: '水面無法支撐火箭，放置後會下沉。',
  lakeShort: '湖床不穩，不均勻下沉可能讓火箭傾斜。',
  attitude: '飛行姿態',
  pitch: '俯仰',
  roll: '側傾',
  climb: '爬升',
};

/** New rocket strings fall back to English for the app's other locales. */
export function rocketText(locale: Locale, key: RocketTextKey): string {
  return locale === 'zh-Hant' || locale === 'zh-Hans' ? zh[key] : en[key];
}

function supportKey(support: string): RocketTextKey {
  return (
    ({ 'roof-small': 'roofSmall', 'roof-large': 'roofLarge' } as const)[
      support as 'roof-small' | 'roof-large'
    ] ||
    (['ground', 'platform', 'ocean', 'river', 'lake'].includes(support)
      ? (support as RocketTextKey)
      : 'ground')
  );
}

function riskKey(state: RocketSnapshot): RocketTextKey {
  if (state.support === 'ocean') return 'seaRisk';
  if (state.support === 'river') return 'riverRisk';
  if (state.support === 'lake') return 'lakeRisk';
  if (state.support === 'roof-small')
    return state.kind === 'large' ? 'heavyRoofRisk' : 'smallRoofRisk';
  if (state.support === 'roof-large') return 'largeRoofRisk';
  return state.support === 'platform' ? 'platformRisk' : 'groundRisk';
}

export function RocketControls({
  controller,
  snapshot: state,
  locale,
  touch,
  choosing = false,
  onChoose,
  onCloseChoosing,
  controlsEnabled = true,
  panelVisible = true,
  optionsOpen = false,
  onCloseOptions,
  hidden = false,
  minimal = false,
}: {
  controller: RocketController | null;
  snapshot: RocketSnapshot;
  locale: Locale;
  touch: boolean;
  choosing?: boolean;
  onChoose: (kind: 'small' | 'large') => void;
  onCloseChoosing: () => void;
  controlsEnabled?: boolean;
  panelVisible?: boolean;
  optionsOpen?: boolean;
  onCloseOptions?: () => void;
  hidden?: boolean;
  minimal?: boolean;
}) {
  const [help, setHelp] = useState(false);
  const [muted, setMuted] = useState(false);
  const [spaceDismissed, setSpaceDismissed] = useState(false);
  const t = (key: RocketTextKey) => rocketText(locale, key);
  const manualFlight = state.active && state.phase === 'flight' && !state.auto;
  const canInput = controlsEnabled && !hidden && !choosing;
  const move = useCallback(
    (x: number, y: number) => controller?.setAxes(x, y),
    [controller],
  );
  const noop = useCallback(() => {}, []);
  useEffect(() => {
    controller?.setInputEnabled(canInput && (state.active || state.placing));
    return () => controller?.setInputEnabled(false);
  }, [controller, canInput, state.active, state.placing]);
  if (!controller || hidden) return null;
  const preflight = ['building', 'ready', 'countdown'].includes(state.phase);
  const failed = ['crashed', 'sinking', 'aborted'].includes(state.phase);
  const previewSupport =
    state.placing &&
    [
      'ground',
      'platform',
      'roof-small',
      'roof-large',
      'ocean',
      'river',
      'lake',
    ].includes(state.warning)
      ? state.warning
      : state.support;
  const risk = riskKey({ ...state, support: previewSupport });
  const solid = risk === 'groundRisk' || risk === 'platformRisk';
  const shortRisk: RocketTextKey =
    (
      {
        groundRisk: 'groundShort',
        platformRisk: 'platformShort',
        smallRoofRisk: 'smallRoofShort',
        heavyRoofRisk: 'heavyRoofShort',
        largeRoofRisk: 'largeRoofShort',
        seaRisk: 'waterShort',
        riverRisk: 'waterShort',
        lakeRisk: 'lakeShort',
      } as Partial<Record<RocketTextKey, RocketTextKey>>
    )[risk] || 'groundShort';
  const compactPreflight =
    touch && !optionsOpen && ['building', 'ready'].includes(state.phase);
  const pitch = state.pitch ?? 0,
    roll = state.roll ?? 0;
  const signed = (value: number) =>
    `${value >= 0 ? '+' : ''}${Math.round(value)}`;
  const altitude =
    state.altitude >= 1000
      ? (state.altitude / 1000).toFixed(1)
      : Math.round(state.altitude).toLocaleString(locale);
  const altitudeUnit = state.altitude >= 1000 ? 'km' : 'm';
  const showPanel =
    !minimal &&
    panelVisible &&
    state.active &&
    !state.placing &&
    !choosing &&
    (state.phase === 'building' ||
      state.phase === 'ready' ||
      failed ||
      optionsOpen ||
      !touch);
  const choose = (kind: 'small' | 'large') => {
    setSpaceDismissed(false);
    onChoose(kind);
  };
  const toggleSound = () => {
    const next = !muted;
    setMuted(next);
    controller.setMuted(next);
  };
  const rebuild = () => {
    setSpaceDismissed(false);
    controller.retry();
  };
  return (
    <>
      {choosing && (
        <section
          className="rocket-placement glass ui-chrome"
          aria-label={t('choose')}
        >
          <header>
            <Rocket size={18} />
            <strong>{t('choose')}</strong>
            <button
              type="button"
              onClick={onCloseChoosing}
              aria-label={t('close')}
            >
              <X size={18} />
            </button>
          </header>
          <p>{t('chooseHint')}</p>
          <div className="rocket-kind-picker">
            {(['small', 'large'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => choose(kind)}
                data-rocket-kind={kind}
              >
                <Rocket size={kind === 'large' ? 24 : 18} />
                <strong>{t(kind)}</strong>
                <span>{t(kind === 'small' ? 'smallHint' : 'largeHint')}</span>
              </button>
            ))}
          </div>
          <small>{t('gameplay')}</small>
        </section>
      )}
      {state.placing && !choosing && (
        <section
          className="rocket-placement glass ui-chrome"
          aria-label={t('placement')}
        >
          <header>
            <Rocket size={18} />
            <strong>{t('placement')}</strong>
            <button type="button" onClick={() => controller.cancelPlacement()}>
              <X size={16} />
              {t('cancel')}
            </button>
          </header>
          <p>{t('placementHint')}</p>
          {state.support && (
            <div className={`rocket-risk ${solid ? 'safe' : ''}`}>
              <AlertTriangle size={15} />
              <span>{t(risk)}</span>
            </div>
          )}
        </section>
      )}
      {showPanel && !(state.phase === 'space' && !spaceDismissed) && (
        <section
          className={`rocket-panel glass ui-chrome ${touch && optionsOpen ? 'mobile-travel-sheet' : ''} ${compactPreflight ? 'rocket-preflight-compact' : ''}`}
          aria-label={t('rocket')}
        >
          <header>
            <Rocket size={18} />
            <strong>{t(state.kind)}</strong>
            {compactPreflight && (
              <>
                <button
                  type="button"
                  className="rocket-compact-action"
                  aria-pressed={state.auto}
                  aria-label={t('guidance')}
                  onClick={() => controller.setAuto(!state.auto)}
                >
                  {t(state.auto ? 'autoShort' : 'manualShort')}
                </button>
                <button
                  type="button"
                  className="rocket-compact-action"
                  aria-label={t('view')}
                  onClick={() =>
                    controller.setView(
                      state.view === 'first' ? 'chase' : 'first',
                    )
                  }
                >
                  <Camera size={14} />
                </button>
              </>
            )}
            {optionsOpen && (
              <button
                type="button"
                aria-label={t('close')}
                onClick={onCloseOptions}
              >
                <X size={18} />
              </button>
            )}
          </header>
          <p className="rocket-kicker">{t(state.phase)}</p>
          {state.phase === 'building' && (
            <>
              <p className="rocket-build-description">{t('buildingHint')}</p>
              <progress
                className="rocket-build-progress"
                aria-label={t('building')}
                max={1}
                value={state.buildProgress}
              />
              <small>
                {Math.round(state.buildProgress * 100)}% ·{' '}
                {state.loaded ? t('ready') : t('loading')}
              </small>
            </>
          )}
          {state.loadError && (
            <div className="rocket-risk" role="alert">
              <AlertTriangle size={16} />
              <span>
                {t('loadError')}{' '}
                <button type="button" onClick={() => controller.retryLoad()}>
                  {t('retryLoad')}
                </button>
              </span>
            </div>
          )}
          {preflight && (
            <>
              <div className={`rocket-risk ${solid ? 'safe' : ''}`}>
                {solid ? (
                  <ShieldCheck size={16} />
                ) : (
                  <AlertTriangle size={16} />
                )}
                <span className="rocket-risk-full">
                  <strong>{t(supportKey(previewSupport))}</strong>
                  <br />
                  {t(risk)}
                </span>
                <span className="rocket-risk-compact">{t(shortRisk)}</span>
              </div>
              <p className="rocket-consequence">{t('consequence')}</p>
            </>
          )}
          {failed && (
            <div className="rocket-risk">
              <AlertTriangle size={16} />
              <span>{t(risk)}</span>
            </div>
          )}
          {state.phase === 'ready' && (
            <button
              type="button"
              className="rocket-launch"
              disabled={!state.loaded || state.loadError}
              onClick={() => controller.launch()}
            >
              <Flame size={17} />
              {t(compactPreflight ? 'launchShort' : 'launch')}
            </button>
          )}
          {!failed && (
            <>
              <fieldset
                className="rocket-segmented rocket-guidance"
                aria-label={t('guidance')}
              >
                <button
                  type="button"
                  aria-pressed={state.auto}
                  onClick={() => controller.setAuto(true)}
                >
                  <Navigation size={14} />
                  {t('auto')}
                </button>
                <button
                  type="button"
                  aria-pressed={!state.auto}
                  onClick={() => controller.setAuto(false)}
                >
                  {t('manual')}
                </button>
              </fieldset>
              <button
                type="button"
                className="rocket-system-control"
                aria-pressed={state.stabilize}
                onClick={() => controller.setStabilize(!state.stabilize)}
              >
                <ShieldCheck size={14} />
                {t('stabilization')} · {t(state.stabilize ? 'on' : 'off')}
              </button>
              <button
                type="button"
                className="rocket-system-control"
                aria-pressed={!muted}
                onClick={toggleSound}
              >
                {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                {t('sound')} · {t(muted ? 'off' : 'on')}
              </button>
              <fieldset
                className="rocket-segmented rocket-camera"
                aria-label={t('view')}
              >
                {(['first', 'chase'] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    aria-pressed={state.view === view}
                    onClick={() => controller.setView(view)}
                  >
                    <Camera size={14} />
                    {t(view)}
                  </button>
                ))}
              </fieldset>
            </>
          )}
          {(state.phase === 'countdown' ||
            state.phase === 'ignition' ||
            state.phase === 'flight') && (
            <button
              type="button"
              className="rocket-danger"
              onClick={() => controller.abort()}
            >
              {t('abort')}
            </button>
          )}
          <small className="rocket-return-hint">{t('returnHint')}</small>
          <div className="rocket-panel-actions">
            {failed && (
              <button type="button" onClick={rebuild}>
                <RotateCcw size={14} />
                {t('retry')}
              </button>
            )}
            <button type="button" onClick={() => controller.returnToCity()}>
              <Map size={14} />
              {t(
                compactPreflight
                  ? state.phase === 'building'
                    ? 'cancelBuild'
                    : 'cityShort'
                  : 'city',
              )}
            </button>
          </div>
          {(failed || state.phase === 'space') && (
            <div className="rocket-panel-actions">
              <button type="button" onClick={() => choose(state.kind)}>
                <Rocket size={14} />
                {t('newRocket')}
              </button>
            </div>
          )}
          {(state.damaged > 0 || state.burning > 0 || state.debris > 0) && (
            <div className="rocket-panel-actions">
              <button
                type="button"
                title={t('resetHint')}
                onClick={() => controller.resetDamage()}
              >
                <Wrench size={14} />
                {t('resetDamage')}
              </button>
            </div>
          )}
          <button
            type="button"
            className="rocket-help-toggle"
            aria-expanded={help}
            onClick={() => setHelp(!help)}
          >
            <HelpCircle size={14} />
            {t('help')}
          </button>
          {help && (
            <div className="rocket-help">
              <p>{touch ? t('touchHint') : t('controls')}</p>
              <p>{t('manualHint')}</p>
              <small>{t('gameplay')}</small>
            </div>
          )}
        </section>
      )}
      {state.exists &&
        !state.active &&
        !state.placing &&
        !choosing &&
        panelVisible && (
          <div className="rocket-return glass ui-chrome">
            <button type="button" onClick={() => choose(state.kind)}>
              <Rocket size={15} />
              {t('newRocket')}
            </button>
            {(state.damaged > 0 || state.burning > 0 || state.debris > 0) && (
              <button
                type="button"
                title={t('resetHint')}
                onClick={() => controller.resetDamage()}
              >
                <Wrench size={15} />
                {t('resetDamage')}
              </button>
            )}
          </div>
        )}
      {state.active && !state.placing && !choosing && (
        <>
          {!showPanel &&
            (panelVisible || minimal) &&
            !(state.phase === 'space' && !spaceDismissed) && (
              <section
                className="rocket-compact-controls glass ui-chrome"
                aria-label={t('guidance')}
              >
                <button
                  type="button"
                  aria-pressed={state.auto}
                  onClick={() => controller.setAuto(!state.auto)}
                >
                  <Navigation size={15} />
                  {t(state.auto ? 'auto' : 'manual')}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    controller.setView(
                      state.view === 'first' ? 'chase' : 'first',
                    )
                  }
                >
                  <Camera size={15} />
                  {t(state.view)}
                </button>
                {state.phase === 'ready' && (
                  <button
                    type="button"
                    disabled={!state.loaded || state.loadError}
                    onClick={() => controller.launch()}
                  >
                    <Flame size={15} />
                    {t('launchShort')}
                  </button>
                )}
                {['countdown', 'ignition', 'flight'].includes(state.phase) ? (
                  <button
                    type="button"
                    className="rocket-danger"
                    onClick={() => controller.abort()}
                  >
                    {t('abort')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => controller.returnToCity()}
                  >
                    <Map size={15} />
                    {t('city')}
                  </button>
                )}
              </section>
            )}
          {!minimal && (
            <section
              className={`rocket-telemetry glass ${manualFlight ? 'rocket-manual-telemetry' : ''}`}
              aria-label={t('title')}
            >
              <div>
                <small>{t('altitude')}</small>
                <strong>
                  {altitude}
                  <span>{altitudeUnit}</span>
                </strong>
              </div>
              <div>
                <small>{t('speed')}</small>
                <strong>
                  {Math.round(state.speed).toLocaleString(locale)}
                  <span>m/s</span>
                </strong>
              </div>
              <div>
                <small>{t('fuel')}</small>
                <strong className={state.fuel < 0.15 ? 'danger' : ''}>
                  {Math.round(state.fuel * 100)}
                  <span>%</span>
                </strong>
              </div>
              <div>
                <small>{t('tilt')}</small>
                <strong className={state.tilt > 35 ? 'danger' : ''}>
                  {Math.round(state.tilt)}
                  <span>°</span>
                </strong>
              </div>
              <div className="rocket-wind">
                <small>{t('wind')}</small>
                <strong>
                  {state.wind.toFixed(1)}
                  <span>m/s</span>
                </strong>
              </div>
              <div className="rocket-support">
                <small>{t('support')}</small>
                <strong
                  className={state.supportIntegrity < 0.5 ? 'danger' : ''}
                >
                  {Math.round(state.supportIntegrity * 100)}
                  <span>%</span>
                </strong>
              </div>
              <div className="rocket-mission-meter" title={t('mission')}>
                <span
                  style={{
                    width: `${Math.min(100, Math.max(0, state.altitude / 1000))}%`,
                  }}
                />
              </div>
            </section>
          )}
          {manualFlight && canInput && (
            <section className="rocket-attitude" aria-label={t('attitude')}>
              <div className="rocket-attitude-reticle" aria-hidden="true">
                <span
                  style={{
                    transform: `translateY(${Math.max(-18, Math.min(18, pitch * 0.3))}px) rotate(${-roll}deg)`,
                  }}
                />
                <i />
              </div>
              <div className="rocket-attitude-values">
                <span>
                  <small>W/S · {t('pitch')}</small>
                  <b>{signed(pitch)}°</b>
                </span>
                <span>
                  <small>A/D · {t('roll')}</small>
                  <b>{signed(roll)}°</b>
                </span>
                <span>
                  <small>{t('climb')}</small>
                  <b>{signed(state.verticalSpeed ?? 0)} m/s</b>
                </span>
              </div>
            </section>
          )}
          {state.phase === 'countdown' && (
            <output className="rocket-countdown" aria-live="assertive">
              <strong>{Math.max(1, Math.ceil(state.countdown))}</strong>
              <span>{t('countdown')}</span>
            </output>
          )}
          {state.phase === 'ignition' && (
            <output className="rocket-countdown">
              <Flame size={50} />
              <span>{t('ignition')}</span>
            </output>
          )}
          {canInput &&
            !state.auto &&
            ['ready', 'countdown', 'ignition', 'flight'].includes(
              state.phase,
            ) && (
              <section
                className="rocket-throttle glass ui-chrome"
                aria-label={t('throttle')}
              >
                <label htmlFor="rocket-throttle">{t('throttle')}</label>
                <strong>{Math.round(state.throttle * 100)}%</strong>
                <input
                  id="rocket-throttle"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(state.throttle * 100)}
                  onChange={(event) =>
                    controller.setThrottle(Number(event.target.value) / 100)
                  }
                  aria-label={t('throttle')}
                />
                {!touch && <kbd>R / F</kbd>}
              </section>
            )}
          {touch && manualFlight && canInput && (
            <TravelJoystick
              mode="walk"
              label={t('touchHint')}
              brakeLabel=""
              onMove={move}
              onBrake={noop}
            />
          )}
          {state.phase === 'flight' &&
            (state.fuel < 0.15 || state.tilt > 35) && (
              <output className="rocket-alert glass">
                {t(state.tilt > 35 ? 'unstable' : 'lowFuel')}
              </output>
            )}
          {state.phase === 'space' && !spaceDismissed && (
            <dialog
              open
              className="rocket-complete glass ui-chrome"
              aria-labelledby="rocket-mission-title"
            >
              <header>
                <CircleCheck size={21} />
                <span className="rocket-kicker">{t('title')}</span>
              </header>
              <h2 id="rocket-mission-title">{t('complete')}</h2>
              <p>{t('completeHint')}</p>
              <small>{t('returnHint')}</small>
              <div className="rocket-complete-stats">
                <div>
                  <strong>
                    {altitude} {altitudeUnit}
                  </strong>
                  <span>{t('peak')}</span>
                </div>
                <div>
                  <strong>{state.damaged}</strong>
                  <span>{t('damage')}</span>
                </div>
                <div>
                  <strong>{state.burning}</strong>
                  <span>{t('burning')}</span>
                </div>
                <div>
                  <strong>{state.debris}</strong>
                  <span>{t('debris')}</span>
                </div>
              </div>
              <div className="rocket-complete-actions">
                <button type="button" onClick={() => setSpaceDismissed(true)}>
                  {t('staySpace')}
                </button>
                <button type="button" onClick={() => controller.returnToCity()}>
                  <Map size={15} />
                  {t('city')}
                </button>
                <button type="button" onClick={() => choose(state.kind)}>
                  <Rocket size={15} />
                  {t('newRocket')}
                </button>
              </div>
            </dialog>
          )}
        </>
      )}
    </>
  );
}
