import * as THREE from 'three';

/** Original fictional businesses: architectural scene dressing, never POI data. */
export const SHOP_IDENTITIES = [
  {
    name: 'ALDER & STEAM',
    trade: 'COFFEE HOUSE',
    color: '#234c43',
    accent: '#e6bb77',
    display: 'coffee',
  },
  {
    name: 'PAPER TIDE',
    trade: 'BOOKS & JOURNALS',
    color: '#733d34',
    accent: '#edc9a0',
    display: 'books',
  },
  {
    name: 'MOSS & CLAY',
    trade: 'PLANTS & CERAMICS',
    color: '#4b5740',
    accent: '#dfd3ab',
    display: 'plants',
  },
  {
    name: 'TIDELINE',
    trade: 'RECORDS & SOUND',
    color: '#2d4755',
    accent: '#d9bc81',
    display: 'records',
  },
  {
    name: 'CEDAR STUDIO',
    trade: 'PRINTS & EDITIONS',
    color: '#805d3d',
    accent: '#efe0bb',
    display: 'prints',
  },
  {
    name: 'NORTH WINDOW',
    trade: 'ART & OBJECTS',
    color: '#423c50',
    accent: '#dbc5a7',
    display: 'gallery',
  },
] as const;

export type ShopPanelRole = 'fascia' | 'display' | 'notice';
export type ShopPanel = {
  matrix: THREE.Matrix4;
  identity: number;
  role: ShopPanelRole;
};
export const SHOP_ATLAS_SIZE = 1024;

/** Stable against dataset ordering, streaming and LOD switches. */
export function shopIdentityFor(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++)
    hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return (hash >>> 0) % SHOP_IDENTITIES.length;
}

/** Two columns × three rows. Gutters keep neighbouring signs out of mip edges. */
export function shopAtlasRect(
  identity: number,
  role: ShopPanelRole,
): [number, number, number, number] {
  const id =
    ((identity % SHOP_IDENTITIES.length) + SHOP_IDENTITIES.length) %
    SHOP_IDENTITIES.length;
  const x = (id % 2) * 512,
    y = Math.floor(id / 2) * 336;
  const region =
    role === 'fascia'
      ? [x + 8, y + 8, 496, 40]
      : role === 'display'
        ? [x + 8, y + 56, 240, 272]
        : [x + 264, y + 56, 240, 272];
  return [
    region[0] / SHOP_ATLAS_SIZE,
    1 - (region[1] + region[3]) / SHOP_ATLAS_SIZE,
    region[2] / SHOP_ATLAS_SIZE,
    region[3] / SHOP_ATLAS_SIZE,
  ];
}

/** Draw a small authored display with independent objects; no downloaded imagery. */
export function paintShopAtlas(canvas: HTMLCanvasElement): void {
  canvas.width = canvas.height = SHOP_ATLAS_SIZE;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#172523';
  c.fillRect(0, 0, canvas.width, canvas.height);
  SHOP_IDENTITIES.forEach((shop, id) => {
    const x = (id % 2) * 512,
      y = Math.floor(id / 2) * 336;
    c.save();
    c.translate(x, y);
    c.fillStyle = shop.color;
    c.fillRect(0, 0, 512, 336);
    c.strokeStyle = shop.accent;
    c.lineWidth = 1;
    c.strokeRect(10, 10, 492, 36);
    c.fillStyle = shop.accent;
    c.font = '600 29px Georgia';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(shop.name, 256, 29, 460);

    // Display backing sits behind the existing glass, shelves and door relief.
    c.save();
    c.translate(8, 56);
    c.fillStyle = '#8b8068';
    c.fillRect(0, 0, 240, 272);
    c.fillStyle = '#c6b699';
    c.fillRect(15, 15, 210, 214);
    c.fillStyle = '#514434';
    c.fillRect(0, 235, 240, 37);
    c.fillStyle = '#a9875f';
    c.fillRect(12, 225, 216, 10);
    c.fillStyle = shop.color;
    c.fillRect(31, 23, 178, 33);
    c.fillStyle = '#f3e7ca';
    c.font = '600 11px sans-serif';
    c.fillText(shop.trade, 120, 41, 164);
    const shelf = (top: number) => {
      c.fillStyle = '#684b34';
      c.fillRect(23, top, 194, 7);
      c.fillStyle = '#aa875a';
      c.fillRect(23, top, 194, 2);
    };
    const book = (
      left: number,
      top: number,
      width: number,
      height: number,
      color: string,
    ) => {
      c.fillStyle = color;
      c.fillRect(left, top, width, height);
      c.fillStyle = '#d6c297';
      c.fillRect(left + 3, top + 7, Math.max(2, width - 6), 2);
      c.fillRect(left + 3, top + height - 8, Math.max(2, width - 6), 1);
    };
    const pot = (left: number, top: number, width: number, height: number) => {
      c.fillStyle = '#ae7755';
      c.beginPath();
      c.moveTo(left, top);
      c.lineTo(left + width, top);
      c.lineTo(left + width * 0.83, top + height);
      c.lineTo(left + width * 0.17, top + height);
      c.closePath();
      c.fill();
      c.fillStyle = '#cca281';
      c.fillRect(left - 2, top, width + 4, 5);
    };
    if (shop.display === 'books') {
      for (let row = 0; row < 3; row++) {
        const base = 112 + row * 50;
        for (let j = 0; j < 11; j++)
          book(
            30 + j * 16,
            base - 28 - (j % 3) * 5,
            11 + (j % 2) * 2,
            28 + (j % 3) * 5,
            ['#3d5960', '#8a4940', '#b18b56', '#59634a'][j % 4],
          );
        shelf(base);
      }
    } else if (shop.display === 'records') {
      for (let i = 0; i < 4; i++) {
        const px = 38 + (i % 2) * 87,
          py = 72 + Math.floor(i / 2) * 77;
        c.fillStyle = ['#b97750', '#384c60', '#878c61', '#77474f'][i];
        c.fillRect(px, py, 66, 65);
        c.fillStyle = '#24282a';
        c.beginPath();
        c.arc(px + 33, py + 31, 24, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#515456';
        c.lineWidth = 1;
        c.beginPath();
        c.arc(px + 33, py + 31, 18, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = shop.accent;
        c.beginPath();
        c.arc(px + 33, py + 31, 7, 0, Math.PI * 2);
        c.fill();
      }
      shelf(218);
    } else if (shop.display === 'plants') {
      for (let i = 0; i < 3; i++) {
        const px = 45 + i * 67,
          py = 173 - (i % 2) * 32;
        c.strokeStyle = '#44583b';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(px, py + 10);
        c.lineTo(px, py - 57);
        c.stroke();
        for (let leaf = 0; leaf < 6; leaf++) {
          c.fillStyle = leaf % 2 ? '#5b7146' : '#3c5c43';
          c.beginPath();
          c.ellipse(
            px + (leaf % 2 ? 10 : -10),
            py - 44 + Math.floor(leaf / 2) * 17,
            14,
            7,
            leaf % 2 ? -0.6 : 0.6,
            0,
            Math.PI * 2,
          );
          c.fill();
        }
        pot(px - 17, py, 34, 35);
      }
      shelf(214);
    } else if (shop.display === 'coffee') {
      c.fillStyle = '#4c4e49';
      c.fillRect(37, 144, 107, 46);
      c.fillStyle = '#bec0af';
      c.fillRect(42, 148, 97, 13);
      for (let i = 0; i < 3; i++) {
        c.fillStyle = '#e4d5b6';
        c.fillRect(50 + i * 28, 171, 17, 18);
        c.fillStyle = '#493a2d';
        c.fillRect(48 + i * 28, 190, 22, 3);
      }
      for (let i = 0; i < 4; i++) {
        book(42 + i * 41, 87, 28, 38, '#93724d');
        c.fillStyle = '#e1d0a3';
        c.fillRect(49 + i * 41, 99, 14, 15);
      }
      pot(167, 161, 25, 32);
      shelf(129);
      shelf(197);
    } else {
      for (let i = 0; i < 3; i++) {
        const px = 32 + i * 62,
          py = 79 + (i % 2) * 18;
        c.fillStyle = '#5b4333';
        c.fillRect(px, py, 54, 84);
        c.fillStyle = '#ece0c4';
        c.fillRect(px + 4, py + 4, 46, 76);
        c.fillStyle = ['#b8784b', '#526b70', '#7c7953'][i];
        c.beginPath();
        c.arc(px + 27, py + 32, 15, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = shop.color;
        c.beginPath();
        c.moveTo(px + 8, py + 67);
        c.lineTo(px + 24, py + 38);
        c.lineTo(px + 46, py + 67);
        c.closePath();
        c.fill();
      }
      shelf(186);
      pot(99, 195, 42, 25);
    }
    c.restore();

    // A restrained second window / door card adds human-scale typography.
    c.save();
    c.translate(264, 56);
    c.fillStyle = shop.color;
    c.fillRect(0, 0, 240, 272);
    c.strokeStyle = shop.accent;
    c.lineWidth = 2;
    c.strokeRect(12, 12, 216, 248);
    c.fillStyle = shop.accent;
    c.font = '12px sans-serif';
    c.fillText('INDEPENDENT • LOCAL', 120, 37);
    c.font = '600 23px Georgia';
    c.fillText(shop.trade.split(' & ')[0], 120, 80, 204);
    c.font = 'italic 19px Georgia';
    c.fillText(
      [
        'Freshly brewed',
        'Find your next story',
        'A little more green',
        'Listen a little longer',
        'Made to be kept',
        'Room for curiosity',
      ][id],
      120,
      117,
      200,
    );
    c.strokeStyle = shop.accent;
    c.beginPath();
    c.moveTo(53, 143);
    c.lineTo(187, 143);
    c.stroke();
    c.font = '600 29px Georgia';
    c.fillText('WELCOME', 120, 179);
    c.font = '12px sans-serif';
    c.fillText('COME IN • TAKE YOUR TIME', 120, 224, 202);
    c.restore();
    c.restore();
  });
}

export function createShopIdentityMaterial(
  canvas: HTMLCanvasElement,
): THREE.MeshStandardMaterial {
  paintShopAtlas(canvas);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  // A subtle material emission keeps the original display art legible under a
  // rain hood without adding a light, shadow map or bloom-dependent highlight.
  const material = new THREE.MeshStandardMaterial({
    map,
    emissiveMap: map,
    emissive: 0xffffff,
    emissiveIntensity: 0.12,
    roughness: 0.88,
  });
  material.name = 'Original shop identity atlas';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute vec4 shopAtlasRect;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      #ifdef USE_MAP
        vMapUv = shopAtlasRect.xy + vMapUv * shopAtlasRect.zw;
      #endif
      #ifdef USE_EMISSIVEMAP
        vEmissiveMapUv = shopAtlasRect.xy + vEmissiveMapUv * shopAtlasRect.zw;
      #endif`,
    );
  };
  material.customProgramCacheKey = () => 'shop-identity-atlas-v1';
  return material;
}

/** One shared atlas draw per cell, including all three roles and six identities. */
export function createShopPanelBatch(
  panels: readonly ShopPanel[],
  material: THREE.MeshStandardMaterial,
): THREE.InstancedMesh {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.setAttribute(
    'shopAtlasRect',
    new THREE.InstancedBufferAttribute(
      new Float32Array(
        panels.flatMap((panel) => shopAtlasRect(panel.identity, panel.role)),
      ),
      4,
    ),
  );
  const mesh = new THREE.InstancedMesh(geometry, material, panels.length);
  panels.forEach((panel, index) => mesh.setMatrixAt(index, panel.matrix));
  mesh.name = 'Original shop signs and display artwork';
  mesh.userData.streetIdentity = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Local planes remain inside the already-validated GLB bounds; 6 triangles/bay. */
export function detailedShopPanels(
  identity: number,
  matrix: THREE.Matrix4,
): ShopPanel[] {
  const panel = (
    role: ShopPanelRole,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
  ): ShopPanel => ({
    identity,
    role,
    matrix: matrix
      .clone()
      .multiply(new THREE.Matrix4().makeTranslation(x, y, z))
      .scale(new THREE.Vector3(w, h, 1)),
  });
  return [
    panel('fascia', 0, 3.001, 0.478, 2.69, 0.19),
    panel('display', 0.455, 1.72, 0.056, 1.62, 1.7),
    panel('notice', -0.875, 1.76, 0.258, 0.46, 0.56),
  ];
}
