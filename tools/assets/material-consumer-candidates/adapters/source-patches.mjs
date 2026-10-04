/** Reviewed SOURCE-CALL-SITE semantics, never mesh colour/size classification.
 * Transform is applied in memory by harness.mjs. No runtime file is written.
 * Each replacement is fail-closed; fixture source hashes guard upstream drift.
 */
function replace(s, before, after, expected = 1) {
  const count = s.split(before).length - 1;
  if (count !== expected) throw new Error(`Source anchor changed (${count}/${expected}): ${before.slice(0,90)}`);
  return s.split(before).join(after);
}
export function roadsterPatch(s, uvURL) {
  s = `import { metreUV } from '${uvURL}';\n` + s;
  s = replace(s, "  type Key = keyof typeof palette;", `  const rolePalette = {
    ...palette, 'body-paint': palette.paint, 'seat-upholstery': palette.dark.clone(),
    'driver-skin': palette.leather, 'driver-clothing': palette.dark.clone(),
    'tire-rubber': palette.rubber,
  };
  type Key = keyof typeof rolePalette;`);
  s = replace(s, "flat.deleteAttribute('uv');", "metreUV(flat);");
  // The semantic seat scope is bounded by actual author comments and callsites.
  const a = s.indexOf("  for (const x of [-0.44, 0.44]) {\n    oval('dark'"),
    b = s.indexOf('    // Polished rollover hoop', a);
  if (a < 0 || b < 0) throw new Error('Seat authoring scope missing');
  s = s.slice(0,a) + s.slice(a,b).replaceAll("'dark'", "'seat-upholstery'") + s.slice(b);
  s = replace(s, "add('leather', new THREE.SphereGeometry(0.115, 12, 10)", "add('driver-skin', new THREE.SphereGeometry(0.115, 12, 10)");
  s = replace(s, "box('dark', [0.34, 0.44, 0.2], [0.44, 0.93, -0.39]", "box('driver-clothing', [0.34, 0.44, 0.2], [0.44, 0.93, -0.39]");
  s = replace(s, "beam('dark', [x, 1.06, -0.29], [x, 0.88, 0.29], 0.047)", "beam('driver-clothing', [x, 1.06, -0.29], [x, 0.88, 0.29], 0.047)");
  s = replace(s, 'new THREE.Mesh(geometry, palette[key])', 'new THREE.Mesh(geometry, rolePalette[key])');
  s = replace(s, '    group.add(mesh);\n  }\n  const wheels', `    mesh.userData.semanticRole = key === 'paint' ? 'body-paint' : key;
    group.add(mesh);
  }
  const wheels`);
  s = replace(s, '      tyre.rotation.z = Math.PI / 2;', `      const indexedTyre = tyre.geometry;
      tyre.geometry = metreUV(indexedTyre); indexedTyre.dispose();
      tyre.name = 'roadster/tire-rubber'; tyre.userData.semanticRole = 'tire-rubber';
      tyre.rotation.z = Math.PI / 2;`);
  return s;
}
export function interiorPatch(s, uvURL) {
  s = `import { metreUV } from '${uvURL}';\n` + s;
  s = replace(s, "flat.deleteAttribute('uv');", "metreUV(flat, key.startsWith('floor') ? 'floor' : 'triangle');");
  // Explicit method arguments allow every future component to declare its role.
  s = replace(s, 'cylinder(radius: number, height: number, p: P, color: number)', "cylinder(radius: number, height: number, p: P, color: number, role = 'structure')");
  s = replace(s, "      'structure',\n      new THREE.CylinderGeometry(radius, radius, height, 16)", "      role,\n      new THREE.CylinderGeometry(radius, radius, height, 16)");
  s = replace(s, '    color: number,\n  ) {\n    // Split at circulation', "    color: number,\n    role = 'floor-terrazzo',\n  ) {\n    // Split at circulation");
  s = replace(s, 'this.floor(clip(-1), y, color);', 'this.floor(clip(-1), y, color, role);');
  s = replace(s, 'this.floor(clip(1), y, color);', 'this.floor(clip(1), y, color, role);');
  s = replace(s, "this.add('floor', g, color);", "this.add(role, g, color);");
  s = replace(s, "mesh.userData.walkSurface = key === 'floor';", "mesh.userData.walkSurface = key.startsWith('floor');\n      mesh.userData.semanticRole = key;");
  s = replace(s, "parts.add('floor', rampG, 0xbcbbaa);", "parts.add('floor-terrazzo', rampG, 0xbcbbaa);");
  s = replace(s, '      color: number,\n    ) => {\n      parts.box([w, h, d], [x, f + h / 2, z], color);', "      color: number,\n      role = 'structure',\n    ) => {\n      parts.box([w, h, d], [x, f + h / 2, z], color, role);");
  s = replace(s, 'obstacle(x, z, w, 0.7, 0.48, 0x8d6e4e);', "obstacle(x, z, w, 0.7, 0.48, 0x8d6e4e, 'wood');");
  s = replace(s, 'parts.box([w, 0.55, 0.12], [x, f + 0.78, z - 0.32], 0x8d6e4e);', "parts.box([w, 0.55, 0.12], [x, f + 0.78, z - 0.32], 0x8d6e4e, 'wood');");
  for (const call of [
    'parts.cylinder(0.42, 9, [x, f + 4.5, z], cream)',
    'parts.cylinder(0.55, 12, [x, f + 6, z], cream)',
    'parts.cylinder(0.48, 7.5, [x, f + 3.75, z], cream)',
  ]) s = replace(s, call, call.slice(0,-1) + ", 'plaster')");
  s = replace(s, 'obstacle(8, z, 44, 0.3, 5.5, 0xe5dfd0);', "obstacle(8, z, 44, 0.3, 5.5, 0xe5dfd0, 'plaster');");
  for (const offset of ['- 0.22', '+ 0.22']) {
    const old = `p.box([2.8, 4.6, 0.12], [x, f + 2.4, z ${offset}], wood);`;
    s = replace(s, old, old.slice(0,-2) + ", 'wood');");
  }
  // Carpet, safety stripe and structural underside explicitly keep legacy roles.
  s = replace(s, 'e.floor(q, (x, z) => h(x, z) - 0.25, 0x607c81);', "e.floor(q, (x, z) => h(x, z) - 0.25, 0x607c81, 'floor-substructure');");
  s = replace(s, 'p.floor(rect(35, -241, 35, 0.18), f + 0.015, 0xe0bd50);', "p.floor(rect(35, -241, 35, 0.18), f + 0.015, 0xe0bd50, 'floor');");
  s = replace(s, '[0x587e88, 0x416879, 0x759295][Math.floor(tone)],', "[0x587e88, 0x416879, 0x759295][Math.floor(tone)],\n          'floor',");
  s = replace(s, 'p.floor(rect(x + 1.5, z + 1.5, 0.12, 2.9), f + 0.012, 0x91a9a9);', "p.floor(rect(x + 1.5, z + 1.5, 0.12, 2.9), f + 0.012, 0x91a9a9, 'floor');");
  return s;
}
