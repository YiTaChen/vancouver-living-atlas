'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TrainFront, RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { translate, type Locale } from '@/lib/i18n';
import type { VisualQuality } from '@/lib/city/quality';
import type { CabinId } from '@/lib/city/skytrain-cabin-assets';
import type {
  CabinDisplayQuality,
  CabinQualityPolicy,
} from '@/lib/city/skytrain-cabin-policy';
import type {
  CabinDisplayStatus,
  SkyTrainCabinRenderer,
} from '@/lib/city/skytrain-cabin-renderer';
import './skytrain-cabin-panel.css';

interface Props {
  locale: Locale;
  visible: boolean;
  request: number;
  quality: VisualQuality;
  compatible: boolean;
  pixelRatio: number;
  onActiveChange: (active: boolean) => void;
}

/** Public cabin exhibit: requested only from the launcher, with fixed authored
 * viewpoints and its own camera. Dialog provides Escape, focus trap and return. */
export function SkyTrainCabinPanel({
  locale,
  visible,
  request,
  quality,
  compatible,
  pixelRatio,
  onActiveChange,
}: Props) {
  const [open, setOpen] = useState(false),
    [cabin, setCabin] = useState<CabinId>('mark-v');
  const [displayQuality, setDisplayQuality] =
    useState<CabinDisplayQuality>('city');
  const [viewpoint, setViewpoint] = useState('standing');
  const [status, setStatus] = useState<CabinDisplayStatus>({
    phase: 'loading',
  });
  const [qaStatus, setQAStatus] = useState('');
  const [retryRevision, setRetryRevision] = useState(0);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(
    null,
  );
  const runtime = useRef<SkyTrainCabinRenderer | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const policy = useMemo<CabinQualityPolicy>(
    () => ({ quality, compatible, pixelRatio, displayQuality }),
    [quality, compatible, pixelRatio, displayQuality],
  );
  const latest = useRef({ cabin, policy });
  const tr = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  useEffect(() => {
    latest.current = { cabin, policy };
  }, [cabin, policy]);
  useEffect(() => {
    if (!request) return;
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    let cancelled = false;
    // The parent request is an external launch signal. Capture focus before the
    // dialog portal mounts, then initialize the display in a cancellable task.
    queueMicrotask(() => {
      if (cancelled) return;
      setStatus({ phase: 'loading' });
      setQAStatus('');
      setOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [request]);
  useEffect(() => {
    if (visible) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setOpen(false);
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);
  useEffect(() => {
    if (!open || !visible) return;
    onActiveChange(true);
    return () => onActiveChange(false);
  }, [open, visible, onActiveChange]);
  useEffect(() => {
    if (!open || !visible || !canvasElement) return;
    let cancelled = false;
    const element = canvasElement;
    void import('@/lib/city/skytrain-cabin-renderer')
      .then(({ SkyTrainCabinRenderer }) => {
        if (cancelled) return;
        try {
          const renderer = new SkyTrainCabinRenderer(
            element,
            latest.current.policy,
            (next) => {
              if (cancelled) return;
              setStatus(next);
              if (next.phase === 'ready')
                setViewpoint(next.cabin.defaultViewpoint);
            },
          );
          runtime.current = renderer;
          void renderer.open(latest.current.cabin, latest.current.policy);
        } catch {
          if (!cancelled) setStatus({ phase: 'error' });
        }
      })
      .catch(() => {
        if (!cancelled) setStatus({ phase: 'error' });
      });
    return () => {
      cancelled = true;
      runtime.current?.dispose();
      runtime.current = null;
    };
  }, [open, visible, canvasElement, retryRevision]);
  useEffect(() => {
    void runtime.current?.open(cabin, policy);
  }, [cabin, policy]);

  const retry = () => {
    setStatus({ phase: 'loading' });
    setQAStatus('');
    setRetryRevision((revision) => revision + 1);
  };
  const ready = status.phase === 'ready';
  if (!visible) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setStatus({ phase: 'loading' });
      }}
    >
      {open && (
        <DialogContent
          className="skytrain-cabin-dialog"
          showCloseButton={false}
          finalFocus={returnFocus}
        >
          <DialogHeader className="skytrain-cabin-heading">
            <DialogTitle>
              <TrainFront size={20} />
              {tr('skyTrainCabinDisplay')}
            </DialogTitle>
            <DialogClose
              className="skytrain-cabin-close"
              aria-label={tr('close')}
            >
              ×
            </DialogClose>
            <DialogDescription>
              {tr('skyTrainCabinDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="skytrain-cabin-controls">
            <label>
              {tr('skyTrainCabinModel')}
              <select
                value={cabin}
                onChange={(event) => setCabin(event.target.value as CabinId)}
              >
                <option value="mark-v">{tr('skyTrainCabinMarkV')}</option>
                <option value="canada-line">{tr('skyTrainCabinCanada')}</option>
              </select>
            </label>
            <label>
              {tr('skyTrainCabinViewpoint')}
              <select
                disabled={!ready}
                value={viewpoint}
                onChange={(event) => {
                  setViewpoint(event.target.value);
                  runtime.current?.selectViewpoint(event.target.value);
                }}
              >
                {!ready && (
                  <option value="standing">
                    {tr('skyTrainCabinStanding')}
                  </option>
                )}
                {ready &&
                  status.cabin.viewpoints.map((view, index) => (
                    <option key={view.id} value={view.id}>
                      {view.kind === 'standing'
                        ? tr('skyTrainCabinStanding')
                        : translate(locale, 'skyTrainCabinSeat', {
                            number: index,
                          })}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {tr('skyTrainCabinQuality')}
              <select
                value={displayQuality}
                onChange={(event) =>
                  setDisplayQuality(event.target.value as CabinDisplayQuality)
                }
              >
                <option value="city">{tr('skyTrainCabinInherit')}</option>
                <option value="light">{tr('skyTrainCabinLight')}</option>
                <option value="detailed">{tr('skyTrainCabinDetailed')}</option>
              </select>
            </label>
          </div>
          <div
            className="skytrain-cabin-viewport"
            data-cabin-model={cabin}
            data-cabin-phase={status.phase}
          >
            <canvas
              key={retryRevision}
              ref={setCanvasElement}
              tabIndex={0}
              aria-label={tr('skyTrainCabinDisplay')}
              aria-describedby="skytrain-cabin-look"
            />
            {!ready && (
              <div
                className="skytrain-cabin-status"
                role={status.phase === 'error' ? 'alert' : 'status'}
              >
                <p>
                  {tr(
                    status.phase === 'error'
                      ? 'skyTrainCabinError'
                      : 'skyTrainCabinLoading',
                  )}
                </p>
                {status.phase === 'error' && (
                  <button onClick={retry}>{tr('skyTrainCabinRetry')}</button>
                )}
              </div>
            )}
          </div>
          <div className="skytrain-cabin-footer">
            <p id="skytrain-cabin-look">{tr('skyTrainCabinLook')}</p>
            <button
              disabled={!ready}
              onClick={() => runtime.current?.resetView()}
            >
              <RotateCcw size={15} />
              {tr('skyTrainCabinReset')}
            </button>
          </div>
          {process.env.VANCOUVER_VISUAL_QA === '1' && (
            <div className="skytrain-cabin-qa">
              <button
                disabled={!ready}
                onClick={() => {
                  try {
                    const capture = runtime.current?.capture();
                    if (!capture) return;
                    const name = `skytrain-${cabin}-lod${status.phase === 'ready' ? status.level : 0}-${viewpoint}-${Date.now()}`;
                    void fetch('/__visual-qa', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name, ...capture }),
                    })
                      .then((response) => {
                        setQAStatus(
                          response.ok
                            ? `Saved ${name}`
                            : `Capture failed ${response.status}`,
                        );
                      })
                      .catch((error) => setQAStatus(String(error)));
                  } catch (error) {
                    setQAStatus(String(error));
                  }
                }}
              >
                Save SkyTrain cabin checkpoint
              </button>
              <output>{qaStatus}</output>
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
