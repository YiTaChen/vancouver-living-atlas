'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  createTransitDemo,
  type TransitDemoRuntime,
  type TransitDemoSnapshot,
} from '@/lib/city/city-life/transit-demo';

export interface CityLifeTransitQaProps {
  assetBaseUrl?: string;
  onClose?: () => void;
}
const phaseLabel: Record<string, string> = {
  moving: '行駛',
  approaching: '接近站點',
  stopped: '停妥',
  opening: '開門',
  dwell: '停靠',
  closing: '關門',
  departing: '離站',
  terminal: '終點候車／下車',
};

/** Independently mountable asset/service QA. Deliberately owns no main city engine state. */
export default function CityLifeTransitQa({
  assetBaseUrl = '/__offline-assets/boardable-bus',
  onClose,
}: CityLifeTransitQaProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const runtime = useRef<TransitDemoRuntime | null>(null);
  const saveCapture = useRef<(() => Promise<string>) | null>(null);
  const [captureStatus, setCaptureStatus] = useState('');
  const viewRef = useRef<'orbit' | 'rider'>('orbit');
  const lookRef = useRef({ yaw: 0, pitch: 0 });
  const [snapshot, setSnapshot] = useState<TransitDemoSnapshot | null>(null);
  const [loading, setLoading] = useState('載入原創公車外殼、內裝與接口…');
  const [error, setError] = useState('');
  const [anchorId, setAnchorId] = useState('seat-09');
  const [view, setView] = useState<'orbit' | 'rider'>('orbit');
  const [manualPause, setManualPause] = useState(false);
  const manualPauseRef = useRef(false);
  const [generation, setGeneration] = useState(0);
  const [stepMode, setStepMode] = useState(true);
  const stepModeRef = useRef(true);
  const [gpu, setGpu] = useState({ calls: 0, triangles: 0 });

  useEffect(() => {
    const host = viewport.current;
    if (!host) return;
    const abort = new AbortController();
    let disposed = false,
      animation = 0,
      previous = performance.now(),
      nextUi = 0;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (cause) {
      queueMicrotask(() => {
        if (!disposed)
          setError(
            `WebGL 初始化失敗：${cause instanceof Error ? cause.message : String(cause)}`,
          );
      });
      return () => {
        disposed = true;
      };
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb9d4df);
    scene.add(new THREE.HemisphereLight(0xe7f3ff, 0x647267, 2.4));
    const sun = new THREE.DirectionalLight(0xfff0d4, 2.2);
    sun.position.set(-30, 50, 20);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(58, 1, 0.08, 300);
    camera.position.set(-15, 9, 24);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.4, 8);
    controls.enableDamping = true;
    controls.maxDistance = 140;
    controls.minDistance = 2;
    const orbitPosition = camera.position.clone(),
      orbitTarget = controls.target.clone();
    let previousView: 'orbit' | 'rider' = 'orbit';
    const resize = () => {
      const width = Math.max(1, host.clientWidth),
        height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const visible = () => {
      previous = performance.now();
      runtime.current?.setPaused(document.hidden || manualPauseRef.current);
    };
    document.addEventListener('visibilitychange', visible);
    let drag: { x: number; y: number } | null = null;
    const pointerDown = (event: PointerEvent) => {
      if (viewRef.current !== 'rider') return;
      drag = { x: event.clientX, y: event.clientY };
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!drag || viewRef.current !== 'rider') return;
      lookRef.current.yaw -= (event.clientX - drag.x) * 0.005;
      lookRef.current.pitch = THREE.MathUtils.clamp(
        lookRef.current.pitch - (event.clientY - drag.y) * 0.005,
        -1.1,
        1.1,
      );
      drag = { x: event.clientX, y: event.clientY };
    };
    const pointerUp = () => {
      drag = null;
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', pointerUp);
    queueMicrotask(() => {
      if (disposed) return;
      setError('');
      setSnapshot(null);
      setLoading('載入原創公車外殼、內裝與接口…');
    });
    createTransitDemo({ assetBaseUrl, signal: abort.signal })
      .then((demo) => {
        if (disposed) {
          demo.dispose();
          return;
        }
        runtime.current = demo;
        scene.add(demo.root);
        demo.setPaused(document.hidden || manualPauseRef.current);
        setSnapshot(demo.snapshot());
        setLoading('');
      })
      .catch((cause) => {
        if (!disposed) {
          setLoading('');
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    const draw = (now: number) => {
      if (disposed) return;
      const elapsed = (now - previous) / 1000;
      previous = now;
      const demo = runtime.current;
      if (demo) {
        if (!stepModeRef.current) demo.update(elapsed);
        const requestedView = viewRef.current,
          rider = demo.riderCameraPose();
        if (requestedView === 'rider' && rider) {
          if (previousView !== 'rider') {
            orbitPosition.copy(camera.position);
            orbitTarget.copy(controls.target);
            previousView = 'rider';
          }
          controls.enabled = false;
          const look = lookRef.current;
          // Camera looks down -Z, while the vehicle's front axis is +Z.
          const localLook = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(look.pitch, Math.PI + look.yaw, 0, 'YXZ'),
          );
          camera.position.copy(rider.position);
          camera.quaternion.copy(rider.rotation).multiply(localLook);
          demo.root.getObjectByName('research-passenger')!.visible = false;
        } else {
          if (previousView === 'rider') {
            camera.position.copy(orbitPosition);
            controls.target.copy(orbitTarget);
            previousView = 'orbit';
          }
          controls.enabled = true;
          controls.update();
          demo.root.getObjectByName('research-passenger')!.visible = true;
        }
        if (now >= nextUi) {
          setSnapshot(demo.snapshot());
          setGpu({
            calls: renderer.info.render.calls,
            triangles: renderer.info.render.triangles,
          });
          nextUi = now + 150;
        }
      }
      if (!document.hidden) renderer.render(scene, camera);
      animation = requestAnimationFrame(draw);
    };
    saveCapture.current = async () => {
      const demo = runtime.current;
      if (disposed || !demo) throw new Error('研究場景尚未就緒');
      // The renderer does not preserve its drawing buffer. Render and encode in
      // the same task, before the browser clears/presents it.
      renderer.render(scene, camera);
      const screenshot = renderer.domElement.toDataURL('image/png');
      const state = demo.snapshot();
      const anchor =
        state.passenger.mode === 'riding'
          ? state.passenger.anchor.anchorId.replace(/[^a-z0-9]/g, '')
          : 'walking';
      const name = `bus-${anchor}-stop${state.service.stopIndex + 1}-${viewRef.current}-${state.service.phase}`;
      const row = {
        scene: 'city-life-transit-qa',
        capturedAt: new Date().toISOString(),
        snapshot: state,
        ui: {
          view: viewRef.current,
          stepMode: stepModeRef.current,
          manualPause: manualPauseRef.current,
        },
        gpu: {
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
        },
        viewport: {
          cssWidth: host.clientWidth,
          cssHeight: host.clientHeight,
          pixelWidth: renderer.domElement.width,
          pixelHeight: renderer.domElement.height,
          rendererPixelRatio: renderer.getPixelRatio(),
          devicePixelRatio: window.devicePixelRatio,
        },
        camera: {
          position: camera.position.toArray(),
          quaternion: camera.quaternion.toArray(),
        },
      };
      const response = await fetch('/__visual-qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, screenshot, row }),
        signal: abort.signal,
      });
      if (!response.ok)
        throw new Error(`驗證截圖儲存失敗 (${response.status})`);
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== 'object' ||
        !('saved' in result) ||
        result.saved !== true
      )
        throw new Error('本機 QA server 未確認儲存');
      return name;
    };
    animation = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      saveCapture.current = null;
      abort.abort();
      cancelAnimationFrame(animation);
      document.removeEventListener('visibilitychange', visible);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerUp);
      controls.dispose();
      runtime.current?.dispose();
      runtime.current = null;
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [assetBaseUrl, generation]);

  const command = (action: (demo: TransitDemoRuntime) => void) => {
    if (!runtime.current) return;
    action(runtime.current);
    setSnapshot(runtime.current.snapshot());
  };
  const changeView = (next: 'orbit' | 'rider') => {
    viewRef.current = next;
    setView(next);
  };
  const reset = () => {
    if (snapshot?.passenger.mode === 'riding' || snapshot?.pendingTransfers)
      return;
    changeView('orbit');
    lookRef.current = { yaw: 0, pitch: 0 };
    setGeneration((n) => n + 1);
  };
  const buttonStyle = {
    padding: '8px 12px',
    borderRadius: 7,
    border: '1px solid #567477',
    background: '#eff7f3',
    color: '#173c3f',
    cursor: 'pointer',
  } as const;
  const rider = snapshot?.passenger.mode === 'riding';
  return (
    <section
      aria-label="公共運輸研究驗證場景"
      style={{
        minHeight: '100vh',
        color: '#e8f2f0',
        background: '#152c31',
        padding: 16,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <header style={{ maxWidth: 1200, margin: '0 auto 12px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <h1 style={{ fontSize: 24, margin: 0 }}>公車搭乘研究場景</h1>
          {onClose && (
            <button style={buttonStyle} onClick={onClose}>
              返回城市
            </button>
          )}
        </div>
        <p style={{ margin: '8px 0', color: '#b7d2d0' }}>
          原創三站彎道與等高候車島，用於驗證車門、座位、按鈴和下車。此處不是實際公車路線或七站
          SkyTrain。
        </p>
      </header>
      <div
        ref={viewport}
        style={{
          height: 'min(65vh, 620px)',
          minHeight: 350,
          width: '100%',
          maxWidth: 1200,
          margin: '0 auto',
          borderRadius: 12,
          overflow: 'hidden',
          touchAction: 'none',
        }}
      />
      <div style={{ maxWidth: 1200, margin: '12px auto' }}>
        {loading && <output style={{ display: 'block' }}>{loading}</output>}
        {error && (
          <p role="alert" style={{ color: '#ffb9a8' }}>
            {error}
          </p>
        )}
        {snapshot && (
          <>
            <p aria-live="polite" style={{ margin: '8px 0' }}>
              {snapshot.currentStopLabel} · {phaseLabel[snapshot.service.phase]}{' '}
              · {snapshot.service.speedMps.toFixed(2)} m/s ·{' '}
              {snapshot.paused ? '暫停' : '運行'} ·{' '}
              {rider ? '乘坐中' : '站外候車'}
            </p>
            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <label>
                乘坐錨點{' '}
                <select
                  aria-label="乘坐錨點"
                  value={anchorId}
                  disabled={rider}
                  onChange={(event) => setAnchorId(event.target.value)}
                  style={{ ...buttonStyle, padding: 8 }}
                >
                  {snapshot.anchors.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.kind === 'seat' ? '座位' : '站立'} {a.id}
                    </option>
                  ))}
                </select>
              </label>
              <button
                style={buttonStyle}
                onClick={() => {
                  const next = !stepMode;
                  setStepMode(next);
                  stepModeRef.current = next;
                }}
              >
                {stepMode ? '切換即時播放' : '切換逐站驗證'}
              </button>
              <button
                style={buttonStyle}
                disabled={
                  !stepMode ||
                  snapshot.paused ||
                  snapshot.service.phase === 'terminal'
                }
                onClick={() =>
                  command((demo) => {
                    demo.advanceToNextOpenStop();
                  })
                }
              >
                步進至下一站開門
              </button>
              <button
                style={buttonStyle}
                disabled={!snapshot.canBoard || rider}
                onClick={() =>
                  command((demo) => {
                    if (demo.board(anchorId)) changeView('rider');
                  })
                }
              >
                上車
              </button>
              <button
                style={buttonStyle}
                disabled={!rider || snapshot.paused}
                onClick={() =>
                  command((demo) => {
                    demo.requestStop();
                  })
                }
              >
                按下車鈴
              </button>
              <button
                style={buttonStyle}
                disabled={!snapshot.canAlight || !rider}
                onClick={() =>
                  command((demo) => {
                    if (demo.alight()) changeView('orbit');
                  })
                }
              >
                後門下車
              </button>
              <button
                style={buttonStyle}
                disabled={!rider}
                onClick={() => changeView(view === 'rider' ? 'orbit' : 'rider')}
              >
                {view === 'rider' ? 'Orbit 觀察' : '回到乘坐視角'}
              </button>
              <button
                style={buttonStyle}
                onClick={() => {
                  const paused = !manualPause;
                  setManualPause(paused);
                  manualPauseRef.current = paused;
                  command((demo) => demo.setPaused(paused || document.hidden));
                }}
              >
                {manualPause ? '繼續服務' : '暫停服務'}
              </button>
              <button
                style={buttonStyle}
                disabled={rider || snapshot.pendingTransfers > 0}
                onClick={reset}
              >
                重設研究場景
              </button>
              <button
                style={buttonStyle}
                onClick={() => {
                  const capture = saveCapture.current;
                  if (!capture) return;
                  setCaptureStatus('儲存搭乘驗證截圖…');
                  capture()
                    .then((name) =>
                      setCaptureStatus(`已儲存 ${name}.png 與 .json`),
                    )
                    .catch((cause) =>
                      setCaptureStatus(
                        cause instanceof Error ? cause.message : String(cause),
                      ),
                    );
                }}
              >
                儲存搭乘驗證截圖
              </button>
            </div>
            <output style={{ display: 'block', margin: '10px 0' }}>
              {snapshot.lastAction}
              {snapshot.service.bellRequested ? ' · 下車鈴已請求' : ''}
            </output>
            {captureStatus && (
              <output
                aria-label="截圖儲存狀態"
                style={{ display: 'block', color: '#bce3dd', fontSize: 13 }}
              >
                {captureStatus}
              </output>
            )}
            <p style={{ color: '#b7d2d0', fontSize: 13 }}>
              Orbit 可拖曳及縮放；乘坐視角可拖曳看向。此版使用固定座位／站立點。
              {stepMode
                ? '逐站驗證模式：時間只在步進時推進，可穩定檢查上下車。'
                : '即時播放模式：車門與服務按 elapsed time 連續推進。'}
              隱藏分頁會暫停服務；終點保持開門，不會重設載客車。
            </p>
            <output
              id="city-life-transit-state"
              data-testid="transit-state"
              aria-label="搭乘驗證狀態 JSON"
              style={{
                display: 'block',
                overflowWrap: 'anywhere',
                fontSize: 11,
                color: '#a7c3bf',
              }}
            >
              {JSON.stringify({
                phase: snapshot.service.phase,
                stopId: snapshot.service.stopId,
                stopIndex: snapshot.service.stopIndex,
                stationM: snapshot.service.pathStationM,
                speedMps: snapshot.service.speedMps,
                doorProgress: snapshot.doorProgress,
                doorsOpen: snapshot.doorsOpen,
                canBoard: snapshot.canBoard,
                canAlight: snapshot.canAlight,
                passenger: snapshot.passenger,
                passengerCount: snapshot.passengerCount,
                pendingTransfers: snapshot.pendingTransfers,
                bellRequested: snapshot.service.bellRequested,
                anchorErrorM: snapshot.anchorErrorM,
                elapsedSeconds: snapshot.elapsedSeconds,
                paused: snapshot.paused,
                view,
                stepMode,
                lastAction: snapshot.lastAction,
              })}
            </output>
            <details>
              <summary>驗證資料與事件</summary>
              <p style={{ fontSize: 13 }}>
                乘客 {snapshot.passengerCount} · 交接{' '}
                {snapshot.pendingTransfers} · 門{' '}
                {Math.round(snapshot.doorProgress * 100)}% · local anchor 誤差{' '}
                {snapshot.anchorErrorM.toFixed(6)} m · simulation{' '}
                {snapshot.elapsedSeconds.toFixed(2)} s · WebGL draws {gpu.calls}{' '}
                / triangles {gpu.triangles}
              </p>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
                {snapshot.events.join('\n')}
              </pre>
            </details>
          </>
        )}
        {!loading && (
          <p style={{ color: '#a7c3bf', fontSize: 12, marginTop: 16 }}>
            Based on Vancouver Living Atlas by YiTaChen ·{' '}
            <a
              href="https://github.com/YiTaChen/vancouver-living-atlas"
              style={{ color: '#bce3dd' }}
            >
              Source
            </a>{' '}
            · Vancouver Living Atlas Noncommercial Research and Attribution 1.0
            · Modified research runtime
          </p>
        )}
      </div>
    </section>
  );
}
