import * as THREE from 'three';
import { lightMixtureCSS, type LightLevels } from './light-lab';

/** One original screen on the existing demonstration island. Repaint only on
 * input, with no lights, shadow pass, animation loop or additional footprint. */
export class LightLabExhibit {
  readonly screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private canvas: HTMLCanvasElement | null;
  private previous = '';
  constructor() {
    this.canvas =
      typeof document === 'undefined' ? null : document.createElement('canvas');
    if (this.canvas) {
      this.canvas.width = 512;
      this.canvas.height = 256;
    }
    const texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : null;
    if (texture) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 2;
    }
    this.screen = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 1.8),
      new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        toneMapped: false,
      }),
    );
    this.screen.name = 'Atlas original light-mixing exhibit';
    this.screen.rotation.y = Math.PI;
    this.setLevels([100, 100, 100]);
  }
  setLevels(levels: LightLevels) {
    const safe = levels.map((value) =>
      Math.round(
        Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)),
      ),
    ) as unknown as LightLevels;
    const key = safe.join(',');
    if (key === this.previous) return;
    this.previous = key;
    this.screen.userData.lightLevels = [...safe];
    const ctx = this.canvas?.getContext('2d');
    if (!ctx) return;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#07141e';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#e9f3ea';
    ctx.font = '600 26px sans-serif';
    ctx.fillText('LIGHT LAB', 23, 35);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#91b5bb';
    ctx.fillText('VANCOUVER ATLAS', 339, 32);
    // Separate primary channels add to the same sRGB result as the UI swatch.
    // Black under the diagram makes lighter compositing exactly additive.
    ctx.fillStyle = '#000';
    ctx.fillRect(24, 51, 305, 177);
    const centers = [
      [142, 118],
      [209, 118],
      [176, 169],
    ];
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const channel = [0, 0, 0] as [number, number, number];
      channel[i] = safe[i];
      ctx.fillStyle = lightMixtureCSS(channel);
      ctx.beginPath();
      ctx.arc(centers[i][0], centers[i][1], 54, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#45616a';
    ctx.lineWidth = 1;
    for (const [x, y] of centers) {
      ctx.beginPath();
      ctx.arc(x, y, 54, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = lightMixtureCSS(safe);
    ctx.fillRect(354, 72, 128, 72);
    ctx.strokeStyle = '#74929b';
    ctx.strokeRect(354, 72, 128, 72);
    ctx.font = '600 16px monospace';
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = ['#ffb8b8', '#b8ffc8', '#b8ceff'][i];
      ctx.fillText(
        `${['R', 'G', 'B'][i]}  ${String(safe[i]).padStart(3, ' ')}%`,
        364,
        172 + i * 23,
      );
    }
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#aac0c8';
    ctx.fillText('MIX LIGHT · WATCH THE OVERLAP', 29, 245);
    if (this.screen.material.map) this.screen.material.map.needsUpdate = true;
  }
}
