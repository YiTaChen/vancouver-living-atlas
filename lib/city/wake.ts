import * as THREE from 'three';
export function makeWake(length = 26, beam = 2.4) {
  const positions: number[] = [],
    fade: number[] = [];
  for (const side of [-1, 1]) {
    const points = [
      [side * beam * 0.42, 0, 0],
      [side * (beam * 0.5 + length * 0.23), 0, -length],
      [side * (beam * 0.5 + length * 0.12), 0, -length],
      [side * beam * 0.42, 0, 0],
      [side * (beam * 0.5 + length * 0.12), 0, -length],
      [side * beam * 0.22, 0, 0],
    ];
    points.forEach((p, i) => {
      positions.push(...p);
      fade.push(i === 0 || i === 3 || i === 5 ? 0.85 : 0);
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('wakeFade', new THREE.Float32BufferAttribute(fade, 1));
  const material = new THREE.MeshBasicMaterial({
    color: 0xe2f6ee,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (s) => {
    s.vertexShader =
      'attribute float wakeFade;varying float vWakeFade;\n' + s.vertexShader;
    s.vertexShader = s.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvWakeFade=wakeFade;',
    );
    s.fragmentShader = 'varying float vWakeFade;\n' + s.fragmentShader;
    s.fragmentShader = s.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.a*=vWakeFade;',
    );
  };
  material.customProgramCacheKey = () => 'harbour-wake-1';
  return new THREE.Mesh(geometry, material);
}
