/** CPU contact proof against actual posed human triangles and actual closed
 * triangulated solids. Broad-phase AABB is not used as acceptance. Narrow phase:
 * triangle edge/surface crossing plus closed-solid odd/even containment; Euclidean
 * triangle separation includes edge-edge minima. Coplanar boundary contact counts.
 */
import * as T from 'three';
const EPS = 1e-8;
export function triangle(a, b, c, metadata = {}) { const t = new T.Triangle(a, b, c); return { t, box: new T.Box3().setFromPoints([a, b, c]), ...metadata }; }
export function meshTriangles(mesh, posed = false) { const a = mesh.geometry.attributes, idx = mesh.geometry.index, vs = [], moved = []; if (posed && mesh.isSkinnedMesh)
    mesh.skeleton.update(); for (let i = 0; i < a.position.count; i++) {
    const p = new T.Vector3().fromBufferAttribute(a.position, i);
    let correctiveMoved = false;
    if (posed && mesh.geometry.morphAttributes.position) {
        const base = p.clone();
        for (let j = 0; j < mesh.geometry.morphAttributes.position.length; j++) {
            const w = mesh.morphTargetInfluences?.[j] || 0;
            if (!w)
                continue;
            const delta = new T.Vector3().fromBufferAttribute(mesh.geometry.morphAttributes.position[j], i);
            if (!mesh.geometry.morphTargetsRelative)
                delta.sub(base);
            p.addScaledVector(delta, w);
            if (delta.lengthSq() > 1e-16)
                correctiveMoved = true;
        }
    }
    if (posed && mesh.isSkinnedMesh)
        mesh.applyBoneTransform(i, p);
    vs.push(p.applyMatrix4(mesh.matrixWorld));
    moved.push(correctiveMoved);
} const result = [], count = idx ? idx.count : vs.length; for (let i = 0; i < count; i += 3) {
    const ids = [0, 1, 2].map(k => idx ? idx.getX(i + k) : i + k);
    let bone = 'static';
    if (posed && a.skinIndex) {
        const sums = new Map();
        for (const v of ids)
            for (let j = 0; j < 4; j++) {
                const n = a.skinIndex.getComponent(v, j);
                sums.set(n, (sums.get(n) || 0) + a.skinWeight.getComponent(v, j));
            }
        bone = mesh.skeleton.bones[[...sums].sort((a, b) => b[1] - a[1])[0][0]].name;
    }
    const restY = ids.map(i => a.position.getY(i));
    result.push(triangle(...ids.map(i => vs[i]), { bone, sourceMesh: mesh.name, restY, ids, correctiveMoved: ids.some(i => moved[i]) }));
} return result; }
export function makeCollider(mesh, { solid = true } = {}) { const tris = meshTriangles(mesh); const box = new T.Box3(); for (const t of tris)
    box.union(t.box); return { name: mesh.name, tris, box, solid }; }
function edges(t) { return [[t.a, t.b], [t.b, t.c], [t.c, t.a]]; }
function segmentTriangle(a, b, t) { const d = b.clone().sub(a), len = d.length(); if (len < EPS)
    return null; d.divideScalar(len); const hit = new T.Ray(a, d).intersectTriangle(t.a, t.b, t.c, false, new T.Vector3()); return hit && hit.distanceTo(a) <= len + EPS ? hit : null; }
function segmentsSq(p1, q1, p2, q2) { const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2); const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r); let s, t; if (a <= EPS && e <= EPS)
    return r.lengthSq(); if (a <= EPS) {
    s = 0;
    t = T.MathUtils.clamp(f / e, 0, 1);
}
else {
    const c = d1.dot(r);
    if (e <= EPS) {
        t = 0;
        s = T.MathUtils.clamp(-c / a, 0, 1);
    }
    else {
        const b = d1.dot(d2), den = a * e - b * b;
        s = den !== 0 ? T.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
        t = (b * s + f) / e;
        if (t < 0) {
            t = 0;
            s = T.MathUtils.clamp(-c / a, 0, 1);
        }
        else if (t > 1) {
            t = 1;
            s = T.MathUtils.clamp((b - c) / a, 0, 1);
        }
    }
} return p1.clone().addScaledVector(d1, s).distanceToSquared(p2.clone().addScaledVector(d2, t)); }
export function triangleDistanceSq(a, b) { for (const [p, q] of edges(a))
    if (segmentTriangle(p, q, b))
        return 0; for (const [p, q] of edges(b))
    if (segmentTriangle(p, q, a))
        return 0; let best = Infinity; const scratch = new T.Vector3(); for (const p of [a.a, a.b, a.c])
    best = Math.min(best, p.distanceToSquared(b.closestPointToPoint(p, scratch))); for (const p of [b.a, b.b, b.c])
    best = Math.min(best, p.distanceToSquared(a.closestPointToPoint(p, scratch))); for (const [p, q] of edges(a))
    for (const [r, s] of edges(b))
        best = Math.min(best, segmentsSq(p, q, r, s)); return best; }
export function inside(point, c) { if (!c.solid || !c.box.containsPoint(point))
    return false; const ray = new T.Ray(point, new T.Vector3(.931, .347, .119).normalize()), hits = []; for (const { t, box } of c.tris) {
    if (!ray.intersectsBox(box))
        continue;
    const p = ray.intersectTriangle(t.a, t.b, t.c, false, new T.Vector3());
    if (p) {
        const d = p.distanceTo(point);
        if (d < EPS)
            return true;
        if (!hits.some(x => Math.abs(x - d) < 1e-7))
            hits.push(d);
    }
} return hits.length % 2 === 1; }
function boxDistanceSq(a, b) { let d = 0; for (const k of ['x', 'y', 'z']) {
    const q = Math.max(0, a.min[k] - b.max[k], b.min[k] - a.max[k]);
    d += q * q;
} return d; }
export function contacts(human, collider, { clearanceCap = .1, onIntersection = null } = {}) {
    let intersections = 0, surfaceCrossings = 0, contained = 0, minimum = clearanceCap * clearanceCap;
    const bones = {}, sample = [];
    let minPair = null;
    for (const h of human) {
        if (boxDistanceSq(h.box, collider.box) > minimum)
            continue;
        let crossing = false, dist = Infinity;
        for (const c of collider.tris) {
            const lb = boxDistanceSq(h.box, c.box);
            if (lb > minimum && !h.box.intersectsBox(c.box))
                continue;
            const d = triangleDistanceSq(h.t, c.t);
            dist = Math.min(dist, d);
            if (d <= EPS * EPS) {
                crossing = true;
                break;
            }
        }
        const within = !crossing && collider.solid && inside(h.t.a, collider);
        if (crossing || within) {
            onIntersection?.(h);
            intersections++;
            surfaceCrossings += crossing ? 1 : 0;
            contained += within ? 1 : 0;
            bones[h.bone] = (bones[h.bone] || 0) + 1;
            if (sample.length < 4)
                sample.push({ bone: h.bone, point: h.t.getMidpoint(new T.Vector3()).toArray(), kind: crossing ? 'surface' : 'contained' });
            minimum = 0;
        }
        else if (dist < minimum) {
            minimum = dist;
            minPair = { bone: h.bone, point: h.t.getMidpoint(new T.Vector3()).toArray() };
        }
    }
    return { collider: collider.name, colliderTriangles: collider.tris.length, closedSolid: collider.solid, intersectingHumanTriangles: intersections, surfaceCrossingTriangles: surfaceCrossings, fullyContainedTriangles: contained, dominantBones: bones, minimumSeparationM: Math.sqrt(minimum), minimumIsLowerBound: minimum === clearanceCap * clearanceCap, nearestHumanTriangle: minPair, sample };
}
export function penetrationSamples(human, collider) { let tested = 0, insideCount = 0, maxDepth = 0, maxPoint = null; const depths = [], byBone = {}, byRegion = {}; const scratch = new T.Vector3(); for (const h of human) {
    if (!h.box.intersectsBox(collider.box))
        continue;
    const t = h.t;
    const ps = [t.a, t.b, t.c, t.getMidpoint(new T.Vector3()), t.a.clone().lerp(t.b, .5), t.b.clone().lerp(t.c, .5), t.c.clone().lerp(t.a, .5)];
    for (const p of ps) {
        tested++;
        if (!inside(p, collider))
            continue;
        insideCount++;
        let d = Infinity;
        for (const c of collider.tris)
            d = Math.min(d, p.distanceTo(c.t.closestPointToPoint(p, scratch)));
        depths.push(d);
        (byBone[h.bone] ??= []).push(d);
        (byRegion[h.correctiveMoved ? 'corrective-moved-distal-region' : 'unchanged-proximal-region'] ??= []).push(d);
        if (d > maxDepth) {
            maxDepth = d;
            maxPoint = p.toArray();
        }
    }
} depths.sort((a, b) => a - b); const quantiles = a => ({ count: a.length, p50M: a[Math.floor(a.length * .5)] ?? 0, p95M: a[Math.floor(a.length * .95)] ?? 0, maxM: a.at(-1) ?? 0 }); return { quantiles: quantiles(depths), byRegion: Object.fromEntries(Object.entries(byRegion).map(([b, a]) => [b, quantiles(a.sort((x, y) => x - y))])), byBone: Object.fromEntries(Object.entries(byBone).map(([b, a]) => [b, quantiles(a.sort((x, y) => x - y))])), method: 'Actual solid containment and nearest triangle surface distance on triangle vertices, centroid and edge midpoints; finite sampling, not continuous penetration maximum', testedSamples: tested, insideSamples: insideCount, maximumSampledPenetrationM: maxDepth, deepestSample: maxPoint }; }
