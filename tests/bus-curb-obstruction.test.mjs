import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import ts from 'typescript';
import { cityModule } from './helpers/city-modules.mjs';

const { createRoadSurfaces } = await import(cityModule('road-surfaces'));
const { addStreetMeshes } = await import(cityModule('street-meshes'));
const { walkableGroundMeshes } = await import(cityModule('ground-surface'));
const { BusAccessibility } = await import(cityModule('bus-accessibility'));
const { unproject } = await import(cityModule('geo'));
const navigation = ts.createSourceFile(
  'navigation.ts',
  await readFile('lib/city/navigation.ts', 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const cls = navigation.statements.find(
  (node) =>
    ts.isClassDeclaration(node) && node.name.text === 'StreetNavigation',
);
const groundHeight = cls.members.find(
  (node) =>
    ts.isMethodDeclaration(node) &&
    node.name.getText(navigation) === 'groundHeight',
);
// Execute the actual cached-index adapter without constructing DOM controls,
// walkers or vehicle models that are unrelated to the obstruction source.
const code = ts.transpileModule(
  `
  import * as THREE from '${import.meta.resolve('three')}';
  import { GroundSurfaceIndex, walkableGroundMeshes } from '${cityModule('ground-surface')}';
  export class NavigationProbe { ${groundHeight.getText(navigation)} }
`,
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { NavigationProbe } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);

function geometry(positions, normals, colors, uv) {
  const result = new THREE.BufferGeometry();
  result.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  result.computeVertexNormals();
  if (uv) result.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return result;
}
function host() {
  const scene = new THREE.Scene(),
    roads = new THREE.Group();
  scene.add(roads);
  return {
    scene,
    roads,
    geometry,
    elevation: () => 0,
    interiors: { height: () => undefined },
  };
}
const probe = (e) =>
  Object.assign(new NavigationProbe(), { e, groundSurface: null });
function release(e) {
  const resources = new Set(e.extraTextures ?? []);
  e.scene.traverse((node) => {
    if (!node.isMesh) return;
    resources.add(node.geometry);
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material])
      resources.add(material);
  });
  for (const resource of resources) resource.dispose();
}

test('actual rendered road curb chunks opt into obstruction queries and remain outside the walking/placement floor set', (t) => {
  t.mock.method(
    THREE.TextureLoader.prototype,
    'load',
    () => new THREE.Texture(),
  );
  const e = Object.assign(host(), {
    extraTextures: new Set(),
    roadMaterials: new Map(),
    stats: {},
    data: {
      trees: { trees: [] },
      roads: {
        features: [
          {
            properties: { name: 'TEST ST', class: 'Residential', width: 10 },
            geometry: {
              type: 'LineString',
              coordinates: [
                [0, 0],
                [60, 0],
              ].map((p) => unproject(...p)),
            },
          },
        ],
      },
    },
  });
  try {
    createRoadSurfaces(e);
    const curbs = e.roads.children.filter((node) =>
      node.name.startsWith('Road-facing curb edges'),
    );
    assert.ok(curbs.length > 0);
    assert.ok(
      curbs.every(
        (node) =>
          node.userData.groundObstruction === true &&
          node.userData.walkSurface === false,
      ),
    );
    assert.ok(
      walkableGroundMeshes(e.scene).every((node) => !curbs.includes(node)),
    );
    const nav = probe(e);
    assert.ok(Math.abs(nav.groundHeight(30, 0) - 1.05) < 1e-6);
    const cached = nav.groundSurface;
    const bounds = new THREE.Box3().setFromObject(curbs[0]);
    const faces = cached.trianglesInBounds(bounds);
    assert.ok(
      faces.some(
        (triangle) =>
          Math.max(...triangle.map((p) => p.y)) -
            Math.min(...triangle.map((p) => p.y)) >
          0.12,
      ),
    );
    nav.groundHeight(31, 0);
    assert.equal(nav.groundSurface, cached, 'the source index remains cached');
  } finally {
    release(e);
  }
});

test('obstruction selection is limited to explicit unprotected source road chunks', () => {
  const e = host();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2),
  );
  floor.userData.walkSurface = true;
  e.roads.add(floor);
  for (const [where, protectedSurface, flag] of [
    ['road', false, true],
    ['road', true, true],
    ['road', false, false],
    ['other', false, true],
  ]) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2));
    face.position.set(
      where === 'road' && !protectedSurface && flag ? 1 : 4,
      0.5,
      0,
    );
    face.userData.groundObstruction = flag;
    face.userData.protectedSurface = protectedSurface;
    (where === 'road' ? e.roads : e.scene).add(face);
  }
  try {
    const nav = probe(e);
    assert.equal(nav.groundHeight(0, 0), 0);
    const at = (x) =>
      nav.groundSurface.trianglesInBounds(
        new THREE.Box3(
          new THREE.Vector3(x - 0.15, 0.3, -0.1),
          new THREE.Vector3(x + 0.15, 0.7, 0.1),
        ),
      );
    assert.equal(at(1).length, 2);
    assert.equal(
      at(4).length,
      0,
      'protected, unmarked and unrelated scene meshes are excluded',
    );
  } finally {
    release(e);
  }
});

test('ground sampling retains its original behavior when a navigation host has no road group', () => {
  const e = host();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2),
  );
  floor.userData.walkSurface = true;
  floor.position.y = 0.25;
  e.scene.add(floor);
  delete e.roads;
  try {
    const nav = probe(e);
    assert.equal(nav.groundHeight(0, 0), 0.25);
    assert.equal(nav.groundHeight(40, 40), 0);
  } finally {
    release(e);
  }
});

test('a rendered narrow curb blocks the complete ramp sweep without becoming a sampled walking height', async () => {
  const metadata = JSON.parse(
    await readFile('public/models/blender/bus-hybrid/manifest.json', 'utf8'),
  ).accessibility;
  for (const flagged of [false, true]) {
    const e = host();
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2),
    );
    floor.userData.walkSurface = true;
    e.roads.add(floor);
    const [hx, , hz] = metadata.ramp.hingeM;
    const centerZ = hz + metadata.ramp.centerOffsetM[2] + 0.2;
    const curbGeometry = new THREE.BoxGeometry(0.02, 0.13, 0.08).toNonIndexed();
    curbGeometry.translate(hx - 1, 0.065, centerZ);
    const curbMaterial = new THREE.MeshBasicMaterial();
    const rendered = addStreetMeshes(
      e,
      Array.from(curbGeometry.getAttribute('position').array),
      curbMaterial,
      'Road-facing curb edges',
    );
    curbGeometry.dispose();
    for (const mesh of rendered) mesh.userData.groundObstruction = flagged;
    const nav = probe(e);
    assert.ok(
      Math.abs(nav.groundHeight(hx - 1, centerZ)) < 1e-7,
      'even the curb cap cannot become a walking height',
    );
    const root = new THREE.Group(),
      ramp = new THREE.Group();
    ramp.name = 'boarding-ramp';
    ramp.position.fromArray(metadata.ramp.hingeM);
    root.add(ramp);
    for (const name of metadata.wheelNodeIds) {
      const wheel = new THREE.Group();
      wheel.name = name;
      root.add(wheel);
    }
    const controller = BusAccessibility.create(
      root,
      metadata,
      (x, z) => ({ y: nav.groundHeight(x, z), surfaceId: 'ground', layer: 0 }),
      () => true,
      (bounds) => nav.groundSurface.trianglesInBounds(bounds),
    );
    try {
      assert.ok(controller);
      assert.equal(
        controller.deploy(true),
        !flagged,
        'source curb triangles, rather than height samples, reject the intersection',
      );
      if (flagged) assert.equal(controller.snapshot().error, 'ramp-obstructed');
    } finally {
      controller?.dispose();
      release(e);
    }
  }
});
