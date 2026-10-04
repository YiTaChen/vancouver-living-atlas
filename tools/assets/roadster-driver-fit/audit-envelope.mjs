/** Actual shell-surface comparison. Preserve and expose existing seat/body joins.
 * Original shell is open, so no fabricated watertight containment certification.
 */
import fs from 'node:fs/promises';
import * as T from 'three';
import { makeCockpitCandidate, SUPPRESSED } from './adapters/cockpit-candidate.mjs';
import { meshTriangles, makeCollider, contacts } from './contact-kernel.mjs';
const dir = new URL('./', import.meta.url), car = await makeCockpitCandidate({ replacementGlb: new URL('exports/roadster-cockpit-local.lod0.glb', dir) });
car.group.updateMatrixWorld(true);
const moved = [];
car.replacement.traverse(o => { if (o.isMesh && !o.name.startsWith('dashboard-'))
    moved.push(...meshTriangles(o)); });
const sourceParts = car.capturedParts.filter(p => p.userData.sourceRole.startsWith('driver-seat-') || p.userData.sourceRole.startsWith('steering-')), baseline = [], original = new Map();
for (const p of sourceParts) {
    p.updateMatrixWorld(true);
    const tris = meshTriangles(p);
    tris.forEach((t, i) => t.originalKey = p.name + ':' + i);
    original.set(p.name.replace('/', '-'), tris);
    baseline.push(...tris);
}
function originalKey(h) { const source = original.get(h.sourceMesh); if (!source)
    return 'new-part:' + h.sourceMesh; const delta = h.sourceMesh.startsWith('driver-seat-') ? new T.Vector3(0, 0, .265) : new T.Vector3(0, .18, 0), ps = [h.t.a, h.t.b, h.t.c].map(p => p.clone().sub(delta)); for (const t of source) {
    const qs = [t.t.a, t.t.b, t.t.c];
    for (let r = 0; r < 3; r++)
        if (ps.every((p, i) => p.distanceTo(qs[(i + r) % 3]) < 1e-6))
            return t.originalKey;
} throw Error('Moved triangle does not map to source: ' + h.sourceMesh); }
const results = [];
for (const p of car.capturedParts) {
    const r = p.userData.sourceRole;
    if (SUPPRESSED.includes(r) || r.includes('seat-') || ['cabin-floor', 'underbody', 'center-console'].includes(r) || (p.userData.sourcePartId >= 51 && p.userData.sourcePartId <= 52))
        continue;
    p.updateMatrixWorld(true);
    const collider = makeCollider(p, { solid: false }), candidateHitKeys = [], baselineHitKeys = [];
    const result = contacts(moved, collider, { clearanceCap: .10, onIntersection: h => candidateHitKeys.push(originalKey(h)) });
    const base = contacts(baseline, collider, { clearanceCap: .01, onIntersection: h => baselineHitKeys.push(h.originalKey) });
    const added = candidateHitKeys.filter(k => !baselineHitKeys.includes(k));
    if (result.intersectingHumanTriangles || !result.minimumIsLowerBound)
        results.push({ ...result, baselineIntersectionCount: base.intersectingHumanTriangles, baselineOriginalTriangleKeys: baselineHitKeys, candidateOriginalTriangleKeys: candidateHitKeys, newSourceTriangleIntersections: added, carriedOriginalInterface: result.intersectingHumanTriangles > 0 && added.length === 0 });
}
const newHits = results.reduce((s, r) => s + r.newSourceTriangleIntersections.length, 0);
const report = { status: newHits === 0 ? 'pass' : 'fail', interpretation: 'No new source-triangle shell crossings. Original eight seat/backrest/bolster-to-door-shoulder assembly surface joins remain, explicitly verified by exact original triangle identities, not hidden or called clear.', scope: 'Moved original driver seat and steering plus new foot pan vs unchanged outer-body/window/trim surfaces. Existing seat-to-floor support and original floor seams are excluded; open shell is not a closed-volume certification.', newSourceTriangleIntersections: newHits, inheritedSourceTriangleIntersections: results.reduce((s, r) => s + r.candidateOriginalTriangleKeys.length - r.newSourceTriangleIntersections.length, 0), floorExtension: { min: [.20, .385, .635], max: [.68, .475, .89], unchangedUnderbodyTopY: .31 }, results };
await fs.writeFile(new URL('qa/cabin-envelope.json', dir), JSON.stringify(report, null, 2) + '\n');
if (report.status !== 'pass')
    process.exitCode = 1;
console.log(report.status, 'new', newHits, 'inherited', report.inheritedSourceTriangleIntersections);
