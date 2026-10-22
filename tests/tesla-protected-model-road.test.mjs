import * as THREE from 'three';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { TeslaWorld, triangleFace, fixedFacesSource } = await import(
  cityModule('tesla-world')
);
const {
  TESLA_DEFAULT_SHAPE: shape,
  createTesla,
  stepTesla,
} = await import(cityModule('tesla-state'));
const { teslaRotate } = await import(cityModule('tesla-math'));
const group = 'protected:park:prospect-overpass:2',
  height = shape.halfExtents[1] + shape.clearance;
function floor({
  group: owner = group,
  kind = 'ground',
  gap = false,
  yOffset = 0,
} = {}) {
  const result = [];
  for (let z = -20; z < 20; z += 0.5) {
    if (gap && z === 0) continue;
    const h = (p) => yOffset + 0.004 * p * p,
      vertices = [
        [-4, h(z), z],
        [-4, h(z + 0.5), z + 0.5],
        [4, h(z + 0.5), z + 0.5],
        [4, h(z), z],
      ],
      grade = (h(z + 0.5) - h(z)) / 0.5;
    for (const [i, indices] of [
      [0, [0, 1, 2]],
      [1, [0, 2, 3]],
    ])
      result.push(
        triangleFace(
          `${String(owner)}:${z}:${String(i)}`,
          `${String(owner)}:${z}:${String(i)}`,
          kind,
          indices.map((n) => vertices[n]),
          true,
          owner,
          [0, 1, -grade],
        ),
      );
  }
  return result;
}
function world(faces, groups = [group]) {
  return new TeslaWorld({
    sources: [fixedFacesSource('physical-source', faces)],
    modelGroundGroups: groups,
  });
}
function fit(w, z = 0) {
  return w.fitGround({
    pose: {
      position: [0, 0.004 * z * z + height, z],
      quaternion: [0, 0, 0, 1],
    },
    shape,
    preferredSurfaceId: `${group}:${Math.floor(z * 2) / 2}:0`,
    maxAdjustmentM: 0.35,
  });
}
test('only explicit authored model-road group gains four-wheel curve fitting; other protected floors and roofs remain strict', () => {
  for (const [owner, kind, configured, allowed] of [
    [group, 'ground', [], false],
    [group, 'ground', [group], true],
    ['protected:other:2', 'ground', [group], false],
    [group, 'roof', [group], false],
  ]) {
    const w = world(floor({ group: owner, kind }), configured);
    try {
      const result = w.fitGround({
        pose: { position: [0, height, 0], quaternion: [0, 0, 0, 1] },
        shape,
        preferredSurfaceId: `${String(owner)}:0:0`,
        maxAdjustmentM: 0.35,
      });
      assert.equal(!!result, allowed, `${String(owner)}/${String(kind)}`);
      if (result)
        assert.equal(
          w.sweep({
            from: result.pose,
            to: result.pose,
            shape,
            ignoreSurfaceId: result.contact.surfaceId,
          }),
          null,
        );
    } finally {
      w.dispose();
    }
  }
});
test('configured curved road keeps real four-wheel support, complete hull clearance and dynamic motion', () => {
  const w = world(floor());
  try {
    const initial = fit(w, -7);
    assert.ok(initial);
    const state = createTesla(initial.pose.position, 0, initial.contact);
    state.quaternion = initial.pose.quaternion;
    state.velocity = teslaRotate(state.quaternion, [0, 0, 24]);
    for (let i = 0; i < 40; i++) {
      const report = stepTesla(state, { throttle: 0.3 }, 1 / 60, w, shape);
      assert.equal(report.environmentFailures, 0);
      assert.equal(report.collisions, 0, `frame${i}`);
      assert.equal(state.mode, 'ground');
      assert.ok(
        w.support({
          pose: state,
          shape,
          maxDistance: height + 0.2,
          preferredSurfaceId: state.contact.surfaceId,
          adhesion: false,
        }),
      );
      assert.equal(
        w.sweep({
          from: state,
          to: state,
          shape,
          ignoreSurfaceId: state.contact.surfaceId,
        }),
        null,
      );
    }
    assert.ok(
      state.position[2] > 5,
      'crosses continuously from descending to ascending grade',
    );
  } finally {
    w.dispose();
  }
});
test('a model road cannot fill a physical gap using another configured floor, ordinary ground or a lower layer', () => {
  for (const other of ['ground:0', 'protected:lower:1']) {
    const faces = floor({ gap: true }),
      lower = floor({ group: other, yOffset: other === 'ground:0' ? 0 : -2 });
    const w = world([...faces, ...lower], [group, other]);
    try {
      assert.equal(fit(w), null);
    } finally {
      w.dispose();
    }
  }
});
test('wheel suspension cannot hover above the protected road or ignore a body-side obstacle', () => {
  const faces = floor(),
    w = world(faces);
  try {
    assert.equal(
      w.support({
        pose: { position: [0, height + 0.2, 0], quaternion: [0, 0, 0, 1] },
        shape,
        maxDistance: height + 0.35,
        adhesion: false,
      }),
      null,
    );
  } finally {
    w.dispose();
  }
  const wall = triangleFace(
      'side-solid',
      'side-solid',
      'obstacle',
      [
        [1, 0.1, -5],
        [1, 3, -5],
        [1, 3, 5],
      ],
      false,
      'obstacle',
      [-1, 0, 0],
    ),
    blocked = world([...faces, wall]);
  try {
    assert.equal(fit(blocked), null);
  } finally {
    blocked.dispose();
  }
});
test('configured groups do not change legacy body-only shapes or combine unrelated road groups', () => {
  const w = world(floor());
  try {
    const legacy = {
      halfExtents: shape.halfExtents,
      clearance: shape.clearance,
    };
    assert.equal(
      w.fitGround({
        pose: { position: [0, height, 0], quaternion: [0, 0, 0, 1] },
        shape: legacy,
        preferredSurfaceId: `${group}:0:0`,
        maxAdjustmentM: 0.35,
      }),
      null,
    );
    assert.equal(
      w.support({
        pose: { position: [0, height, 0], quaternion: [0, 0, 0, 1] },
        shape: legacy,
        maxDistance: height + 0.35,
        adhesion: false,
      }),
      null,
    );
  } finally {
    w.dispose();
  }
});

const { teslaRoadSeamConnections } = await import(
  cityModule('tesla-city-world')
);
const seam = {
  groups: ['ground:0', group],
  a: [-4, 0],
  b: [4, 0],
  drive: true,
  heightDeltaM: 0,
  maxSeamStep: 0.025,
};
const neutral = { position: [0, height, 0], quaternion: [0, 0, 0, 1] };
test('a source seam authorizes peers only while actual tyres straddle its finite driveable, height-continuous gate', () => {
  assert.deepEqual(teslaRoadSeamConnections(neutral, shape, [seam]), [
    seam.groups,
  ]);
  for (const [description, pose, source] of [
    ['before tyre crossing', { ...neutral, position: [0, height, -3] }, seam],
    ['beyond finite gate', { ...neutral, position: [7, height, 0] }, seam],
    ['closed mode', neutral, { ...seam, drive: false }],
    ['height discontinuity', neutral, { ...seam, heightDeltaM: 0.026 }],
    ['invalid seam', neutral, { ...seam, maxSeamStep: NaN }],
  ])
    assert.deepEqual(
      teslaRoadSeamConnections(pose, shape, [source]),
      [],
      description,
    );
  assert.deepEqual(
    teslaRoadSeamConnections(
      neutral,
      shape,
      Array.from({ length: 17 }, () => seam),
    ),
    [],
  );
});
function splitFloor({ missing = false, lower = false } = {}) {
  const faces = floor();
  for (const face of faces) {
    const z = face.triangle[0][2];
    if (z < 0) face.supportGroup = 'ground:0';
  }
  if (missing) return faces.filter((f) => f.triangle[0][2] !== 0);
  if (lower)
    for (const face of faces)
      if (face.supportGroup === group) {
        face.supportGroup = 'protected:lower:1';
        face.triangle = face.triangle.map((p) => [p[0], p[1] - 2, p[2]]);
      }
  return faces;
}
test('bounded gate-local peers bridge the real wheel footprint without permanently merging road identities', () => {
  const w = new TeslaWorld({
    sources: [fixedFacesSource('two-source-floors', splitFloor())],
    modelGroundGroups: [group],
    modelGroundConnections: (pose, shape) =>
      teslaRoadSeamConnections(pose, shape, [seam]),
  });
  try {
    const fitted = fit(w);
    assert.ok(fitted);
    assert.equal(fitted.contact.kind, 'ground');
    assert.equal(
      w.sweep({
        from: fitted.pose,
        to: fitted.pose,
        shape,
        ignoreSurfaceId: fitted.contact.surfaceId,
      }),
      null,
    );
  } finally {
    w.dispose();
  }
  for (const variant of ['closed', 'hole', 'lower', 'overloaded']) {
    const w = new TeslaWorld({
      sources: [
        fixedFacesSource(
          'two-source-floors',
          splitFloor({
            missing: variant === 'hole',
            lower: variant === 'lower',
          }),
        ),
      ],
      modelGroundGroups: [group],
      modelGroundConnections: (pose, shape) =>
        variant === 'overloaded'
          ? Array.from({ length: 5 }, () => seam.groups)
          : teslaRoadSeamConnections(pose, shape, [
              { ...seam, drive: variant !== 'closed' },
            ]),
    });
    try {
      assert.equal(fit(w), null, variant);
    } finally {
      w.dispose();
    }
  }
});

test('an explicit ground-entry seam can prove a legacy road locally without configuring its entire protected group', () => {
  const legacy = 'protected:lions:road:1',
    faces = splitFloor();
  for (const face of faces)
    if (face.supportGroup === group) face.supportGroup = legacy;
  const exact = { ...seam, groups: ['ground:0', legacy] };
  const w = new TeslaWorld({
    sources: [fixedFacesSource('actual-ground-entry', faces)],
    modelGroundConnections: (pose, shape) =>
      teslaRoadSeamConnections(pose, shape, [exact]),
  });
  try {
    const fitted = w.fitGround({
      pose: neutral,
      shape,
      preferredSurfaceId: `${group}:0:0`,
      maxAdjustmentM: 0.35,
    });
    assert.ok(fitted);
    assert.equal(
      w.sweep({
        from: fitted.pose,
        to: fitted.pose,
        shape,
        ignoreSurfaceId: fitted.contact.surfaceId,
      }),
      null,
    );
    assert.equal(
      w.fitGround({
        pose: { ...neutral, position: [0, height + 0.004 * 25, 5] },
        shape,
        preferredSurfaceId: `${group}:5:0`,
        maxAdjustmentM: 0.35,
      }),
      null,
      'legacy group remains strict beyond this exact seam',
    );
  } finally {
    w.dispose();
  }
});

const { teslaRoadOverlapConnections } = await import(
  cityModule('tesla-city-world')
);
test('source-owned shared paving proves local body overlap after leaving its graph node, without accepting a raised or missing floor', () => {
  const source = {
    groups: ['protected:source-entry:1', group],
    center: [0, 0],
    radiusM: 12,
    maxSeamStepM: 0.025,
    floor: () => 0,
  };
  const body = { ...neutral, position: [0, height, 6] };
  assert.deepEqual(teslaRoadOverlapConnections(body, shape, [source]), [
    source.groups,
  ]);
  for (const variant of ['raised', 'missing', 'outside', 'overloaded']) {
    const overlap = {
      ...source,
      floor: (g) =>
        variant === 'missing'
          ? undefined
          : variant === 'raised' && g === group
            ? 0.026
            : 0,
    };
    assert.deepEqual(
      teslaRoadOverlapConnections(
        variant === 'outside' ? { ...body, position: [30, height, 6] } : body,
        shape,
        variant === 'overloaded'
          ? Array.from({ length: 9 }, () => overlap)
          : [overlap],
      ),
      [],
      variant,
    );
  }
});
test('a gate-local physical peer never excludes body-side solids from the complete car sweep', () => {
  const wall = triangleFace(
    'junction-side-solid',
    'junction-side-solid',
    'obstacle',
    [
      [1, 0.1, -5],
      [1, 3, -5],
      [1, 3, 5],
    ],
    false,
    'solid',
    [-1, 0, 0],
  );
  const w = new TeslaWorld({
    sources: [fixedFacesSource('junction', [...splitFloor(), wall])],
    modelGroundGroups: [group],
    modelGroundConnections: (pose, shape) =>
      teslaRoadSeamConnections(pose, shape, [seam]),
  });
  try {
    assert.equal(fit(w), null);
  } finally {
    w.dispose();
  }
});

// Keep the actual emitted Float32 coordinates: rounding a skinny triangle is
// enough to hide the source-face-normal disagreement that stopped this car.
test('actual skinny South paving retains physical union; raised adjacent paving and a true strip stay unsupported', () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      new URL('./fixtures/tesla-south-model-paving.json', import.meta.url),
      'utf8',
    ),
  );
  const convert = (faces) =>
    faces.map((f) =>
      triangleFace(f.id, f.id, 'ground', f.tri, true, 'ground:0'),
    );
  function clip(vertices, z, above) {
    const result = [];
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i],
        b = vertices[(i + 1) % vertices.length],
        aa = above ? a[2] >= z : a[2] <= z,
        bb = above ? b[2] >= z : b[2] <= z;
      if (aa) result.push(a);
      if (aa !== bb) {
        const t = (z - a[2]) / (b[2] - a[2]);
        result.push(a.map((v, n) => v + (b[n] - v) * t));
      }
    }
    return result;
  }
  for (const mode of ['physical', 'raised', 'missing-strip']) {
    const faces = structuredClone(fixture.faces).flatMap((face) => {
      if (mode === 'raised' && face.id.startsWith('ground:asphalt:102:'))
        face.tri.forEach((p) => (p[1] += 0.5));
      if (mode !== 'missing-strip') return [face];
      return [
        clip(face.tri, -1140.2 - 0.01, false),
        clip(face.tri, -1140.2 + 0.01, true),
      ].flatMap((polygon, side) =>
        polygon.slice(1, -1).map((_, n) => ({
          ...face,
          id: `${face.id}:clip:${side}:${n}`,
          tri: [polygon[0], polygon[n + 1], polygon[n + 2]],
        })),
      );
    });
    const w = world(convert(faces), []);
    try {
      const preferred = faces.find((f) =>
        f.id.startsWith(fixture.preferredSurfaceId),
      )?.id;
      const proof = w.support({
        pose: fixture.pose,
        shape: fixture.shape,
        maxDistance: 1,
        preferredSurfaceId: preferred,
        adhesion: false,
      });
      assert.equal(!!proof, mode === 'physical', mode);
      if (proof)
        assert.equal(
          w.sweep({
            from: fixture.from,
            to: fixture.pose,
            shape: fixture.shape,
            ignoreSurfaceId: proof.surfaceId,
          }),
          null,
        );
    } finally {
      w.dispose();
    }
  }
});

test('source-owned slab caps use the real body only with complete upper-road support; air, lower layers and missing wheels keep the hull', () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      new URL('./fixtures/tesla-south-model-paving.json', import.meta.url),
      'utf8',
    ),
  );
  const car = fixture.shape,
    h = car.halfExtents[1] + car.clearance;
  function quad(x0, x1, z0, z1, id, owner = group) {
    const v = [
      [x0, 0, z0],
      [x0, 0, z1],
      [x1, 0, z1],
      [x1, 0, z0],
    ];
    return [
      [0, 1, 2],
      [0, 2, 3],
    ].map((indices, i) =>
      triangleFace(
        `${id}:${i}`,
        `${id}:${i}`,
        'ground',
        indices.map((n) => v[n]),
        true,
        owner,
      ),
    );
  }
  const cap = [
    [
      [-4, -0.5, 0],
      [4, 0.02, 0],
      [-4, 0.02, 0],
    ],
    [
      [-4, -0.5, 0],
      [4, -0.5, 0],
      [4, 0.02, 0],
    ],
  ].map((vertices, i) =>
    triangleFace(
      `slab-cap:${i}`,
      `slab-cap:${i}`,
      'ground',
      vertices,
      false,
      group,
    ),
  );
  const from = { position: [0, h, -2.5], quaternion: [0, 0, 0, 1] },
    to = { ...from, position: [0, h, -2.3] };
  for (const mode of ['upper', 'no-contact', 'lower', 'missing-wheel']) {
    const floors =
      mode === 'missing-wheel'
        ? [
            ...quad(-4, 0.65, -10, 10, 'left'),
            ...quad(1.15, 4, -10, 10, 'right'),
            ...quad(0.65, 1.15, -10, -1.2, 'back'),
            ...quad(0.65, 1.15, -0.45, 10, 'front'),
          ]
        : quad(
            -4,
            4,
            -10,
            10,
            'floor',
            mode === 'lower' ? 'protected:lower:1' : group,
          );
    const w = world([...floors, ...cap], [group, 'protected:lower:1']);
    try {
      const support = w.support({
        pose: from,
        shape: car,
        maxDistance: h + 0.2,
        adhesion: false,
      });
      if (mode === 'missing-wheel') assert.equal(support, null);
      assert.equal(
        !!w.sweep({
          from,
          to,
          shape: car,
          ignoreSurfaceId:
            mode === 'no-contact' ? undefined : support?.surfaceId,
        }),
        mode !== 'upper',
        mode,
      );
      assert.notEqual(support?.surfaceId.startsWith('slab-cap:'), true);
    } finally {
      w.dispose();
    }
  }
});

test('a thin real seam cap can authorize a physical peer at the bumper without widening height or inventing paving', () => {
  const source = {
    groups: ['ground:0', group],
    center: [0, 0],
    radiusM: 3.5,
    maxSeamStepM: 0.025,
    seam: { a: [-3, 0], b: [3, 0], stripHalfWidthM: 0.04 },
    floor: (_g, x, z) =>
      Math.abs(z) <= 0.04 && Math.abs(x) <= 3 ? 0 : undefined,
  };
  const pose = {
    position: [0, height, -shape.halfExtents[2] - 0.03],
    quaternion: [0, 0, 0, 1],
  };
  assert.deepEqual(teslaRoadOverlapConnections(pose, shape, [source]), [
    source.groups,
  ]);
  assert.deepEqual(
    teslaRoadOverlapConnections(
      { ...pose, position: [0, height, -shape.halfExtents[2] - 0.3] },
      shape,
      [source],
    ),
    [],
  );
  assert.deepEqual(
    teslaRoadOverlapConnections(pose, shape, [
      {
        ...source,
        floor: (g, x, z) => (g === group ? 0.026 : source.floor(g, x, z)),
      },
    ]),
    [],
  );
  assert.deepEqual(
    teslaRoadOverlapConnections(pose, shape, [
      { ...source, floor: () => undefined },
    ]),
    [],
  );
});

test('actual source triangle edges catch a diagonal bumper overlap between grid probes, with finite geometry and bounded work', () => {
  const vertices = [
      [0.95, 2.3],
      [1.2, 2.3],
      [0.95, 2.4],
    ],
    edges = vertices.map((a, i) => ({ a, b: vertices[(i + 1) % 3] })),
    inside = (x, z) =>
      x >= 0.95 && z >= 2.3 && (x - 0.95) / 0.25 + (z - 2.3) / 0.1 <= 1 + 1e-10,
    source = {
      groups: ['ground:0', group],
      center: [1, 2.3],
      radiusM: 3,
      maxSeamStepM: 0.025,
      edges: () => edges,
      floor: (_g, x, z) => (inside(x, z) ? 0 : undefined),
    },
    pose = { position: [0, height, 0], quaternion: [0, 0, 0, 1] };
  assert.deepEqual(
    teslaRoadOverlapConnections(pose, shape, [{ ...source, edges: undefined }]),
    [],
  );
  assert.deepEqual(teslaRoadOverlapConnections(pose, shape, [source]), [
    source.groups,
  ]);
  for (const changed of [
    {
      ...source,
      floor: (g, x, z) =>
        inside(x, z) ? (g === group ? 0.026 : 0) : undefined,
    },
    { ...source, floor: () => undefined },
    { ...source, edges: () => Array.from({ length: 1025 }, () => edges[0]) },
    { ...source, edges: () => [{ a: [NaN, 0], b: [1, 0] }] },
    { ...source, edges: () => [{ a: [20, 20], b: [21, 20] }] },
  ])
    assert.deepEqual(teslaRoadOverlapConnections(pose, shape, [changed]), []);
});

test('a nonadherable road slab mesh keeps its real downward underside normal and remains solid to an airborne hull', async () => {
  const { teslaMeshSource } = await import(cityModule('tesla-city-world'));
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 8));
  mesh.position.y = 1.5;
  mesh.userData.prospectSlab = true;
  const w = new TeslaWorld({
    sources: [teslaMeshSource(mesh, 'source-slab', 'ground', false, group)],
    modelGroundGroups: [group],
  });
  try {
    const hit = w.sweep({
      from: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      to: { position: [0, 2, 0], quaternion: [0, 0, 0, 1] },
      shape,
    });
    assert.ok(hit);
    assert.ok(hit.normal[1] < -0.99);
    assert.equal(
      w.support({
        pose: { position: [0, 3, 0], quaternion: [0, 0, 0, 1] },
        shape,
        maxDistance: 4,
        adhesion: false,
      }),
      null,
    );
  } finally {
    w.dispose();
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});

test('complete mild convex paving can replace an expired contact at its real triangle edge; missing wheels and a 2cm gap remain unsupported', () => {
  const car = JSON.parse(
      fs.readFileSync(
        new URL('./fixtures/tesla-south-model-paving.json', import.meta.url),
        'utf8',
      ),
    ).shape,
    h = car.halfExtents[1] + car.clearance - 0.05 * 0.896;
  function patch(x0, x1, z0, z1, id) {
    const y = (x) => -0.05 * Math.abs(x),
      v = [
        [x0, y(x0), z0],
        [x0, y(x0), z1],
        [x1, y(x1), z1],
        [x1, y(x1), z0],
      ];
    return [
      [0, 1, 2],
      [0, 2, 3],
    ].map((indices, i) =>
      triangleFace(
        `${id}:${i}`,
        `${id}:${i}`,
        'ground',
        indices.map((n) => v[n]),
        true,
        group,
      ),
    );
  }
  const from = { position: [0, h, 0], quaternion: [0, 0, 0, 1] },
    to = { ...from, position: [0, h, 0.1] };
  for (const mode of ['physical', 'missing-wheel', 'missing-strip']) {
    const faces = [];
    for (const side of [
      [-4, 0, 'left'],
      [0, 4, 'right'],
    ]) {
      if (mode === 'missing-wheel' && side[2] === 'right') continue;
      const spans =
        mode === 'missing-strip'
          ? [
              [-10, -2.69],
              [-2.69, -0.01],
              [0.01, 10],
            ]
          : [
              [-10, -2.69],
              [-2.69, 10],
            ];
      spans.forEach(([a, b], n) =>
        faces.push(...patch(side[0], side[1], a, b, `${side[2]}:${n}`)),
      );
    }
    const w = world(faces);
    try {
      const proof = w.support({
        pose: to,
        shape: car,
        maxDistance: 1,
        preferredSurfaceId: 'left:0:0',
        adhesion: false,
      });
      assert.equal(!!proof, mode === 'physical', mode);
      if (proof)
        assert.equal(
          w.sweep({ from, to, shape: car, ignoreSurfaceId: 'left:0:0' }),
          null,
        );
    } finally {
      w.dispose();
    }
  }
});
