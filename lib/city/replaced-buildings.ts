import { SEABUS_REPLACED_IDS } from './seabus-layout';
/** Whole measured structures replaced by original landmark geometry. Keep source data for navigation. */
export function replacedBuilding(properties: Record<string, unknown>) {
  const key = String(
    properties.structureId ?? properties.buildingId ?? properties.id,
  );
  return (
    SEABUS_REPLACED_IDS.has(String(properties.id)) ||
    key === 'osm-structure-67' ||
    key === 'osm-structure-14' ||
    key === 'osm-structure-19' ||
    key === '152366'
  );
}
