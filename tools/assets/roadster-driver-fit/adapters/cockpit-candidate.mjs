/** Version 1.0.0, OFFLINE OPT-IN. Exact source-callsite identity, never size/color guessing.
 * The original constructor, materials-only E02 adapter, navigation and public assets
 * remain read-only. Replacement GLB is an explicit argument; no runtime loader/install.
 */
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { roadsterPatch } from '../../material-consumer-candidates/adapters/source-patches.mjs';
import { metreUV } from '../../material-consumer-candidates/adapters/metre-uv.mjs';
import { describeBindings, bindCandidateMaps } from '../../material-consumer-candidates/adapters/consumer-candidates.mjs';
export const ROOT = new URL('../../../../', import.meta.url);
export const PACKAGE = new URL('../', import.meta.url);
export const SOURCE_SHA256 = 'e3e25bba28d32df58cbd1b26c66fb5b7657eb04bd4ab9688156d770eb58436f0';
export const SUPPRESSED = ['dashboard', 'steering-rim', 'steering-spoke-horizontal', 'steering-spoke-lower', 'legacy-driver-torso', 'legacy-driver-head', 'legacy-driver-arm', 'driver-seat-cushion', 'driver-seat-back', 'driver-seat-headrest', 'driver-seat-bolster', 'driver-seat-seam'];
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function replace(s, a, b, n = 1) { if (s.split(a).length - 1 !== n)
    throw Error(`Reviewed callsite drift: ${a}`); return s.split(a).join(b); }
export function patchSource(source, { suppress = false, materialCandidate = false } = {}) {
    if (sha(source) !== SOURCE_SHA256)
        throw Error('Unreviewed Roadster source SHA-256');
    let s = materialCandidate ? roadsterPatch(source, new URL('../../material-consumer-candidates/adapters/metre-uv.mjs', import.meta.url).href) : source;
    const labels = [
        ["box('dark', [1.48, 0.1, 3.95], [0, 0.26, 0]);", 'underbody'],
        ["box('dark', [1.4, 0.09, 1.55], [0, 0.43, -0.14]);", 'cabin-floor'],
        ["oval('dark', [0.275, 0.085, 0.32], [x, 0.53, -0.21]);", 'seat-cushion'],
        ["oval('dark', [0.275, 0.33, 0.09], [x, 0.86, -0.57], [-0.14, 0, 0]);", 'seat-back'],
        ["oval('dark', [0.15, 0.11, 0.085], [x, 1.17, -0.62]);", 'seat-headrest'],
        ["box('dark', [0.2, 0.32, 1.1], [0, 0.62, -0.02]);", 'center-console'],
        ["box('dark', [1.57, 0.18, 0.33], [0, 0.8, 0.61]);", 'dashboard'],
        ["add(\n    'dark',\n    new THREE.TorusGeometry(0.16, 0.019, 8, 20),", 'steering-rim'],
        ["beam('metal', [0.3, 0.88, 0.4], [0.58, 0.88, 0.4], 0.013);", 'steering-spoke-horizontal'],
        ["beam('metal', [0.44, 0.88, 0.4], [0.44, 0.73, 0.44], 0.013);", 'steering-spoke-lower'],
        ["box('dark', [0.34, 0.44, 0.2], [0.44, 0.93, -0.39], [-0.1, 0, 0]);", 'legacy-driver-torso'],
        ["add('leather', new THREE.SphereGeometry(0.115, 12, 10), [0.44, 1.27, -0.34]);", 'legacy-driver-head'],
    ];
    for (const [original, label] of labels) {
        let a = original;
        if (materialCandidate) {
            if (label.startsWith('seat-'))
                a = a.replace("'dark'", "'seat-upholstery'");
            if (label === 'legacy-driver-torso')
                a = a.replace("'dark'", "'driver-clothing'");
            if (label === 'legacy-driver-head')
                a = a.replace("'leather'", "'driver-skin'");
        }
        s = replace(s, a, `labelNext = ${label.startsWith('seat-') ? `x > 0 ? 'driver-${label}' : 'passenger-${label}'` : `'${label}'`};\n  ${a}`);
    }
    // Loop must remain one statement, since the original has no braces.
    s = replace(s, `    beam('${materialCandidate ? 'driver-clothing' : 'dark'}', [x, 1.06, -0.29], [x, 0.88, 0.29], 0.047);`, `    { labelNext = 'legacy-driver-arm'; beam('${materialCandidate ? 'driver-clothing' : 'dark'}', [x, 1.06, -0.29], [x, 0.88, 0.29], 0.047); }`);
    const seatKey = materialCandidate ? 'seat-upholstery' : 'dark';
    const bolster = `    for (const side of [-1, 1])\n      box(\n        '${seatKey}',\n        [0.055, 0.4, 0.18],\n        [x + side * 0.255, 0.86, -0.45],\n        [-0.14, 0, 0],\n      );`;
    s = replace(s, bolster, bolster.replace(`    for (const side of [-1, 1])`, `    for (const side of [-1, 1]) { labelNext = x > 0 ? 'driver-seat-bolster' : 'passenger-seat-bolster';`) + ` }`);
    const seams = `    for (const z of [-0.36, -0.19, -0.02])\n      box('${seatKey}', [0.41, 0.005, 0.008], [x, 0.618, z]);`;
    s = replace(s, seams, seams.replace(`    for (const z of [-0.36, -0.19, -0.02])`, `    for (const z of [-0.36, -0.19, -0.02]) { labelNext = x > 0 ? 'driver-seat-seam' : 'passenger-seat-seam';`) + ` }`);
    // Do not place a label inside a brace-less loop body as a second statement.
    s = replace(s, '  const batches = new Map<Key, THREE.BufferGeometry[]>();', `  const capturedParts: any[] = []; let labelNext = '';\n  const suppressed = new Set(${JSON.stringify(suppress ? SUPPRESSED : [])});\n  const batches = new Map<Key, THREE.BufferGeometry[]>();`);
    s = replace(s, '    const flat = geometry.index ? geometry.toNonIndexed() : geometry;', `    const role = labelNext || 'preserved-source-part'; labelNext = '';\n    const part = new THREE.Mesh(geometry.clone(), palette[key]);\n    part.name = role + '/' + String(capturedParts.length).padStart(3, '0');\n    part.userData.sourcePartId = capturedParts.length; part.userData.sourceRole = role;\n    capturedParts.push(part);\n    if (suppressed.has(role)) { geometry.dispose(); return; }\n    const flat = geometry.index ? geometry.toNonIndexed() : geometry;`);
    s = replace(s, '    group,\n    update(distance: number, steering: number)', '    group, capturedParts,\n    update(distance: number, steering: number)');
    if (materialCandidate)
        s = replace(s, 'new THREE.Mesh(geometry.clone(), palette[key])', 'new THREE.Mesh(geometry.clone(), rolePalette[key])');
    return s;
}
export async function makeSource({ suppress = false, materialCandidate = false } = {}) {
    const source = await fs.readFile(new URL('lib/city/assets/roadster.ts', ROOT), 'utf8');
    let code = ts.transpileModule(patchSource(source, { suppress, materialCandidate }), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    code = code.replace(/from ['"]([^'"]+)['"]/g, (_, id) => `from '${id.startsWith('file:') ? id : import.meta.resolve(id)}'`);
    return (await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))).makeRoadster();
}
export async function readGlb(path) { const bytes = await fs.readFile(path); const loader = new GLTFLoader(); loader.register(() => ({ name: 'CPU_NO_TEXTURE_FETCH', loadTexture: async () => new T.Texture() })); return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''); }
/** Optional E02 bridge. The exported GLB's artist UVs/materials are untouched.
 * Fresh in-memory triangle charts are native Three metre charts (not glTF's
 * normalized V-flipped UVs), so the same shared-map orientation as E02 applies.
 */
export function prepareReplacementMaterials(root) {
    const materials = new Map(); let count = 0;
    root.traverse(mesh => {
        if (!mesh.isMesh) return;
        const sourceRole = mesh.userData.source_role;
        const role = sourceRole?.startsWith('driver-seat-') ? 'seat-upholstery'
            : ({ dashboard: 'dashboard-trim', 'floor-extension': 'floor-trim', 'steering-rim': 'steering-trim', 'steering-spoke': 'steering-metal' })[sourceRole];
        if (!role || Array.isArray(mesh.material) || !mesh.material.isMeshStandardMaterial)
            throw Error('Unreviewed local material role: ' + mesh.name);
        if (!materials.has(role)) { const m = mesh.material.clone(); m.name = 'cockpit-candidate/' + role; materials.set(role, m); }
        mesh.material = materials.get(role);
        const copied = mesh.geometry.clone(), metric = metreUV(copied);
        if (metric !== copied) copied.dispose();
        metric.deleteAttribute('tangent'); // Derivative tangent basis must follow the NEW metre charts.
        mesh.geometry = metric;
        mesh.userData.semanticRole = role;
        mesh.userData.uvContract = 'Fresh native Three metre triangle charts; original GLB normalized/source UV preserved on disk';
        count++;
    });
    if (count !== 15) throw Error('Replacement part inventory drift');
    root.userData.metresUVAdapterVersion = '1.0.0';
    return count;
}
export function bindCockpitCandidateMaps(root, sharedById) {
    if (!root.userData.combinedE02Materials) throw Error('Enable materialCandidate before binding combined PBR maps');
    return bindCandidateMaps(root, sharedById);
}
export async function makeCockpitCandidate({ replacementGlb, materialCandidate = false } = {}) {
    if (!replacementGlb)
        throw Error('Explicit opt-in replacementGlb required');
    const car = await makeSource({ suppress: true, materialCandidate });
    const replacement = await readGlb(replacementGlb);
    if (replacement.scene.userData?.packageId !== 'roadster-driver-fit')
        throw Error('Unrecognized replacement package');
    replacement.scene.name = 'roadster-driver-fit/opt-in-local-parts';
    car.group.add(replacement.scene);
    car.replacement = replacement.scene;
    if (materialCandidate) { prepareReplacementMaterials(replacement.scene); describeBindings(car.group); car.group.userData.combinedE02Materials = true; }
    car.group.userData.cockpitFitCandidateVersion = '1.0.0';
    car.group.userData.runtimeStatus = 'runtime_pending_webgl';
    return car;
}
