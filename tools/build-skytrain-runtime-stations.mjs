/** Repackage the project's original station layout for lazy city use.
 * Source coordinates are preserved; world street height is resolved at runtime.
 * No third-party pictures, meshes or logos are embedded. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

export const SOURCE =
  'tools/assets/skytrain-stations-stage2/station-layout.json';
export const TARGET = 'public/models/skytrain-stations';
export function makeRuntimeStation(source, sourceSha256) {
  const connections = source.connections.map((connection) => ({
    id: connection.connectionId,
    from: connection.fromSurfaceId,
    to: connection.toSurfaceId,
    type: connection.type,
    start: connection.startPointM,
    end: connection.endPointM,
    width: connection.clearWidthM ?? 1.2,
    treads: (connection.treadSurfaces ?? []).map((tread) => ({
      id: tread.partId,
      vertices: tread.verticesM,
      indices: tread.indices,
    })),
  }));
  return {
    schema: 1,
    id: source.stationId,
    name: source.name,
    topology: source.layoutKind,
    ...(source.authoredInterior
      ? {
          authoredInterior: source.authoredInterior,
          signs: source.interiorSigns ?? [],
        }
      : {}),
    source: {
      package: 'skytrain-stations-stage2',
      layout: SOURCE,
      sha256: sourceSha256,
      map: source.provenance.mapUrl,
      geometry: 'Original authored box geometry and floor triangles',
      accuracy:
        'Source-backed broad topology; representative dimensions and depth, not a survey or photogrammetry',
    },
    lonlat: source.geographicAnchor.coordinatesLonLat,
    quaternion: source.localToWorld.rotationQuaternionXYZW,
    verticalDatum:
      'Street datum resolved from actual city terrain at runtime; source world Y=0 is not adopted',
    floors: source.floorSurfaces
      .filter((floor) => floor.walkable)
      .map((floor) => ({
        id: floor.surfaceId,
        level: floor.levelId,
        kind: floor.kind,
        vertices: floor.verticesM,
        indices: floor.indices,
      })),
    entrances: source.entrances.map((entry) => ({
      id: entry.entranceId,
      label: entry.label,
      point: entry.pointM,
      surfaceId: entry.surfaceId,
      ...(entry.inwardDirectionM
        ? { inwardDirection: entry.inwardDirectionM }
        : {}),
    })),
    platforms: source.platforms.map((platform) => ({
      id: platform.platformId,
      line: platform.lineId,
      direction: platform.direction,
      surfaceId: platform.surfaceId,
      length: platform.lengthM,
      width: platform.widthM,
      floorHeight: platform.floorHeightM,
      railHeight: platform.railHeightM,
      position: platform.stopPosition.translationM,
      quaternion: platform.stopPosition.rotationQuaternionXYZW,
      motionSign: platform.stopPosition.motionDirectionSign,
      doors: platform.doorAlignmentPoints.map((door) => ({
        id: door.id,
        carIndex: door.carIndex,
        side: door.carLocalSide,
        carOffset: door.carPoseInConsist.translationM,
        carQuaternion: door.carPoseInConsist.rotationQuaternionXYZW,
        carDoor: door.carLocalSillPointM,
        sill: door.stationSillPointM,
        edge: door.platformEdgePointM,
        waiting: door.stationWaitingPointM,
        width: door.openingWidthM,
      })),
    })),
    connections,
    exclusions: source.trackExclusionVolumes.map((v) => ({
      id: v.id,
      polygon: v.footprintM,
      minY: v.minY,
      maxY: v.maxY,
    })),
    obstacles: source.obstacles.map((o) => ({
      id: o.id,
      position:
        o.centerM ?? o.boundsM.min.map((v, i) => (v + o.boundsM.max[i]) / 2),
      size: o.sizeM ?? o.boundsM.min.map((v, i) => o.boundsM.max[i] - v),
      yaw: o.yawDegrees ?? 0,
      ...(o.rotationQuaternionXYZW
        ? { quaternion: o.rotationQuaternionXYZW }
        : {}),
    })),
    parts: source.geometryParts.map((part) => ({
      id: part.id,
      position: part.centerM,
      size: part.sizeM,
      yaw: part.yawDegrees,
      ...(part.rotationQuaternionXYZW
        ? { quaternion: part.rotationQuaternionXYZW }
        : {}),
      material: part.material,
      role: part.role,
      ...(part.renderFloorSurfaceId !== undefined
        ? { renderFloorSurfaceId: part.renderFloorSurfaceId }
        : {}),
    })),
  };
}
export function buildRuntimeStations(
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
) {
  const bytes = readFileSync(resolve(root, SOURCE));
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
  const source = JSON.parse(bytes);
  mkdirSync(resolve(root, TARGET), { recursive: true });
  const files = source.stations.map((station) => {
    const data = makeRuntimeStation(station, sourceSha256);
    const bytes = JSON.stringify(data) + '\n';
    const file = `${data.id}.json`;
    writeFileSync(resolve(root, TARGET, file), bytes);
    return {
      id: data.id,
      file,
      bytes: Buffer.byteLength(bytes),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  });
  const manifest = {
    schema: 1,
    source: SOURCE,
    sourceSha256,
    sourceLicense:
      'Vancouver Living Atlas Noncommercial Research and Attribution 1.0',
    files,
  };
  writeFileSync(
    resolve(root, TARGET, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  return manifest;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const manifest = buildRuntimeStations();
  process.stdout.write(
    `Prepared ${manifest.files.length} lazy station layouts (${manifest.files.reduce((n, v) => n + v.bytes, 0)} bytes).\n`,
  );
}
