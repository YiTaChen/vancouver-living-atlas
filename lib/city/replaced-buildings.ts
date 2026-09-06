/** Whole measured structures replaced by original landmark geometry. Keep source data for navigation. */
export function replacedBuilding(properties: Record<string, unknown>) {
  const key = String(
    properties.structureId ?? properties.buildingId ?? properties.id,
  );
  return key === 'osm-structure-14' || key === 'osm-structure-19' || key === '152366';
}
