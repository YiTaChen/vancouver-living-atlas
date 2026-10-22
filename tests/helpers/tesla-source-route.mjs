/** Exercise public TeslaState at exact source-route coordinates. The fixed
 * 10m/s cruise is a geometry/surface test, not a high-speed handling guarantee. */
import { load, THREE } from '../../tools/causeway-cpu.mjs';
const { createTesla, stepTesla } = load('lib/city/tesla-state.ts');
export function replayTeslaSourceRoute({ e, world, shape }, route, reverse) {
  const points = reverse ? [...route.points].reverse() : route.points;
  let s = 0;
  const pieces = points.slice(1).map((b, i) => {
    const a = points[i],
      len = Math.hypot(b[0] - a[0], b[1] - a[1]),
      start = s;
    s += len;
    return { a, b, len, start };
  });
  function at(d) {
    const p = pieces.find((p) => p.start + p.len >= d) || pieces.at(-1),
      f = Math.min(1, Math.max(0, (d - p.start) / p.len));
    return {
      point: [p.a[0] + (p.b[0] - p.a[0]) * f, p.a[1] + (p.b[1] - p.a[1]) * f],
      yaw: Math.atan2(p.b[0] - p.a[0], p.b[1] - p.a[1]),
    };
  }
  const first = at(5),
    identity = reverse ? route.reverseIdentity : route.forwardIdentity,
    y =
      e.data.travelSurfaces
        .lookup(...first.point)
        .find(
          (h) =>
            h.surfaceId === identity.surfaceId && h.layer === identity.layer,
        )?.y ??
      e.data.roadSurface.sample(
        ...first.point,
        e.elevation(...first.point) + 1.05,
      ),
    picked = world.groundPoseNear(
      [first.point[0], y, first.point[1]],
      shape,
      first.yaw,
      0,
      identity,
    );
  let spawn = picked;
  if (!spawn) {
    const probe = world.support(
      {
        pose: {
          position: [first.point[0], y + 3, first.point[1]],
          quaternion: new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0, 1, 0), first.yaw)
            .toArray(),
        },
        shape: { halfExtents: [0.02, 0.02, 0.02], clearance: 0 },
        maxDistance: 10,
        adhesion: false,
      },
      (f) => {
        const id = world.identity(f);
        return (
          f.kind === 'ground' &&
          id?.surfaceId === identity.surfaceId &&
          id?.layer === identity.layer
        );
      },
    );
    if (probe) {
      const up = new THREE.Vector3(...probe.normal).normalize(),
        forward = new THREE.Vector3(Math.sin(first.yaw), 0, Math.cos(first.yaw))
          .projectOnPlane(up)
          .normalize(),
        right = up.clone().cross(forward).normalize();
      forward.copy(right.clone().cross(up).normalize());
      const q = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(right, up, forward),
      );
      for (const heave of [0.002, 0.004, 0.006, 0.008, 0.01, 0.012]) {
        const pose = {
            position: [
              first.point[0],
              y + shape.halfExtents[1] + shape.clearance + heave,
              first.point[1],
            ],
            quaternion: q.toArray(),
          },
          fit = world.fitGround({
            pose,
            shape,
            preferredSurfaceId: probe.surfaceId,
            maxAdjustmentM: 0.35,
          }),
          candidate = fit?.pose ?? pose,
          proof = world.support(
            {
              pose: candidate,
              shape,
              maxDistance: shape.halfExtents[1] + shape.clearance + 0.12,
              preferredSurfaceId: probe.surfaceId,
              adhesion: false,
            },
            (f) => {
              const id = world.identity(f);
              return (
                id?.surfaceId === identity.surfaceId &&
                id?.layer === identity.layer
              );
            },
          );
        if (
          proof &&
          !world.sweep({
            from: candidate,
            to: candidate,
            shape,
            ignoreSurfaceId: proof.surfaceId,
          })
        ) {
          spawn = { pose: candidate, contact: proof };
          break;
        }
      }
    }
  }
  if (!spawn) {
    return { route: route.id, reverse, failed: 'spawn', first, identity };
  }
  const state = createTesla(spawn.pose.position, first.yaw, spawn.contact);
  state.quaternion = spawn.pose.quaternion;
  state.velocity = new THREE.Vector3(0, 0, 10)
    .applyQuaternion(new THREE.Quaternion(...state.quaternion))
    .toArray();
  state.adhesionArmed = false;
  let progress = 5,
    frames = 0,
    collisions = 0,
    air = 0,
    failed;
  const floors = [],
    lionsContacts = [];
  for (; frames < 3600 && progress < s - 5; frames++) {
    let best;
    for (const p of pieces) {
      if (p.start + p.len < progress - 3 || p.start > progress + 15) continue;
      const dx = p.b[0] - p.a[0],
        dz = p.b[1] - p.a[1],
        t = Math.max(
          0,
          Math.min(
            1,
            ((state.position[0] - p.a[0]) * dx +
              (state.position[2] - p.a[1]) * dz) /
              (p.len * p.len),
          ),
        ),
        q = [p.a[0] + dx * t, p.a[1] + dz * t],
        d = Math.hypot(q[0] - state.position[0], q[1] - state.position[2]);
      if (!best || d < best.d) best = { s: p.start + p.len * t, d };
    }
    if (!best || best.d > 3) {
      failed = { reason: 'route-departure', best, position: state.position };
      break;
    }
    progress = Math.max(progress, best.s);
    const target = at(Math.min(s, progress + 5)),
      forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
        new THREE.Quaternion(...state.quaternion),
      ),
      yaw = Math.atan2(forward.x, forward.z),
      want = Math.atan2(
        target.point[0] - state.position[0],
        target.point[1] - state.position[2],
      );
    let delta = want - yaw;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const speed = Math.hypot(...state.velocity),
      report = stepTesla(
        state,
        {
          steer: Math.max(-1, Math.min(1, delta * 2)),
          throttle: speed < 10 ? 1 : 0,
          brake: speed > 11.5,
        },
        1 / 60,
        world,
        shape,
      );
    collisions += report.collisions;
    air += state.mode === 'air' ? 1 : 0;
    const id = state.contact && world.identity(state.contact);
    if (id?.surfaceId === 'lions:road') {
      const index = Number(
          /^protected:(\d+):face:/.exec(state.contact.surfaceId)?.[1],
        ),
        source = Number.isInteger(index)
          ? e.data.travelSurfaces.surfaces[index]
          : undefined;
      lionsContacts.push({
        routeId: source?.routeId,
        position: [...state.position],
      });
    }
    if (
      id &&
      !floors.some((p) => p.surfaceId === id.surfaceId && p.layer === id.layer)
    )
      floors.push(id);
    if (
      report.collisions ||
      report.environmentFailures ||
      state.mode === 'air'
    ) {
      failed = {
        reason: 'physical-failure',
        report,
        state: structuredClone(state),
        progress,
        best,
      };
      break;
    }
  }
  return {
    route: route.id,
    reverse,
    length: s,
    progress,
    frames,
    collisions,
    air,
    floors,
    lionsContacts,
    completed: !failed && progress >= s - 5,
    failed,
  };
}
