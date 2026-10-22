/** Discard verified non-car ROW copies, preserving actual parking access,
 * bridge decks, walking paths and the original bundled municipal source. */
import type { FeatureCollection } from './types';
import source from './stanley-road-access-source.json';

export function prepareStanleyRoadAccess(roads: FeatureCollection) {
  // Validate the complete pinned source set before changing any runtime copy.
  for (const rule of source.decisions) {
    const feature = roads.features[rule.citySourceId];
    if (
      !feature ||
      feature.properties.source !== 'cov-non-city-streets' ||
      JSON.stringify(feature.geometry) !==
        JSON.stringify(rule.citySourceGeometry)
    )
      throw new Error(
        `Stanley road access source ${rule.citySourceId} changed`,
      );
  }
  const excludedSourceIds: number[] = [];
  for (const rule of source.decisions) {
    const feature = roads.features[rule.citySourceId];
    if (rule.action === 'retain-parking-prefix') {
      const end = rule.lastRetainedVertex;
      if (!Number.isInteger(end) || end === undefined || end < 1)
        throw new Error('Invalid retained Stanley parking prefix');
      roads.features[rule.citySourceId] = {
        ...feature,
        properties: { ...feature.properties },
        geometry: {
          type: 'LineString',
          coordinates: rule.citySourceGeometry.coordinates.slice(0, end + 1),
        },
      };
    } else {
      excludedSourceIds.push(rule.citySourceId);
      roads.features[rule.citySourceId] = {
        ...feature,
        properties: { ...feature.properties },
        geometry: { type: 'MultiLineString', coordinates: [] },
      };
    }
  }
  return {
    excludedSourceIds,
    retainedParkingSourceId: 1581,
    retainedParkingCoordinates: roads.features[1581].geometry.coordinates,
  };
}
