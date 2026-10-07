import type { RideAnchor } from './passenger-transfers';
import type { RepresentationCapabilities } from './representation';

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected metadata object');
  return value as Record<string, unknown>;
};
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error('Expected metadata array');
  return value;
};
const string = (value: unknown): string => {
  if (typeof value !== 'string' || !value)
    throw new Error('Expected metadata identity');
  return value;
};
const point = (value: unknown): [number, number, number] => {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((v) => typeof v === 'number' && Number.isFinite(v))
  )
    throw new Error('Invalid metadata point');
  return [...value] as [number, number, number];
};
const quaternion = (value: unknown): [number, number, number, number] => {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every((v) => typeof v === 'number' && Number.isFinite(v)) ||
    Math.abs(Math.hypot(...value) - 1) > 1e-5
  )
    throw new Error('Invalid metadata rotation');
  return [...value] as [number, number, number, number];
};
export interface PassengerAnchorContract {
  anchor: RideAnchor;
  /** Do not confuse seat pelvis with standing feet or the character's rig root. */
  datum: 'pelvis' | 'feet';
  cameraEyePointM: [number, number, number] | null;
}
export interface VehiclePassengerContract {
  sourceVehicleId: string;
  profileId: string;
  assetRefs: { exterior: string; interior: string };
  capabilities: RepresentationCapabilities;
  anchors: PassengerAnchorContract[];
}
/** Narrow adapter for existing D02–D05 manifests, not a replacement manifest.
 * It only accepts root-local fixed anchors. Nested frames require a separately
 * validated transform-tree adapter; unknown profiles/units/LODs fail closed.
 * Asset geometry and source hashes still require the package's existing validators. */
export function passengerContractFromManifest(
  manifest: unknown,
  sourceVehicleId: string,
  expectedProfileId: string,
  instanceVehicleId: string,
  carId: string,
  lod: number,
): VehiclePassengerContract {
  if (
    !instanceVehicleId ||
    !carId ||
    !expectedProfileId ||
    !Number.isInteger(lod)
  )
    throw new Error('Invalid live vehicle binding');
  const root = object(manifest);
  if (root.schemaVersion !== 1 || root.units !== 'm')
    throw new Error('Unsupported vehicle manifest version/units');
  const vehicles = array(root.vehicles).map(object);
  const matches = vehicles.filter((v) => v.vehicleId === sourceVehicleId);
  if (matches.length !== 1)
    throw new Error('Missing or ambiguous source vehicle');
  const vehicle = matches[0];
  if (vehicle.profileId !== expectedProfileId)
    throw new Error('Vehicle profile mismatch; no Expo-to-Canada substitution');
  const frames = array(vehicle.frames).map(object),
    roots = frames.filter((f) => f.parentFrameId === null);
  if (
    roots.length !== 1 ||
    roots[0].frameId !== 'vehicle' ||
    roots[0].units !== 'm' ||
    roots[0].upAxis !== '+Y' ||
    roots[0].frontAxis !== '+Z'
  )
    throw new Error('Unsupported vehicle root frame');
  const transform = roots[0];
  if (
    point(transform.translationM).some((v) => v !== 0) ||
    quaternion(transform.rotationQuaternionXYZW).some(
      (v, i) => v !== (i === 3 ? 1 : 0),
    ) ||
    (transform.scale !== undefined &&
      point(transform.scale).some((v) => v !== 1))
  )
    throw new Error('Nonidentity root requires explicit transform adapter');
  const capabilities = array(vehicle.lodCapabilities)
    .map(object)
    .filter((c) => c.level === lod);
  if (capabilities.length !== 1) throw new Error('Unknown vehicle LOD');
  const cap = capabilities[0];
  if (
    cap.passengerCapable !== true ||
    cap.doorsAnimated !== true ||
    cap.openingsPreserved !== true
  )
    throw new Error('LOD is not passenger capable');
  const refs = object(vehicle.assetRefs),
    exterior = string(refs.exterior),
    interior = string(refs.interior),
    assets = new Set(array(root.assets).map((a) => string(object(a).id)));
  if (!assets.has(exterior) || !assets.has(interior))
    throw new Error('Vehicle asset reference missing');
  const ids = new Set<string>(),
    anchors: PassengerAnchorContract[] = [];
  const add = (record: Record<string, unknown>, kind: 'seat' | 'standing') => {
    if (record.frameId !== 'vehicle')
      throw new Error('Nested anchor needs explicit frame resolution');
    const anchorId = string(kind === 'seat' ? record.seatId : record.regionId);
    if (ids.has(anchorId)) throw new Error('Duplicate passenger anchor');
    ids.add(anchorId);
    if (
      kind === 'standing' &&
      (typeof record.headClearanceM !== 'number' ||
        !Number.isFinite(record.headClearanceM) ||
        record.headClearanceM < 1.95)
    )
      throw new Error('Insufficient standing head clearance');
    anchors.push({
      anchor: {
        vehicleId: instanceVehicleId,
        carId,
        anchorId,
        kind,
        frameId: 'vehicle',
        translationM: point(
          kind === 'seat' ? record.pelvisPointM : record.feetPointM,
        ),
        rotationQuaternionXYZW:
          kind === 'seat'
            ? quaternion(record.facingQuaternionXYZW)
            : [0, 0, 0, 1],
      },
      datum: kind === 'seat' ? 'pelvis' : 'feet',
      cameraEyePointM: kind === 'seat' ? point(record.cameraEyePointM) : null,
    });
  };
  for (const seat of array(vehicle.seats)) add(object(seat), 'seat');
  // One fixed standing anchor per validated region, not arbitrary free walking/capacity.
  for (const standing of array(vehicle.standingRegions))
    add(object(standing), 'standing');
  if (!anchors.length)
    throw new Error('Vehicle has no fixed passenger anchors');
  return {
    sourceVehicleId,
    profileId: expectedProfileId,
    assetRefs: { exterior, interior },
    capabilities: {
      passengerCapable: true,
      doorsAnimated: true,
      openingsPreserved: true,
    },
    anchors,
  };
}
