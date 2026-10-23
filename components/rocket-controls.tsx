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
  ChevronDown,
  Minus,
  Plus,
} from 'lucide-react';
import { TravelJoystick } from './travel-joystick';
import type { RocketController } from '@/lib/city/rocket-controller';
import type { RocketSnapshot } from '@/lib/city/rocket-snapshot';
import type { RocketKind } from '@/lib/city/rocket-state';
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
  'super-heavy': 'Titan · Super-heavy rocket',
  smallHint:
    'Slim body with four tail fins. Agile and light, but vulnerable to wind.',
  largeHint:
    'Orange core with twin side boosters. Needs a strong, open foundation.',
  superHeavyHint:
    '4 external boosters, bright silver body, dark heat shield and control fins. Needs the strongest foundation.',
  smallMetrics: '18 m tall · blast 35 m · heat 17 m',
  largeMetrics: '48 m tall · blast 100 m · heat 45 m',
  superHeavyMetrics: '110 m tall · blast 220 m · heat 105 m',
  smallTiming: 'Assembly 6 s · countdown 5 s',
  largeTiming: 'Assembly 10 s · countdown 5 s',
  superHeavyTiming: 'Assembly 16 s · countdown 5 s',
  placement: 'Click or tap the city to place your rocket.',
  placementHint:
    'Water and rooftops are allowed. Their physical risks still apply.',
  cancel: 'Cancel',
  close: 'Close',
  collapse: 'Collapse panel',
  expand: 'Expand panel',
  building: 'Assembly in progress',
  buildingHint:
    'The crew is assembling your rocket while flight and space systems load.',
  loading: 'Preparing flight and space systems…',
  ready: 'Ready for launch',
  launch: 'Begin countdown',
  launchShort: 'Launch',
  countdown: 'Launch countdown',
  ignition: 'Ignition',
  flight: 'Ascent',
  space: 'Space reached',
  sinking: 'Foundation lost · sinking',
  falling: 'Uncontrolled descent',
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
  superHeavyGroundRisk:
    'Titan needs broad, solid ground. Its 220 m blast zone can damage a wide area.',
  superHeavyPlatformRisk:
    'Titan needs an exceptionally strong, broad platform. Keep the 220 m blast zone clear.',
  superHeavyRoofRisk:
    'Titan is too demanding for ordinary rooftops: its weight and exhaust can collapse the building.',
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
  superHeavyGroundShort: 'Titan: broad, solid ground · 220 m blast zone.',
  superHeavyPlatformShort:
    'Titan: exceptionally strong platform · 220 m blast zone.',
  superHeavyRoofShort: 'Titan: weight and exhaust can collapse this roof.',
  attitude: 'Flight attitude',
  pitch: 'Pitch',
  roll: 'Roll',
  climb: 'Climb',
  stageBoost: 'Stage 1 · Booster',
  stageSeparating: 'Stage separation',
  stageUpper: 'Stage 2 · Upper stage',
  stageCoast: 'Coasting',
  stageStrapOn: 'Stage 1 · 4 boosters + core',
  stageStrapSeparating: 'Side boosters separating',
  stageCore: 'Stage 2 · Core only',
  stageCoreSeparating: 'Core stage separating',
  stageTitanUpper: 'Stage 3 · Upper stage',
  stageFuel: 'Stage fuel',
  stageTransition: 'Next stage ignition preparation',
  strapTransition: 'Side-booster release progress',
  strapOnHint: '4 boosters and core ignite together',
  strapSeparationHint: 'Boosters released · core firing',
  coreSeparationHint: 'Core released · upper stage preparing',
  separationHint: 'Booster released · upper stage preparing',
  spaceObservation: 'Space observation',
  observationHint: 'Choose a destination to find it. Drag to look around.',
  focus: 'Look toward',
  focusRocket: 'Rocket',
  focusEarth: 'Earth',
  focusSun: 'Sun',
  focusMoon: 'Moon',
  missionDetails: 'Mission details',
  accidentObservation: 'Accident sequence',
  impact: 'Impact',
  fireFailure: 'Vehicle fire / explosion',
  aerodynamicFailure: 'Aerodynamic loss of control',
  vehicleFire: 'Rocket on fire',
  vehicleHeat: 'Vehicle heat',
  afterImpact: 'After impact / explosion',
  contactScraping: 'Contact · scraping',
  contactCompression: 'Contact · structure under load',
  contactImpact: 'Collision caused the breakup',
  contactBuilding: 'Building',
  contactBridge: 'Bridge',
  contactLandmark: 'City structure',
  contactTerrain: 'Ground',
  contactUnknown: 'Obstacle',
  contactCore: 'Core body',
  contactBooster: 'Side booster',
  contactUpper: 'Upper stage',
  contactAppendage: 'Fin / appendage',
  contactClosing: 'Impact approach speed',
  contactMarker: 'Amber rings mark the actual contact points.',
  vehicleIntegrity: 'Vehicle structure',
  bodyBreakup: 'Vehicle breakup',
  foundationImpact: 'Foundation failed · falling vehicle broke on impact',
  surfaceLeveled: 'Assembly supports level this ground slope',
  surfaceSteep: 'Steep ground · the rocket may lean. Choose flatter ground.',
} as const;

type RocketTextKey = keyof typeof en;
const zh: Record<RocketTextKey, string> = {
  rocket: '火箭',
  title: '溫哥華太空計畫',
  choose: '選擇你的火箭',
  chooseHint: '在城市任意地點搭建火箭，親自駕駛或自動飛向太空。',
  small: 'Scout · 小型火箭',
  large: 'Atlas · 大型火箭',
  'super-heavy': '泰坦 · 超大型火箭',
  smallHint: '細長箭體與四片尾翼。輕巧、轉向靈活，但容易受風偏移。',
  largeHint: '橙色主箭體與雙側助推器。需要寬廣、堅固的發射地基。',
  superHeavyHint:
    '四枚外掛助推器、亮銀色箭體、黑色隔熱面與控制翼。需要最堅固的發射地基。',
  smallMetrics: '高 18 m · 風壓 35 m · 熱影響 17 m',
  largeMetrics: '高 48 m · 風壓 100 m · 熱影響 45 m',
  superHeavyMetrics: '高 110 m · 風壓 220 m · 熱影響 105 m',
  smallTiming: '搭建 6 秒 · 倒數 5 秒',
  largeTiming: '搭建 10 秒 · 倒數 5 秒',
  superHeavyTiming: '搭建 16 秒 · 倒數 5 秒',
  placement: '點選城市中的地點來放置火箭。',
  placementHint: '可以放在水面與屋頂，但仍會承受對應的物理風險。',
  cancel: '取消',
  close: '關閉',
  collapse: '收合面板',
  expand: '展開面板',
  building: '火箭搭建中',
  buildingHint: '工作團隊正在組裝火箭，同時載入飛行與太空系統。',
  loading: '正在準備飛行與太空系統…',
  ready: '準備發射',
  launch: '開始倒數',
  launchShort: '發射',
  countdown: '發射倒數',
  ignition: '點火',
  flight: '升空中',
  space: '抵達太空',
  sinking: '失去地基支撐 · 下沉中',
  falling: '失控下墜',
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
  superHeavyGroundRisk:
    '泰坦需要寬廣、堅實的地面，220 m 風壓影響區可能造成大範圍損壞。',
  superHeavyPlatformRisk:
    '泰坦需要特別堅固、寬廣的平台，請淨空 220 m 風壓影響區。',
  superHeavyRoofRisk:
    '一般屋頂難以承受泰坦的重量與噴流，可能導致整棟建築垮塌。',
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
  superHeavyGroundShort: '泰坦：寬廣堅實地面 · 220 m 風壓影響區。',
  superHeavyPlatformShort: '泰坦：特別堅固平台 · 220 m 風壓影響區。',
  superHeavyRoofShort: '泰坦：重量與噴流可能壓垮屋頂。',
  attitude: '飛行姿態',
  pitch: '俯仰',
  roll: '側傾',
  climb: '爬升',
  stageBoost: '第一級 · 助推器',
  stageSeparating: '級間分離',
  stageUpper: '第二級 · 上面級',
  stageCoast: '慣性滑行',
  stageStrapOn: '第一級 · 四側助推器＋核心',
  stageStrapSeparating: '側助推器分離中',
  stageCore: '第二級 · 核心推進',
  stageCoreSeparating: '核心級分離中',
  stageTitanUpper: '第三級 · 上面級',
  stageFuel: '本級燃料',
  stageTransition: '下一級點火準備',
  strapTransition: '側助推器釋放進度',
  strapOnHint: '四枚側助推器與核心同時點火',
  strapSeparationHint: '側助推器已釋放 · 核心持續推進',
  coreSeparationHint: '核心已釋放 · 上面級準備中',
  separationHint: '助推器已釋放 · 上面級準備中',
  spaceObservation: '太空觀察',
  observationHint: '選擇天體即可找到它，也可以拖曳視角自由觀察。',
  focus: '觀察焦點',
  focusRocket: '火箭',
  focusEarth: '地球',
  focusSun: '太陽',
  focusMoon: '月球',
  missionDetails: '任務詳細資料',
  accidentObservation: '事故過程',
  impact: '撞擊',
  fireFailure: '箭體起火／爆炸',
  aerodynamicFailure: '氣動失控',
  vehicleFire: '箭體起火',
  vehicleHeat: '箭體溫度',
  afterImpact: '撞擊／爆炸後',
  contactScraping: '發生接觸 · 箭體擦碰',
  contactCompression: '接觸受阻 · 箭體正在承受擠壓',
  contactImpact: '碰撞導致箭體解體',
  contactBuilding: '建築',
  contactBridge: '橋梁',
  contactLandmark: '城市構造物',
  contactTerrain: '地面',
  contactUnknown: '障礙物',
  contactCore: '中央箭體',
  contactBooster: '側助推器',
  contactUpper: '上面級',
  contactAppendage: '翼片／附屬部件',
  contactClosing: '迎面撞擊速度',
  contactMarker: '琥珀色圓環標示實際接觸位置。',
  vehicleIntegrity: '箭體結構',
  bodyBreakup: '箭體破裂',
  foundationImpact: '地基失效後墜落、撞擊破裂',
  surfaceLeveled: '發射架已調平此處地面坡度',
  surfaceSteep: '地面坡度過大，箭體可能傾斜；建議改放較平坦位置。',
};

const rocketChoices = [
  {
    kind: 'small',
    hint: 'smallHint',
    metrics: 'smallMetrics',
    timing: 'smallTiming',
  },
  {
    kind: 'large',
    hint: 'largeHint',
    metrics: 'largeMetrics',
    timing: 'largeTiming',
  },
  {
    kind: 'super-heavy',
    hint: 'superHeavyHint',
    metrics: 'superHeavyMetrics',
    timing: 'superHeavyTiming',
  },
] as const satisfies readonly {
  kind: RocketKind;
  hint: RocketTextKey;
  metrics: RocketTextKey;
  timing: RocketTextKey;
}[];

function RocketSilhouette({ kind }: { kind: RocketKind }) {
  return (
    <svg
      className="rocket-silhouette"
      data-rocket-silhouette={kind}
      viewBox="0 0 48 64"
      width="42"
      height="56"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'small' ? (
        <>
          <path
            d="M24 4 30 17v31l-6 8-6-8V17Z"
            fill="currentColor"
            fillOpacity=".12"
          />
          <path d="m18 37-8 16 8-4m12-12 8 16-8-4M24 40v16m-4 3h8M18 20h12" />
          <circle cx="24" cy="25" r="2" />
        </>
      ) : kind === 'large' ? (
        <>
          <path d="m24 3 6 13v35H18V16Z" fill="#df9965" fillOpacity=".75" />
          <path
            d="m11 18 5 10v25H6V28Zm26 0 5 10v25H32V28Z"
            fill="currentColor"
            fillOpacity=".22"
          />
          <path d="M18 23h12M18 44h12M6 46h10m16 0h10M9 57h4m7-2h8m7 2h4M16 33h2m12 0h2" />
        </>
      ) : (
        <>
          <path
            data-rocket-strap="rear-left"
            d="m8 18 4 9v27H4V27Z"
            fill="#b9c9d0"
          />
          <path
            data-rocket-strap="rear-right"
            d="m40 18 4 9v27h-8V27Z"
            fill="#b9c9d0"
          />
          <path
            d="M24 3c9 9 11 17 11 24v25H13V27c0-7 2-15 11-24Z"
            fill="#e5edef"
          />
          <path d="M24 4c9 9 11 16 11 23v25H24Z" fill="#071b28" />
          <path d="m13 36-9 20 11-5m20-15 9 20-11-5M7 22h6v6H7Zm28 0h6v6h-6M9 22v6m30-6v6M7 25h6m22 0h6M13 44h22" />
          <path d="m18 53-1 5h6l-1-5m4 0-1 5h6l-1-5" />
          <path
            data-rocket-strap="front-left"
            d="m16 22 4 8v26h-8V30Z"
            fill="#d5e1e5"
          />
          <path
            data-rocket-strap="front-right"
            d="m32 22 4 8v26h-8V30Z"
            fill="#d5e1e5"
          />
          <path d="M4 49h8m24 0h8M12 51h8m8 0h8M6 58h4m28 0h4m-28 2h4m12 0h4" />
        </>
      )}
    </svg>
  );
}

const panelLabels: Record<Locale, { collapse: string; expand: string }> = {
  en: { collapse: 'Collapse panel', expand: 'Expand panel' },
  fr: { collapse: 'Réduire le panneau', expand: 'Développer le panneau' },
  es: { collapse: 'Contraer panel', expand: 'Expandir panel' },
  'zh-Hant': { collapse: '收合面板', expand: '展開面板' },
  'zh-Hans': { collapse: '收起面板', expand: '展开面板' },
  de: { collapse: 'Bedienfeld einklappen', expand: 'Bedienfeld ausklappen' },
  ja: { collapse: 'パネルを折りたたむ', expand: 'パネルを展開' },
  ko: { collapse: '패널 접기', expand: '패널 펼치기' },
  uk: { collapse: 'Згорнути панель', expand: 'Розгорнути панель' },
  ru: { collapse: 'Свернуть панель', expand: 'Развернуть панель' },
};

/** Other new rocket strings retain the existing English fallback. */
export function rocketText(locale: Locale, key: RocketTextKey): string {
  if (key === 'collapse' || key === 'expand') return panelLabels[locale][key];
  return locale === 'zh-Hant' || locale === 'zh-Hans' ? zh[key] : en[key];
}

type RocketPanelSection =
  | 'chooser'
  | 'placement'
  | 'main'
  | 'stage'
  | 'telemetry'
  | 'attitude'
  | 'throttle'
  | 'space';

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
  if (state.kind === 'super-heavy') {
    if (state.support === 'roof-small' || state.support === 'roof-large')
      return 'superHeavyRoofRisk';
    return state.support === 'platform'
      ? 'superHeavyPlatformRisk'
      : 'superHeavyGroundRisk';
  }
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
  onChoose: (kind: RocketKind) => void;
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
  const [collapsedPanels, setCollapsedPanels] = useState<
    Partial<Record<RocketPanelSection, boolean>>
  >({});
  const [missionDetails, setMissionDetails] = useState({
    missionId: -1,
    open: false,
  });
  const t = (key: RocketTextKey) => rocketText(locale, key);
  const panelToggle = (section: RocketPanelSection, label: RocketTextKey) => (
    <button
      type="button"
      className="rocket-panel-toggle"
      aria-label={`${t(collapsedPanels[section] ? 'expand' : 'collapse')} · ${t(label)}`}
      title={`${t(collapsedPanels[section] ? 'expand' : 'collapse')} · ${t(label)}`}
      aria-expanded={!collapsedPanels[section]}
      aria-controls={`rocket-${section}-content`}
      onClick={() =>
        setCollapsedPanels((previous) => ({
          ...previous,
          [section]: !previous[section],
        }))
      }
    >
      {collapsedPanels[section] ? <Plus size={16} /> : <Minus size={16} />}
    </button>
  );
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
  const stageLabel: RocketTextKey = (
    {
      'strap-on': 'stageStrapOn',
      'strap-separating': 'stageStrapSeparating',
      boost: state.kind === 'super-heavy' ? 'stageCore' : 'stageBoost',
      separating:
        state.kind === 'super-heavy'
          ? 'stageCoreSeparating'
          : 'stageSeparating',
      upper: state.kind === 'super-heavy' ? 'stageTitanUpper' : 'stageUpper',
      coast: 'stageCoast',
    } as const
  )[state.stage || 'boost'];
  const stageTransition =
    state.stage === 'strap-separating' || state.stage === 'separating';
  const separationHint: RocketTextKey =
    state.stage === 'strap-separating'
      ? 'strapSeparationHint'
      : state.kind === 'super-heavy'
        ? 'coreSeparationHint'
        : 'separationHint';
  const detailsOpen =
    missionDetails.missionId === state.missionId && missionDetails.open;
  const failureAge = Math.max(0, state.failureAge ?? 0);
  const wreckage = state.failureStage === 'wreckage';
  const failed =
    wreckage || ['crashed', 'sinking', 'aborted'].includes(state.phase);
  const observingAccident =
    state.phase === 'falling' ||
    state.failureStage === 'support-collapse' ||
    state.failureStage === 'freefall' ||
    (wreckage && failureAge < 5);
  const recoveryReady = wreckage && failureAge >= 5;
  const failureCause: RocketTextKey =
    state.failureCause === 'fire'
      ? 'fireFailure'
      : state.failureCause === 'aerodynamic'
        ? 'aerodynamicFailure'
        : 'impact';
  const foundationFailure =
    state.supportCollapsed ||
    state.failureStage === 'support-collapse' ||
    (state.supportIntegrity <= 0 &&
      ['roof-small', 'roof-large', 'lake'].includes(state.support));
  const contact = state.contactImpact;
  const fatalContact =
    wreckage && state.failureCause === 'impact' && contact?.fatal;
  const liveContact =
    !observingAccident &&
    ['ignition', 'flight'].includes(state.phase) &&
    contact &&
    !contact.fatal &&
    ((state.contactState ?? 'none') !== 'none' ||
      (state.contactAge ?? Infinity) < 2);
  const contactSource: RocketTextKey = contact
    ? {
        building: 'contactBuilding' as const,
        bridge: 'contactBridge' as const,
        landmark: 'contactLandmark' as const,
        terrain: 'contactTerrain' as const,
        unknown: 'contactUnknown' as const,
      }[contact.source]
    : 'contactUnknown';
  const contactPart: RocketTextKey = contact
    ? {
        core: 'contactCore' as const,
        'strap-on': 'contactBooster' as const,
        upper: 'contactUpper' as const,
        appendage: 'contactAppendage' as const,
      }[contact.part]
    : 'contactCore';
  const contactDescription = contact
    ? `${t(contactPart)} · ${contact.source === 'building' && contact.objectHeight > 0 ? `${Math.round(contact.objectHeight)} m ` : ''}${t(contactSource)}`
    : '';
  const collisionBreakup =
    wreckage && state.failureCause === 'impact' && !foundationFailure;
  const foundationImpact =
    wreckage && state.failureCause === 'impact' && foundationFailure;
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
  const solid = [
    'groundRisk',
    'platformRisk',
    'superHeavyGroundRisk',
    'superHeavyPlatformRisk',
  ].includes(risk);
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
        superHeavyGroundRisk: 'superHeavyGroundShort',
        superHeavyPlatformRisk: 'superHeavyPlatformShort',
        superHeavyRoofRisk: 'superHeavyRoofShort',
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
    !observingAccident &&
    state.active &&
    state.phase !== 'space' &&
    !state.placing &&
    !choosing &&
    (recoveryReady ||
      (!minimal &&
        panelVisible &&
        (state.phase === 'building' ||
          state.phase === 'ready' ||
          failed ||
          optionsOpen ||
          !touch)));
  const choose = (kind: RocketKind) => {
    onChoose(kind);
  };
  const toggleSound = () => {
    const next = !muted;
    setMuted(next);
    controller.setMuted(next);
  };
  const rebuild = () => {
    controller.retry();
  };
  return (
    <>
      {choosing && (
        <section
          className={`rocket-placement rocket-chooser glass ui-chrome ${collapsedPanels.chooser ? 'rocket-is-collapsed' : ''}`}
          aria-label={t('choose')}
        >
          <header>
            <Rocket size={18} />
            <strong>{t('choose')}</strong>
            {panelToggle('chooser', 'choose')}
            <button
              type="button"
              className="rocket-chooser-cancel"
              onClick={onCloseChoosing}
              aria-label={t('cancel')}
            >
              <X size={18} />
              {t('cancel')}
            </button>
          </header>
          <div
            id="rocket-chooser-content"
            className="rocket-chooser-body"
            hidden={collapsedPanels.chooser}
          >
            <p>{t('chooseHint')}</p>
            <div className="rocket-kind-picker">
              {rocketChoices.map(({ kind, hint, metrics, timing }) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => choose(kind)}
                  data-rocket-kind={kind}
                >
                  <RocketSilhouette kind={kind} />
                  <strong>{t(kind)}</strong>
                  <span>{t(hint)}</span>
                  <span className="rocket-kind-metrics">{t(metrics)}</span>
                  <small>{t(timing)}</small>
                </button>
              ))}
            </div>
            <small>{t('gameplay')}</small>
          </div>
        </section>
      )}
      {state.placing && !choosing && (
        <section
          className={`rocket-placement glass ui-chrome ${collapsedPanels.placement ? 'rocket-is-collapsed' : ''}`}
          aria-label={t('placement')}
        >
          <header>
            <Rocket size={18} />
            <strong>{t('placement')}</strong>
            {panelToggle('placement', 'placement')}
            <button type="button" onClick={() => controller.cancelPlacement()}>
              <X size={16} />
              {t('cancel')}
            </button>
          </header>
          <div id="rocket-placement-content" hidden={collapsedPanels.placement}>
            <p>{t('placementHint')}</p>
            {state.support && (
              <div className={`rocket-risk ${solid ? 'safe' : ''}`}>
                <AlertTriangle size={15} />
                <span>{t(risk)}</span>
              </div>
            )}
          </div>
        </section>
      )}
      {showPanel && (
        <section
          className={`rocket-panel glass ui-chrome ${recoveryReady ? 'rocket-failure-panel' : ''} ${touch && optionsOpen ? 'mobile-travel-sheet' : ''} ${compactPreflight ? 'rocket-preflight-compact' : ''} ${collapsedPanels.main ? 'rocket-is-collapsed' : ''}`}
          aria-label={t('rocket')}
        >
          <header>
            <Rocket size={18} />
            <strong>{t(state.kind)}</strong>
            {compactPreflight && !collapsedPanels.main && (
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
            {panelToggle('main', 'rocket')}
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
          <div
            id="rocket-main-content"
            className="rocket-panel-content"
            hidden={collapsedPanels.main}
          >
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
                {previewSupport === 'ground' &&
                  (state.groundSlopeGrade ?? 0) > 0.005 && (
                    <p className="rocket-surface-condition">
                      {state.steepSurface
                        ? t('surfaceSteep')
                        : `${t('surfaceLeveled')} · ${((state.groundSlopeGrade ?? 0) * 100).toFixed(1)}%`}
                    </p>
                  )}
              </>
            )}
            {failed && (
              <div className="rocket-risk">
                <AlertTriangle size={16} />
                <span>
                  {t(
                    foundationImpact
                      ? 'foundationImpact'
                      : fatalContact
                        ? 'contactImpact'
                        : wreckage
                          ? failureCause
                          : risk,
                  )}
                  {fatalContact && (
                    <small className="rocket-contact-detail">
                      {contactDescription}
                    </small>
                  )}
                </span>
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
          </div>
          {collapsedPanels.main && (
            <div className="rocket-minimized-actions">
              <span className="rocket-minimized-state">{t(state.phase)}</span>
              {state.phase === 'ready' && (
                <button
                  type="button"
                  className="rocket-launch"
                  disabled={!state.loaded || state.loadError}
                  onClick={() => controller.launch()}
                >
                  <Flame size={15} />
                  {t('launchShort')}
                </button>
              )}
              {['countdown', 'ignition', 'flight'].includes(state.phase) && (
                <button
                  type="button"
                  className="rocket-danger"
                  onClick={() => controller.abort()}
                >
                  {t('abort')}
                </button>
              )}
              {failed && (
                <button type="button" onClick={rebuild}>
                  {t('retry')}
                </button>
              )}
              <button type="button" onClick={() => controller.returnToCity()}>
                <Map size={15} />
                {t('cityShort')}
              </button>
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
          {liveContact && (
            <section
              className={`rocket-contact-cue glass ${manualFlight ? 'rocket-contact-manual' : ''}`}
              aria-label={t('contactScraping')}
            >
              <output aria-live="polite">
                <strong>
                  <AlertTriangle size={14} />
                  {t(
                    state.contactState === 'compression'
                      ? 'contactCompression'
                      : 'contactScraping',
                  )}
                </strong>
              </output>
              <span>{contactDescription}</span>
              <small>
                {t('contactClosing')} {contact.normalSpeed.toFixed(1)} m/s ·{' '}
                {t('vehicleIntegrity')}{' '}
                {Math.round(
                  Math.max(0, Math.min(1, state.integrity ?? 1)) * 100,
                )}
                %
              </small>
              <small>{t('contactMarker')}</small>
            </section>
          )}
          {!showPanel &&
            !observingAccident &&
            state.phase !== 'space' &&
            (panelVisible || minimal) && (
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
          {['ignition', 'flight'].includes(state.phase) &&
            !minimal &&
            !observingAccident && (
              <section
                className={`rocket-stage-status glass ui-chrome ${manualFlight ? 'rocket-stage-manual' : ''} ${stageTransition ? 'separating' : ''} ${collapsedPanels.stage ? 'rocket-is-collapsed' : ''}`}
                aria-label={t('stageFuel')}
              >
                <header>
                  <output aria-live="polite">{t(stageLabel)}</output>
                  {!stageTransition && state.stage !== 'coast' && (
                    <span>
                      {Math.round(
                        Math.max(0, Math.min(1, state.stageFuel)) * 100,
                      )}
                      %
                    </span>
                  )}
                  {panelToggle('stage', 'stageFuel')}
                </header>
                <div id="rocket-stage-content" hidden={collapsedPanels.stage}>
                  {stageTransition ? (
                    <>
                      <small>{t(separationHint)}</small>
                      <progress
                        aria-label={t(
                          state.stage === 'strap-separating'
                            ? 'strapTransition'
                            : 'stageTransition',
                        )}
                        value={state.stageTransitionProgress ?? 0}
                        max={1}
                      />
                    </>
                  ) : (
                    <>
                      <progress
                        aria-label={t('stageFuel')}
                        value={state.stageFuel}
                        max={1}
                      />
                      {state.stage === 'strap-on' && (
                        <small>{t('strapOnHint')}</small>
                      )}
                    </>
                  )}
                </div>
              </section>
            )}
          {!minimal && !observingAccident && state.phase !== 'space' && (
            <section
              className={`rocket-telemetry glass ui-chrome ${manualFlight ? 'rocket-manual-telemetry' : ''} ${collapsedPanels.telemetry ? 'rocket-is-collapsed' : ''}`}
              aria-label={t('title')}
            >
              <header className="rocket-telemetry-heading">
                <strong>{t('title')}</strong>
                {panelToggle('telemetry', 'title')}
              </header>
              <div
                id="rocket-telemetry-content"
                className="rocket-telemetry-content"
                hidden={collapsedPanels.telemetry}
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
              </div>
            </section>
          )}
          {manualFlight && canInput && !observingAccident && (
            <section
              className="rocket-attitude ui-chrome"
              aria-label={t('attitude')}
            >
              <header>
                <span>{t('attitude')}</span>
                {panelToggle('attitude', 'attitude')}
              </header>
              <div
                id="rocket-attitude-content"
                hidden={collapsedPanels.attitude}
              >
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
              </div>
            </section>
          )}
          {state.phase === 'countdown' && !observingAccident && (
            <output className="rocket-countdown" aria-live="assertive">
              <strong>{Math.max(1, Math.ceil(state.countdown))}</strong>
              <span>{t('countdown')}</span>
            </output>
          )}
          {state.phase === 'ignition' && !observingAccident && (
            <output className="rocket-countdown">
              <Flame size={50} />
              <span>{t('ignition')}</span>
            </output>
          )}
          {canInput &&
            !observingAccident &&
            !state.auto &&
            ['ready', 'countdown', 'ignition', 'flight'].includes(
              state.phase,
            ) && (
              <section
                className="rocket-throttle glass ui-chrome"
                aria-label={t('throttle')}
              >
                <header>
                  <span>{t('throttle')}</span>
                  {panelToggle('throttle', 'throttle')}
                </header>
                <div
                  id="rocket-throttle-content"
                  className="rocket-throttle-content"
                  hidden={collapsedPanels.throttle}
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
                </div>
              </section>
            )}
          {touch && manualFlight && canInput && !observingAccident && (
            <TravelJoystick
              mode="walk"
              label={t('touchHint')}
              brakeLabel=""
              onMove={move}
              onBrake={noop}
            />
          )}
          {observingAccident && (
            <section
              className="rocket-accident-observation"
              aria-label={t('accidentObservation')}
            >
              <output>
                <strong>
                  {t(
                    foundationImpact
                      ? 'foundationImpact'
                      : fatalContact
                        ? 'contactImpact'
                        : state.failureStage === 'support-collapse'
                          ? 'supportLost'
                          : wreckage || state.failureCause
                            ? failureCause
                            : 'falling',
                  )}
                </strong>
              </output>
              <div className="rocket-accident-timeline">
                {foundationFailure && (
                  <>
                    <span>{t('supportLost')}</span>
                    <span aria-hidden="true">→</span>
                  </>
                )}
                <span
                  className={state.failureStage === 'freefall' ? 'current' : ''}
                >
                  {t(
                    collisionBreakup
                      ? fatalContact
                        ? contactSource
                        : 'impact'
                      : state.failureCause === 'fire'
                        ? 'vehicleFire'
                        : state.failureCause === 'aerodynamic'
                          ? 'aerodynamicFailure'
                          : 'falling',
                  )}
                </span>
                <span aria-hidden="true">→</span>
                <span className={wreckage ? 'current' : ''}>
                  {t(
                    collisionBreakup
                      ? 'bodyBreakup'
                      : state.failureCause === 'fire'
                        ? 'fireFailure'
                        : 'impact',
                  )}
                </span>
              </div>
              {fatalContact && (
                <small className="rocket-contact-detail">
                  {contactDescription} · {t('contactClosing')}{' '}
                  {contact.normalSpeed.toFixed(1)} m/s
                </small>
              )}
              {wreckage && (
                <small>
                  {t('afterImpact')} · {failureAge.toFixed(1)} s
                </small>
              )}
            </section>
          )}
          {['ignition', 'flight'].includes(state.phase) &&
            !observingAccident &&
            (state.vehicleFire > 0 || state.fuel < 0.15 || state.tilt > 35) && (
              <output className="rocket-alert glass">
                {state.vehicleFire > 0
                  ? `${t('vehicleFire')} · ${t('vehicleHeat')} ${Math.round(state.vehicleHeat * 100)}%`
                  : t(state.tilt > 35 ? 'unstable' : 'lowFuel')}
              </output>
            )}
          {state.phase === 'space' && (panelVisible || minimal) && (
            <section
              className={`rocket-space-panel glass ui-chrome ${collapsedPanels.space ? 'rocket-is-collapsed' : ''}`}
              aria-label={t('spaceObservation')}
            >
              <header>
                <CircleCheck size={19} />
                <div>
                  <strong>{t('complete')}</strong>
                  <small>
                    {altitude} {altitudeUnit} · {t('spaceObservation')}
                  </small>
                </div>
                {!collapsedPanels.space && (
                  <button
                    type="button"
                    className="rocket-space-details-toggle"
                    aria-label={t('missionDetails')}
                    aria-expanded={detailsOpen}
                    onClick={() =>
                      setMissionDetails({
                        missionId: state.missionId,
                        open: !detailsOpen,
                      })
                    }
                  >
                    <ChevronDown size={17} />
                  </button>
                )}
                {panelToggle('space', 'spaceObservation')}
              </header>
              <div id="rocket-space-content" hidden={collapsedPanels.space}>
                <p>{t('observationHint')}</p>
                <fieldset
                  className="rocket-space-focus"
                  aria-label={t('focus')}
                >
                  {(['earth', 'sun', 'moon', 'rocket'] as const).map(
                    (focus) => (
                      <button
                        type="button"
                        key={focus}
                        data-rocket-focus={focus}
                        aria-pressed={state.spaceFocus === focus}
                        onClick={() => controller.setSpaceFocus(focus)}
                      >
                        {t(
                          (
                            {
                              earth: 'focusEarth',
                              sun: 'focusSun',
                              moon: 'focusMoon',
                              rocket: 'focusRocket',
                            } as const
                          )[focus],
                        )}
                      </button>
                    ),
                  )}
                </fieldset>
                <div className="rocket-space-actions">
                  <button
                    type="button"
                    data-rocket-space-view
                    aria-label={`${t('view')} · ${t(state.view)}`}
                    onClick={() =>
                      controller.setView(
                        state.view === 'first' ? 'chase' : 'first',
                      )
                    }
                  >
                    <Camera size={14} />
                    {t(state.view)}
                  </button>
                  <button
                    type="button"
                    onClick={() => controller.returnToCity()}
                  >
                    <Map size={14} />
                    {t('cityShort')}
                  </button>
                </div>
                {detailsOpen && (
                  <div className="rocket-mission-details">
                    <div className="rocket-mission-stats">
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
                    <p>{t('completeHint')}</p>
                    <small>{t('returnHint')}</small>
                    <button type="button" onClick={() => choose(state.kind)}>
                      <Rocket size={14} />
                      {t('newRocket')}
                    </button>
                  </div>
                )}
              </div>
              {collapsedPanels.space && (
                <div className="rocket-minimized-actions">
                  <button
                    type="button"
                    onClick={() => controller.returnToCity()}
                  >
                    <Map size={14} />
                    {t('cityShort')}
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
