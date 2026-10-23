/** Inspect-only overview starts on a genuine lower platform, so the normal
 * occupied-level cutaway exposes the platform rather than its retained roof.
 * This placement is separate from the native circulation evidence.
 */
export function prepareStationOverviewViewpoint(testOwner) {
  const travel = testOwner ? null : window.__atlas.skyTrainTravel,
    owner = testOwner ?? travel.owner;
  if (!owner) throw new Error('Missing actual station for platform overview');
  const platforms = [...owner.data.platforms].sort(
      (a, b) => a.floorHeight - b.floorHeight || a.id.localeCompare(b.id),
    ),
    lowestY = platforms[0]?.floorHeight;
  if (!Number.isFinite(lowestY))
    throw new Error('Missing actual platform height for overview');
  for (const platform of platforms.filter(
    (p) => Math.abs(p.floorHeight - lowestY) < 1e-6,
  )) {
    const floor = owner.geometryData.floors.find(
      (f) => f.id === platform.surfaceId,
    );
    if (!floor) continue;
    const center = [0, 1, 2].map(
        (axis) =>
          (Math.min(...floor.vertices.map((p) => p[axis])) +
            Math.max(...floor.vertices.map((p) => p[axis]))) /
          2,
      ),
      candidates = [center, ...platform.doors.map((door) => door.waiting)];
    for (let i = 0; i < floor.indices.length; i += 3) {
      const triangle = floor.indices
        .slice(i, i + 3)
        .map((index) => floor.vertices[index]);
      for (const weights of [
        [1 / 3, 1 / 3, 1 / 3],
        [0.6, 0.2, 0.2],
        [0.2, 0.6, 0.2],
        [0.2, 0.2, 0.6],
      ])
        candidates.push(
          [0, 1, 2].map((axis) =>
            weights.reduce(
              (sum, weight, k) => sum + weight * triangle[k][axis],
              0,
            ),
          ),
        );
    }
    const feet = candidates
      .map((point) => owner.floorAt(point, floor.id))
      .filter(
        (foot) =>
          foot &&
          Math.abs(foot.position[1] - lowestY) < 0.01 &&
          owner.isClearFoot(foot),
      )
      .sort(
        (a, b) =>
          Math.hypot(a.position[0] - center[0], a.position[2] - center[2]) -
          Math.hypot(b.position[0] - center[0], b.position[2] - center[2]),
      );
    if (!feet.length) continue;
    const view = {
      platformId: platform.id,
      floorId: floor.id,
      foot: feet[0],
      placement: 'Inspect-only supported lowest-platform viewpoint',
    };
    if (travel) {
      travel.foot = view.foot;
      travel.level = 'platform';
      travel.distanceView = 0;
      travel.updateCamera();
    }
    return view;
  }
  throw new Error('No supported body-clear lowest-platform overview viewpoint');
}
