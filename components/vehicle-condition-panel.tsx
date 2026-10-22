'use client';
import { useEffect, useRef, useState } from 'react';
import { Car, ChevronDown, Volume2, VolumeX, Wrench, X } from 'lucide-react';
import type { CityEngine } from '@/lib/city/engine';
import type { VehicleCondition } from '@/lib/city/vehicle-condition';
import type { Locale } from '@/lib/i18n';
import './vehicle-condition-panel.css';

const ZONES = ['front', 'rear', 'left', 'right', 'roof'] as const;
type Zone = (typeof ZONES)[number];
type Key =
  | 'title'
  | 'damage'
  | Zone
  | 'repair'
  | 'stop'
  | 'soundOn'
  | 'soundOff'
  | 'repaired'
  | 'handling'
  | 'pristine'
  | 'close'
  | 'unavailable';
const TEXT: Record<Locale, Record<Key, string>> = {
  en: {
    title: 'Vehicle condition',
    damage: 'Damage',
    front: 'Front',
    rear: 'Rear',
    left: 'Left',
    right: 'Right',
    roof: 'Roof',
    repair: 'Repair',
    stop: 'Stop the car to repair',
    soundOn: 'Impact sound on',
    soundOff: 'Impact sound off',
    repaired: 'Vehicle repaired',
    handling: 'Handling affected',
    pristine: 'No damage',
    close: 'Close condition',
    unavailable: 'Impact audio unavailable',
  },
  'zh-Hant': {
    title: '車輛狀況',
    damage: '車損',
    front: '車頭',
    rear: '車尾',
    left: '左側',
    right: '右側',
    roof: '車頂',
    repair: '修復車輛',
    stop: '請先停車再修復',
    soundOn: '碰撞音效開啟',
    soundOff: '碰撞音效關閉',
    repaired: '車輛已修復',
    handling: '操控性能已受影響',
    pristine: '車況良好',
    close: '關閉車況',
    unavailable: '無法啟用碰撞音效',
  },
  'zh-Hans': {
    title: '车辆状况',
    damage: '车损',
    front: '车头',
    rear: '车尾',
    left: '左侧',
    right: '右侧',
    roof: '车顶',
    repair: '修复车辆',
    stop: '请先停车再修复',
    soundOn: '碰撞音效开启',
    soundOff: '碰撞音效关闭',
    repaired: '车辆已修复',
    handling: '操控性能已受影响',
    pristine: '车况良好',
    close: '关闭车况',
    unavailable: '无法启用碰撞音效',
  },
  fr: {
    title: 'État du véhicule',
    damage: 'Dégâts',
    front: 'Avant',
    rear: 'Arrière',
    left: 'Gauche',
    right: 'Droite',
    roof: 'Toit',
    repair: 'Réparer',
    stop: 'Arrêtez le véhicule pour réparer',
    soundOn: 'Son des chocs activé',
    soundOff: 'Son des chocs désactivé',
    repaired: 'Véhicule réparé',
    handling: 'Conduite affectée',
    pristine: 'Aucun dégât',
    close: 'Fermer cet état',
    unavailable: 'Son des chocs indisponible',
  },
  es: {
    title: 'Estado del vehículo',
    damage: 'Daños',
    front: 'Frente',
    rear: 'Atrás',
    left: 'Izquierda',
    right: 'Derecha',
    roof: 'Techo',
    repair: 'Reparar',
    stop: 'Detén el vehículo para reparar',
    soundOn: 'Sonido de impactos activado',
    soundOff: 'Sonido de impactos desactivado',
    repaired: 'Vehículo reparado',
    handling: 'Manejo afectado',
    pristine: 'Sin daños',
    close: 'Cerrar estado',
    unavailable: 'Audio de impactos no disponible',
  },
  de: {
    title: 'Fahrzeugzustand',
    damage: 'Schaden',
    front: 'Vorne',
    rear: 'Hinten',
    left: 'Links',
    right: 'Rechts',
    roof: 'Dach',
    repair: 'Reparieren',
    stop: 'Zum Reparieren anhalten',
    soundOn: 'Aufprallton an',
    soundOff: 'Aufprallton aus',
    repaired: 'Fahrzeug repariert',
    handling: 'Fahrverhalten beeinträchtigt',
    pristine: 'Unbeschädigt',
    close: 'Zustand schließen',
    unavailable: 'Aufprallton nicht verfügbar',
  },
  ja: {
    title: '車両の状態',
    damage: '損傷',
    front: '前部',
    rear: '後部',
    left: '左側',
    right: '右側',
    roof: '屋根',
    repair: '車両を修復',
    stop: '停車してから修復してください',
    soundOn: '衝突音オン',
    soundOff: '衝突音オフ',
    repaired: '車両を修復しました',
    handling: '操作性能に影響あり',
    pristine: '損傷なし',
    close: '状態を閉じる',
    unavailable: '衝突音を利用できません',
  },
  ko: {
    title: '차량 상태',
    damage: '손상',
    front: '앞면',
    rear: '뒷면',
    left: '왼쪽',
    right: '오른쪽',
    roof: '지붕',
    repair: '차량 수리',
    stop: '정차 후 수리하세요',
    soundOn: '충돌음 켜짐',
    soundOff: '충돌음 꺼짐',
    repaired: '차량 수리 완료',
    handling: '주행 성능 저하',
    pristine: '손상 없음',
    close: '차량 상태 닫기',
    unavailable: '충돌음을 사용할 수 없습니다',
  },
  uk: {
    title: 'Стан автомобіля',
    damage: 'Пошкодження',
    front: 'Перед',
    rear: 'Зад',
    left: 'Ліворуч',
    right: 'Праворуч',
    roof: 'Дах',
    repair: 'Відремонтувати',
    stop: 'Зупиніться для ремонту',
    soundOn: 'Звук ударів увімкнено',
    soundOff: 'Звук ударів вимкнено',
    repaired: 'Автомобіль відремонтовано',
    handling: 'Керованість погіршена',
    pristine: 'Без пошкоджень',
    close: 'Закрити стан',
    unavailable: 'Звук ударів недоступний',
  },
  ru: {
    title: 'Состояние автомобиля',
    damage: 'Повреждения',
    front: 'Спереди',
    rear: 'Сзади',
    left: 'Слева',
    right: 'Справа',
    roof: 'Крыша',
    repair: 'Отремонтировать',
    stop: 'Остановитесь для ремонта',
    soundOn: 'Звук ударов включён',
    soundOff: 'Звук ударов выключен',
    repaired: 'Автомобиль отремонтирован',
    handling: 'Управляемость ухудшена',
    pristine: 'Без повреждений',
    close: 'Закрыть состояние',
    unavailable: 'Звук ударов недоступен',
  },
};
export const vehicleConditionText = (locale: Locale, key: Key) =>
  TEXT[locale][key];

function activeVehicle(
  city: CityEngine | null,
): { condition: VehicleCondition; speed: number } | null {
  if (!city) return null;
  if (city.settings.mode === 'tesla')
    return city.tesla?.active
      ? { condition: city.tesla.condition, speed: city.tesla.speedMps }
      : null;
  return city.settings.mode === 'drive' && city.navigation?.condition
    ? { condition: city.navigation.condition, speed: city.navigation.speed }
    : null;
}
const percent = (value: number) =>
  Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.ceil(value * 100)))
    : 0;
export interface VehiclePanelState {
  damage: number;
  zones: Record<Zone, number>;
  damaged: boolean;
  stopped: boolean;
  affected: boolean;
  audio: boolean;
}
/** Bounded UI snapshot; no engine loop subscription and no render-frame polling. */
export function readVehiclePanelState(
  city: CityEngine | null,
): VehiclePanelState | null {
  const vehicle = activeVehicle(city);
  if (!vehicle) return null;
  const damage = vehicle.condition.damage,
    performance = vehicle.condition.performance;
  return {
    damage: percent(damage.overall),
    zones: Object.fromEntries(
      ZONES.map((zone) => [zone, percent(damage.zones[zone])]),
    ) as Record<Zone, number>,
    damaged:
      damage.overall > 0 ||
      Object.values(damage.scratches).some((value) => value > 0),
    stopped: Number.isFinite(vehicle.speed) && Math.abs(vehicle.speed) <= 0.5,
    affected:
      Math.min(
        performance.acceleration,
        performance.steering,
        performance.braking,
      ) < 0.98,
    audio: city?.impactFeedback?.stats().audioEnabled ?? false,
  };
}
const sameState = (a: VehiclePanelState | null, b: VehiclePanelState | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.damage === b.damage &&
    a.damaged === b.damaged &&
    a.stopped === b.stopped &&
    a.affected === b.affected &&
    a.audio === b.audio &&
    ZONES.every((zone) => a.zones[zone] === b.zones[zone]));

/** Collapsed by default; buttons/audio setup happen only after a user gesture.
 * visible should follow the same modal/clean/mobile-HUD gating as TeslaControls.
 */
export function VehicleConditionPanel({
  city,
  locale,
  visible,
}: {
  city: CityEngine | null;
  locale: Locale;
  visible: boolean;
}) {
  const [state, setState] = useState(() => readVehiclePanelState(city));
  const [expanded, setExpanded] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [message, setMessage] = useState<Key | ''>('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (!visible || !city) return;
    const poll = () => {
      const next = readVehiclePanelState(city);
      setState((previous) => (sameState(previous, next) ? previous : next));
    };
    poll();
    const timer = window.setInterval(poll, 250);
    return () => window.clearInterval(timer);
  }, [city, visible]);
  if (!visible || !state) return null;
  const t = (key: Key) => vehicleConditionText(locale, key),
    level =
      state.damage > 65 ? 'severe' : state.damage > 25 ? 'moderate' : 'light';
  const repair = () => {
    const vehicle = activeVehicle(city);
    if (vehicle?.condition.repair(vehicle.speed)) {
      setState(readVehiclePanelState(city));
      setMessage('repaired');
    }
  };
  const audio = async () => {
    if (!city?.impactFeedback || audioBusy) return;
    const enabled = !state.audio;
    setAudioBusy(true);
    const success = await city.impactFeedback.setAudioEnabled(enabled);
    if (!mounted.current) return;
    setState(readVehiclePanelState(city));
    setMessage(success ? (enabled ? 'soundOn' : 'soundOff') : 'unavailable');
    setAudioBusy(false);
  };
  return (
    <details
      className={`vehicle-condition glass ui-chrome vehicle-condition-${level}`}
      data-vehicle-condition="true"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary
        aria-label={`${t('title')} · ${t('damage')} ${state.damage}%`}
        title={t('title')}
        onKeyDown={(event) => {
          if (
            [
              ' ',
              'Enter',
              'ArrowUp',
              'ArrowDown',
              'ArrowLeft',
              'ArrowRight',
            ].includes(event.key)
          )
            event.stopPropagation();
        }}
      >
        <Car size={19} aria-hidden="true" />
        <span>
          {state.damaged ? `${t('damage')} ${state.damage}%` : t('pristine')}
        </span>
        <ChevronDown
          className="vehicle-condition-chevron"
          size={14}
          aria-hidden="true"
        />
      </summary>
      <section className="vehicle-condition-card glass" aria-label={t('title')}>
        <header>
          <strong>{t('title')}</strong>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label={t('close')}
            title={t('close')}
          >
            <X size={17} />
          </button>
        </header>
        <div className="vehicle-condition-overview">
          <svg
            className="vehicle-condition-silhouette"
            viewBox="0 0 100 134"
            aria-hidden="true"
          >
            <path
              d="M29 15Q50 5 71 15L80 40V108Q50 127 20 108V40Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M31 37Q50 28 69 37L72 58H28Z"
              fill="currentColor"
              opacity=".12"
            />
            <rect
              x="28"
              y="14"
              width="44"
              height="19"
              rx="4"
              data-zone="front"
              fill={state.zones.front > 25 ? '#ffb37b' : '#c6d49b'}
              opacity={0.18 + state.zones.front * 0.008}
            />
            <rect
              x="28"
              y="100"
              width="44"
              height="17"
              rx="4"
              data-zone="rear"
              fill={state.zones.rear > 25 ? '#ffb37b' : '#c6d49b'}
              opacity={0.18 + state.zones.rear * 0.008}
            />
            <rect
              x="20"
              y="42"
              width="10"
              height="52"
              rx="3"
              data-zone="left"
              fill={state.zones.left > 25 ? '#ffb37b' : '#c6d49b'}
              opacity={0.18 + state.zones.left * 0.008}
            />
            <rect
              x="70"
              y="42"
              width="10"
              height="52"
              rx="3"
              data-zone="right"
              fill={state.zones.right > 25 ? '#ffb37b' : '#c6d49b'}
              opacity={0.18 + state.zones.right * 0.008}
            />
            <rect
              x="34"
              y="63"
              width="32"
              height="29"
              rx="4"
              data-zone="roof"
              fill={state.zones.roof > 25 ? '#ffb37b' : '#c6d49b'}
              opacity={0.18 + state.zones.roof * 0.008}
            />
          </svg>
          <dl>
            {ZONES.map((zone) => (
              <div key={zone}>
                <dt>{t(zone)}</dt>
                <dd>
                  <meter
                    min={0}
                    max={100}
                    low={25}
                    high={65}
                    optimum={0}
                    value={state.zones[zone]}
                    aria-label={`${t(zone)} · ${t('damage')}`}
                  />{' '}
                  <span>{state.zones[zone]}%</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
        {state.affected && (
          <p className="vehicle-condition-handling">{t('handling')}</p>
        )}
        <div className="vehicle-condition-actions">
          <button
            type="button"
            data-vehicle-repair="true"
            disabled={!state.stopped || !state.damaged}
            title={!state.stopped ? t('stop') : t('repair')}
            onClick={repair}
          >
            <Wrench size={16} /> <span>{t('repair')}</span>
          </button>
          <button
            type="button"
            data-impact-audio="true"
            aria-pressed={state.audio}
            disabled={audioBusy || !city?.impactFeedback}
            title={t(state.audio ? 'soundOn' : 'soundOff')}
            aria-label={t(state.audio ? 'soundOn' : 'soundOff')}
            onClick={() => void audio()}
          >
            {state.audio ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
        </div>
        {!state.stopped && state.damaged && (
          <p className="vehicle-condition-stop">{t('stop')}</p>
        )}
      </section>
      <output
        className="vehicle-condition-sr"
        aria-live="polite"
        aria-atomic="true"
      >
        {message
          ? t(message)
          : `${t('damage')} ${Math.floor(state.damage / 10) * 10}%`}
      </output>
    </details>
  );
}
