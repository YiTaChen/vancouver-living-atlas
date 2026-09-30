'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ArrowUpRight,
  FlaskConical,
  MapPin,
  Pause,
  Stamp,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CityEngine } from '@/lib/city/engine';
import type { Locale } from '@/lib/i18n';
import type { DiscoveryTarget } from '@/components/discovery-panel';
import {
  LIGHT_LAB_PATH,
  LIGHT_LAB_RECIPES,
  LIGHT_LAB_STORAGE_KEY,
  LightLabVisit,
  emptyLightLabSave,
  lightMixtureCSS,
  readLightLabSave,
  startLightLab,
  submitLightLab,
  type LightLabSave,
  type LightLabStatus,
  type LightLevels,
} from '@/lib/city/light-lab';
import {
  faceLightLabExhibit,
  lightLabSample,
  lightLabTarget,
} from '@/lib/city/light-lab-runtime';
import { lightLabCopy } from '@/lib/city/light-lab-copy';
import './light-lab-panel.css';
const EMPTY: LightLabStatus = {
  next: 0,
  distance: Infinity,
  arrived: false,
  eligible: false,
  interrupted: false,
};
interface Props {
  city: CityEngine | null;
  locale: Locale;
  visible: boolean;
  request: number;
  onBegin(): boolean;
  onTargetChange(target: DiscoveryTarget | null): void;
  onActiveChange(active: boolean): void;
}
export function LightLabPanel({
  city,
  locale,
  visible,
  request,
  onBegin,
  onTargetChange,
  onActiveChange,
}: Props) {
  const text = lightLabCopy(locale),
    id = useId();
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(false);
  const [save, setSave] = useState(emptyLightLabSave),
    [storage, setStorage] = useState(true);
  const saveRef = useRef(save),
    visit = useRef<LightLabVisit | null>(null);
  const [status, setStatus] = useState<LightLabStatus>(EMPTY);
  const [levels, setLevels] = useState<LightLevels>([0, 0, 0]);
  const [feedback, setFeedback] = useState<
    'wrong' | 'saved' | 'blocked' | null
  >(null);
  const [failure, setFailure] = useState(false);
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
      const stored = readLightLabSave(
        localStorage.getItem(LIGHT_LAB_STORAGE_KEY),
      );
      saveRef.current = stored;
      setSave(stored);
    } catch {
      setStorage(false);
    }
  }, []);
  const persist = (value: LightLabSave) => {
    saveRef.current = value;
    setSave(value);
    try {
      localStorage.setItem(LIGHT_LAB_STORAGE_KEY, JSON.stringify(value));
      setStorage(true);
    } catch {
      setStorage(false);
    }
  };
  useEffect(() => {
    if (!request) return;
    stopQA();
    city?.navigation?.blur();
    onActiveChange(true);
    setOpen(true);
    setFailure(false);
  }, [request, city, onActiveChange, stopQA]);
  useEffect(() => {
    if (!city || !active) return;
    const sample = () => {
      if (visit.current) setStatus(visit.current.sample(lightLabSample(city)));
    };
    sample();
    const timer = setInterval(sample, 200);
    const visibility = () => {
      sample();
      if (document.hidden) stopQA();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [city, active, stopQA]);
  useEffect(() => {
    if (!active || !city) return;
    const target = lightLabTarget(city, status.next);
    onTargetChange(
      target && {
        ...target,
        label: status.arrived
          ? text.lab
          : `${text.waypoint} ${Math.min(status.next, 4)}/4`,
      },
    );
    return () => onTargetChange(null);
  }, [city, active, status.next, status.arrived, text, onTargetChange]);
  useEffect(() => {
    if (!visible) {
      setOpen(false);
      stopQA();
      if (!active) onActiveChange(false);
    }
  }, [visible, active, stopQA, onActiveChange]);
  useEffect(() => {
    city?.interiors?.setLightLabMix(
      active && status.eligible ? levels : [100, 100, 100],
    );
  }, [city, active, status.eligible, levels]);
  useEffect(
    () => () => {
      stopQA();
      city?.interiors?.setLightLabMix([100, 100, 100]);
    },
    [city, stopQA],
  );
  const pause = () => {
    stopQA();
    city?.navigation?.blur();
    visit.current = null;
    setActive(false);
    setOpen(false);
    setStatus(EMPTY);
    onActiveChange(false);
    onTargetChange(null);
  };
  const begin = () => {
    stopQA();
    if (!city || !onBegin()) {
      setFailure(true);
      return;
    }
    persist(startLightLab(saveRef.current));
    visit.current = new LightLabVisit();
    setStatus(visit.current.sample(lightLabSample(city)));
    setLevels([0, 0, 0]);
    setActive(true);
    onActiveChange(true);
    setOpen(false);
    setFeedback(null);
    setFailure(false);
  };
  const useMixer = () => {
    stopQA();
    city?.navigation?.blur();
    if (city && visit.current?.sample(lightLabSample(city)).eligible)
      faceLightLabExhibit(city);
    setFeedback(null);
    setOpen(true);
  };
  const testMixture = () => {
    if (!city || !visit.current) return;
    const current = saveRef.current;
    const sample = lightLabSample(city),
      actual = visit.current.sample(sample);
    setStatus(actual);
    if (!actual.eligible) {
      setFeedback('blocked');
      return;
    }
    const next = submitLightLab(
      current,
      current.next,
      levels,
      visit.current,
      sample,
    );
    if (next === current) {
      setFeedback('wrong');
      return;
    }
    persist(next);
    setFeedback('saved');
    // Keep the successful mixture visible while the next target changes.
  };
  const changeLevel = (channel: number, value: number) => {
    if (
      !city ||
      !visit.current ||
      !visit.current.sample(lightLabSample(city)).eligible
    ) {
      setFeedback('blocked');
      return;
    }
    setLevels(
      (old) =>
        old.map((level, index) =>
          index === channel ? value : level,
        ) as unknown as LightLevels,
    );
    setFeedback(null);
  };
  const qaWalk = () => {
    if (
      process.env.VANCOUVER_VISUAL_QA !== '1' ||
      !city?.navigation ||
      !visit.current ||
      !active
    )
      return;
    if (qaWalking) {
      stopQA();
      return;
    }
    const admitted = visit.current.sample(lightLabSample(city));
    if (admitted.arrived) return;
    const target = lightLabTarget(city, admitted.next);
    if (!target) return;
    const nav = city.navigation,
      started = performance.now(),
      stage = admitted.next;
    nav.yaw = Math.atan2(target.x - nav.position.x, target.z - nav.position.z);
    nav.hold('forward', true);
    setQAWalking(true);
    qaTimer.current = setInterval(() => {
      const sampled = lightLabSample(city),
        result = visit.current?.sample(sampled);
      if (
        !result ||
        result.next !== stage ||
        !sampled.visible ||
        sampled.mode !== 'walk' ||
        !sampled.onFloor ||
        result.interrupted ||
        performance.now() - started > 30000
      )
        stopQA();
    }, 100);
  };
  const completed = save.next === 3;
  const hint = status.interrupted
    ? text.return
    : status.arrived
      ? status.eligible
        ? text.ready
        : text.nearby
      : text.approach;
  return (
    <>
      {visible && active && (
        <section
          className="discovery-hud light-lab-hud glass ui-chrome"
          aria-label={text.title}
          lang={locale.startsWith('zh') ? locale : 'en'}
        >
          <header>
            <button onClick={useMixer}>
              <FlaskConical size={16} />
              <span>{text.title}</span>
            </button>
            <button
              className="discovery-icon"
              onClick={pause}
              aria-label={text.pause}
            >
              <Pause size={15} />
            </button>
          </header>
          <div className="discovery-objective">
            <span className="discovery-bearing">
              <MapPin size={22} />
            </span>
            <div>
              <small>{text.place}</small>
              <strong>
                {status.arrived
                  ? text.lab
                  : `${text.waypoint} ${Math.min(status.next, 4)}/4`}
              </strong>
            </div>
            <b>
              {Number.isFinite(status.distance)
                ? Math.round(status.distance)
                : '—'}
              <small>m</small>
            </b>
          </div>
          <p className="discovery-hint">{hint}</p>
          {completed ? (
            <button className="discovery-primary" onClick={useMixer}>
              <Stamp size={17} />
              {text.stamped}
            </button>
          ) : (
            <button
              className="discovery-primary"
              disabled={!status.eligible}
              onClick={useMixer}
            >
              <FlaskConical size={17} />
              {text.interact}
              <span>{save.next}/3</span>
            </button>
          )}
          {status.interrupted && (
            <button className="light-lab-link" onClick={begin}>
              {text.resume}
            </button>
          )}
          <p className="light-lab-directions">
            {locale.startsWith('zh')
              ? 'WASD／方向鍵步行 · 拖曳環顧 · 觸控使用搖桿'
              : 'WASD / arrows to walk · drag to look · touch joystick'}
          </p>
          {process.env.VANCOUVER_VISUAL_QA === '1' && !status.arrived && (
            <button className="discovery-qa" onClick={qaWalk}>
              {qaWalking ? 'Cancel lab walking QA' : 'Lab walk to next marker'}
            </button>
          )}
        </section>
      )}
      <Dialog
        open={open && visible}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value && !active) onActiveChange(false);
          if (value) city?.navigation?.blur();
        }}
      >
        <DialogContent
          className="discovery-journal light-lab-dialog"
          showCloseButton={false}
          lang={locale.startsWith('zh') ? locale : 'en'}
          finalFocus={() => city?.renderer.domElement ?? true}
        >
          <DialogClose className="discovery-close" aria-label={text.close}>
            <X size={20} />
          </DialogClose>
          <DialogHeader>
            <div className="discovery-eyebrow">{text.place}</div>
            <DialogTitle className="discovery-title">{text.title}</DialogTitle>
            <DialogDescription>
              {active && status.arrived && !completed
                ? text.practice
                : text.intro}
            </DialogDescription>
          </DialogHeader>
          <div className="light-lab-summary">
            <span>
              <FlaskConical size={17} />
              {save.best}/3 {text.progress}
            </span>
            {save.stamped && (
              <span>
                <Stamp size={17} />
                {text.stamped}
              </span>
            )}
          </div>
          {failure && (
            <p className="discovery-error" role="alert">
              {text.failed}
            </p>
          )}
          {active && status.arrived && !completed ? (
            <>
              <div className="light-lab-challenge">
                <small>{save.next + 1} / 3</small>
                <h3>{text.titles[save.next]}</h3>
                <p>{text.descriptions[save.next]}</p>
              </div>
              <div className="light-lab-swatches">
                <div>
                  <span
                    style={{
                      background: lightMixtureCSS(LIGHT_LAB_RECIPES[save.next]),
                    }}
                    aria-hidden="true"
                  />
                  <b>{text.target}</b>
                  <small>{text.titles[save.next]}</small>
                </div>
                <div>
                  <span
                    style={{ background: lightMixtureCSS(levels) }}
                    aria-hidden="true"
                  />
                  <b>{text.mixture}</b>
                  <small>
                    R {levels[0]} · G {levels[1]} · B {levels[2]}
                  </small>
                </div>
              </div>
              <fieldset
                className="light-lab-sliders"
                disabled={!status.eligible}
              >
                <legend className="sr-only">{text.mixture}</legend>
                {[text.red, text.green, text.blue].map((label, index) => (
                  <label key={label} htmlFor={`${id}-${index}`}>
                    <span>{label}</span>
                    <input
                      id={`${id}-${index}`}
                      aria-label={label}
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={levels[index]}
                      onChange={(event) =>
                        changeLevel(index, Number(event.target.value))
                      }
                    />
                    <output htmlFor={`${id}-${index}`}>{levels[index]}%</output>
                  </label>
                ))}
              </fieldset>
              {!status.eligible && (
                <p className="discovery-error" role="status">
                  {text.inaccessible}
                </p>
              )}
              <div className="light-lab-actions">
                <button
                  className="discovery-primary"
                  disabled={!status.eligible}
                  onClick={testMixture}
                >
                  {text.test}
                  <ArrowUpRight size={16} />
                </button>
                <button
                  className="light-lab-link"
                  disabled={!status.eligible}
                  onClick={() => {
                    if (
                      city &&
                      visit.current?.sample(lightLabSample(city)).eligible
                    )
                      setLevels([0, 0, 0]);
                  }}
                >
                  {text.reset}
                </button>
              </div>
              <details className="light-lab-hint" key={save.next}>
                <summary>{text.hint}</summary>
                <p>{text.hints[save.next]}</p>
              </details>
            </>
          ) : completed ? (
            <div className="light-lab-earned">
              <Stamp size={48} />
              <h3>{text.stamped}</h3>
              <p>{text.complete}</p>
              <button className="discovery-primary" onClick={pause}>
                {text.leave}
              </button>
              <button className="light-lab-link" onClick={begin}>
                {text.replay}
              </button>
            </div>
          ) : (
            <div className="light-lab-intro">
              <div className="light-lab-beams" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <p>{active ? hint : text.join}</p>
              {!active || status.interrupted ? (
                <button className="discovery-primary" onClick={begin}>
                  {save.next ? text.resume : text.start}
                  <ArrowUpRight size={16} />
                </button>
              ) : (
                <button
                  className="discovery-primary"
                  onClick={() => setOpen(false)}
                >
                  {text.close}
                </button>
              )}
            </div>
          )}
          {feedback && (
            <p className={`light-lab-feedback ${feedback}`} role="status">
              {feedback === 'wrong'
                ? text.retry
                : feedback === 'blocked'
                  ? text.inaccessible
                  : `${text.answer} · ${text.observations[save.next - 1]}`}
            </p>
          )}
          {save.best > 0 && (
            <details className="discovery-notes">
              <summary>
                {text.collected} · {save.best}
              </summary>
              {text.observations
                .slice(0, save.best)
                .map((observation, index) => (
                  <div key={observation}>
                    <h4>{text.titles[index]}</h4>
                    <p>{observation}</p>
                  </div>
                ))}
            </details>
          )}
          <div className="discovery-footer">
            <p>{storage ? text.saved : text.memory}</p>
            <small>{text.original}</small>
            <a
              className="discovery-source"
              href="https://www.exploratorium.edu/snacks/colored-shadows"
              target="_blank"
              rel="noreferrer"
            >
              {text.sources}
              <ArrowUpRight size={12} />
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
