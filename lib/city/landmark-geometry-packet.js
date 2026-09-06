// Portable proof: no DOM, renderer, engine or Node APIs. Pass the Three namespace.
// Supports only the actual current landmark shape, not arbitrary Three scenes.
export function packLandmark(THREE, group) {
  const materials = [],
    materialIds = new Map(),
    geometries = [],
    geometryIds = new Map(),
    buffers = new Set();
  const materialId = (m) => {
    if (materialIds.has(m)) return materialIds.get(m);
    if (!m.isMeshStandardMaterial)
      throw Error('Unsupported material ' + m.type);
    for (const value of Object.values(m))
      if (value?.isTexture)
        throw Error('Texture requires explicit asset-ID handling');
    const shader = m.userData.sciencePaint
      ? 'science-red-v1'
      : m.userData.canadaMembrane
        ? 'canada-membrane-v1'
        : null;
    if (
      m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile &&
      !shader
    )
      throw Error('Unknown custom material shader');
    const id = materials.length;
    materialIds.set(m, id);
    materials.push({
      json: m.toJSON(),
      color: m.color.toArray(),
      emissive: m.emissive.toArray(),
      shader,
    });
    return id;
  };
  // Preserve material identity in nightMaterials without copying Three classes.
  const data = (value) => {
    if (
      value === null ||
      value === undefined ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    )
      return value;
    if (value?.isMaterial) return { __landmarkMaterial: materialId(value) };
    if (typeof value === 'function')
      throw Error('Functions cannot cross the worker boundary');
    if (Array.isArray(value)) return value.map(data);
    if (Object.getPrototypeOf(value) !== Object.prototype)
      throw Error('Unexpected metadata class');
    return Object.fromEntries(
      Object.entries(value).map(([key, value]) => [key, data(value)]),
    );
  };
  const attribute = (a) => {
    if (a.isInterleavedBufferAttribute || a.isInstancedBufferAttribute)
      throw Error('Unsupported landmark attribute layout');
    if (!(a.array.buffer instanceof ArrayBuffer))
      throw Error('Expected transferable ArrayBuffer');
    buffers.add(a.array.buffer);
    return {
      array: a.array,
      itemSize: a.itemSize,
      normalized: a.normalized,
      usage: a.usage,
      gpuType: a.gpuType,
      name: a.name,
    };
  };
  const geometryId = (g) => {
    if (geometryIds.has(g)) return geometryIds.get(g);
    if (Object.keys(g.morphAttributes).length)
      throw Error('Morph geometry needs another protocol');
    const id = geometries.length;
    geometryIds.set(g, id);
    geometries.push({
      name: g.name,
      attributes: Object.fromEntries(
        Object.entries(g.attributes).map(([k, a]) => [k, attribute(a)]),
      ),
      index: g.index ? attribute(g.index) : null,
      groups: g.groups.map((x) => ({ ...x })),
      drawRange: { ...g.drawRange },
      userData: data(g.userData),
      boundingBox: g.boundingBox
        ? { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() }
        : null,
      boundingSphere: g.boundingSphere
        ? {
            center: g.boundingSphere.center.toArray(),
            radius: g.boundingSphere.radius,
          }
        : null,
    });
    return id;
  };
  const node = (o) => {
    if (!o.isGroup && (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh))
      throw Error('Unsupported landmark object ' + o.type);
    if (o.customDepthMaterial || o.customDistanceMaterial)
      throw Error('Explicit depth shader contract required');
    o.updateMatrix();
    return {
      type: o.isMesh ? 'Mesh' : 'Group',
      name: o.name,
      matrix: o.matrix.toArray(),
      matrixAutoUpdate: o.matrixAutoUpdate,
      visible: o.visible,
      castShadow: o.castShadow,
      receiveShadow: o.receiveShadow,
      frustumCulled: o.frustumCulled,
      renderOrder: o.renderOrder,
      layers: o.layers.mask,
      geometry: o.isMesh ? geometryId(o.geometry) : null,
      material: o.isMesh
        ? Array.isArray(o.material)
          ? o.material.map(materialId)
          : materialId(o.material)
        : null,
      userData: data(o.userData),
      children: o.children.map(node),
    };
  };
  const root = node(group),
    transfer = [...buffers];
  return {
    packet: { version: 1, root, materials, geometries },
    transfer,
    bytes: transfer.reduce((n, b) => n + b.byteLength, 0),
  };
}

export function unpackLandmark(THREE, packet, shaderRegistry = {}) {
  if (packet.version !== 1) throw Error('Unsupported landmark packet version');
  const loader = new THREE.MaterialLoader();
  const materials = packet.materials.map((p) => {
    const m = loader.parse(p.json);
    m.color.fromArray(p.color);
    m.emissive.fromArray(p.emissive);
    if (p.shader) {
      if (!shaderRegistry[p.shader]) throw Error('Missing shader ' + p.shader);
      shaderRegistry[p.shader](m);
    }
    return m;
  });
  const data = (value) => {
    if (value === null || value === undefined || typeof value !== 'object')
      return value;
    if (Object.hasOwn(value, '__landmarkMaterial'))
      return materials[value.__landmarkMaterial];
    return Array.isArray(value)
      ? value.map(data)
      : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, data(v)]));
  };
  const attribute = (p) => {
    const a = new THREE.BufferAttribute(p.array, p.itemSize, p.normalized);
    a.usage = p.usage;
    a.gpuType = p.gpuType;
    a.name = p.name;
    return a;
  };
  const geometries = packet.geometries.map((p) => {
    const g = new THREE.BufferGeometry();
    g.name = p.name;
    for (const [name, a] of Object.entries(p.attributes))
      g.setAttribute(name, attribute(a));
    if (p.index) g.setIndex(attribute(p.index));
    for (const q of p.groups) g.addGroup(q.start, q.count, q.materialIndex);
    g.setDrawRange(p.drawRange.start, p.drawRange.count);
    g.userData = data(p.userData);
    if (p.boundingBox)
      g.boundingBox = new THREE.Box3(
        new THREE.Vector3().fromArray(p.boundingBox.min),
        new THREE.Vector3().fromArray(p.boundingBox.max),
      );
    if (p.boundingSphere)
      g.boundingSphere = new THREE.Sphere(
        new THREE.Vector3().fromArray(p.boundingSphere.center),
        p.boundingSphere.radius,
      );
    return g;
  });
  const node = (p) => {
    const m = Array.isArray(p.material)
      ? p.material.map((i) => materials[i])
      : materials[p.material];
    const o =
      p.type === 'Mesh'
        ? new THREE.Mesh(geometries[p.geometry], m)
        : new THREE.Group();
    o.name = p.name;
    o.matrix.fromArray(p.matrix);
    o.matrix.decompose(o.position, o.quaternion, o.scale);
    o.matrixAutoUpdate = p.matrixAutoUpdate;
    for (const k of [
      'visible',
      'castShadow',
      'receiveShadow',
      'frustumCulled',
      'renderOrder',
    ])
      o[k] = p[k];
    o.layers.mask = p.layers;
    o.userData = data(p.userData);
    for (const child of p.children) o.add(node(child));
    return o;
  };
  return node(packet.root);
}
