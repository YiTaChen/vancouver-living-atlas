import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { projectBeforeWalkCamera } from './camera-source-compatibility.mjs';
import { projectBeforeWaterfrontAuthority } from './waterfront-authority-source-compatibility.mjs';
import { projectBeforeStreetPilot } from './street-pilot-source-compatibility.mjs';
import { projectBeforeRound2Roadster } from './round2-roadster-source-compatibility.mjs';

export const SEATING_REVIEW_BASE = '53bb3c6';
const sha = (value) => createHash('sha256').update(value).digest('hex');

function exact(source, before, after, label) {
  assert.equal(
    source.split(before).length - 1,
    1,
    `Reviewed seating anchor changed: ${label}`,
  );
  return source.replace(before, after);
}

/** Remove only the reviewed character delta; seated-source baselines keep seats. */
export function projectBeforeCharacter(path, source) {
  const round2 = projectBeforeRound2Roadster(path, source);
  const pilot = projectBeforeStreetPilot(path, round2.source);
  const authority = projectBeforeWaterfrontAuthority(path, pilot.source);
  const camera = projectBeforeWalkCamera(path, authority.source);
  source = camera.source;
  const reviewed = [...round2.reviewed, ...pilot.reviewed, ...authority.reviewed, ...camera.reviewed];
  const remove = (before, after, label) => {
    source = exact(source, before, after, label);
    reviewed.push(label);
  };
  if (path === 'lib/city/navigation.ts') {
    // The prior seating-only source remains valid. If any character-selection
    // marker is present, require the complete reviewed delta at its exact sites.
    if (
      source.includes('CitizenCharacter') ||
      source.includes('setCharacter(')
    ) {
      remove(
        "import { makeCitizen, type CitizenCharacter } from './citizen';",
        "import { makeCitizen } from './citizen';",
        'character selection type import',
      );
      remove(
        `  carModel: 'classic' | 'roadster' = 'roadster';
  character: CitizenCharacter = 'male';
  classicCar = new THREE.Group();`,
        `  carModel: 'classic' | 'roadster' = 'roadster';
  classicCar = new THREE.Group();`,
        'character selection default',
      );
      remove(
        `    update(distance: number, moving: boolean, dt?: number, speed?: number): void;
    setCharacter(character: CitizenCharacter): void;
    setSeated?(seated: boolean, seatHeight?: number): void;`,
        `    update(distance: number, moving: boolean, dt?: number, speed?: number): void;
    setSeated?(seated: boolean, seatHeight?: number): void;`,
        'character selection walker API',
      );
      remove(
        `    this.notifyCamera();
  }
  setCharacter(character: CitizenCharacter) {
    if (character !== 'male' && character !== 'female') return;
    this.walker.setCharacter(character);
    this.character = character;
    this.walker.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = false;
    });
  }
  keyDown = (ev: KeyboardEvent) => {`,
        `    this.notifyCamera();
  }
  keyDown = (ev: KeyboardEvent) => {`,
        'character selection setter and shadow policy',
      );
    }
  }
  return { source, reviewed };
}

/** Reviewed in-memory subtraction of additive seating and character selection.
 * This is an audit projection, never a runtime transform. Every remaining byte
 * must still hash to the unchanged source fixture. Matching only these snippets
 * cannot hide a changed drive branch, collider or chair mesh. */
export function projectBeforeSeating(path, source) {
  const character = projectBeforeCharacter(path, source);
  source = character.source;
  const reviewed = [...character.reviewed];
  const remove = (before, after, label) => {
    source = exact(source, before, after, label);
    reviewed.push(label);
  };
  if (path === 'lib/city/navigation.ts') {
    remove(
      `export interface WalkSeatPose {
  id: string;
  floor: readonly [number, number, number];
  yaw: number;
  height: number;
  stand(): THREE.Vector3 | null;
}
`,
      '',
      'walk-seat contract',
    );
    remove(
      `  walkSeat: WalkSeatPose | null = null;
  sitOnSeat(seat: WalkSeatPose) {
    if (this.mode !== 'walk' || this.walkSeat ||
      ![...seat.floor, seat.yaw, seat.height].every(Number.isFinite)) return false;
    this.blur();
    this.walkSeat = seat;
    this.position.set(...seat.floor);
    // Keep the approach camera direction; only the seated body faces the chair.
    this.speed = 0;
    this.walker.setSeated?.(true, seat.height);
    this.update(0);
    return true;
  }
  leaveWalkSeat() {
    const seat = this.walkSeat;
    if (!seat) return true;
    const exit = seat.stand();
    if (!exit || !exit.toArray().every(Number.isFinite)) return false;
    this.walkSeat = null;
    this.walker.setSeated?.(false);
    this.blur();
    this.position.copy(exit);
    this.update(0);
    return true;
  }
`,
      '',
      'seat state and safe transitions',
    );
    remove(
      '    setSeated?(seated: boolean, seatHeight?: number): void;\n',
      '',
      'walker pose API',
    );
    for (const [method, signature, result] of [
      ['startAt', 'mode: TravelMode, point: PlacementPoint', ' false'],
      ['switchStreetMode', "mode: 'orbit' | TravelMode", ' false'],
      ['setMode', "mode: 'orbit' | TravelMode, streetName?: string", ''],
      ['startBridge', 'kind: string', ''],
    ]) {
      const opening = `  ${method}(${signature}) {\n`;
      remove(
        `${opening}    if (!this.leaveWalkSeat()) return${result};\n`,
        opening,
        `${method} safe stand guard`,
      );
    }
    for (const [method, signature] of [
      ['step', 'direction: string'],
      ['move', 'dx: number, dz: number'],
    ]) {
      const opening = `  ${method}(${signature}) {\n`;
      remove(
        `${opening}    if (this.walkSeat) return;\n`,
        opening,
        `${method} seated lock`,
      );
    }
    remove(
      '    } else if (!this.walkSeat) {\n      this.yaw += turn * dt * 1.45;',
      '    } else {\n      this.yaw += turn * dt * 1.45;',
      'walking frame seated lock',
    );
    remove(
      '    this.walker.group.rotation.set(0, this.walkSeat?.yaw ?? this.yaw, 0);',
      '    this.walker.group.rotation.y = this.yaw;',
      'seat-facing body and prior passenger tilt reset',
    );
    remove(
      `    const eyeHeight = this.mode === 'walk'
      ? this.walkSeat ? this.walkSeat.height + 0.78 : 1.68
      : this.driverEyeHeight;`,
      "    const eyeHeight = this.mode === 'walk' ? 1.68 : this.driverEyeHeight;",
      'seated walking eye height',
    );
    remove(
      '  walkingHeight() {\n    if (this.walkSeat) return this.walkSeat.floor[1];\n',
      '  walkingHeight() {\n',
      'seated foot datum',
    );
  } else if (path === 'lib/city/interiors.ts') {
    remove(
      "import type { WorldSeat } from './world-seats';\n",
      '',
      'interior seat type',
    );
    remove(
      `      const seats = (this.e.data.walkSeats ??= []) as WorldSeat[];
      const point = group.localToWorld(new THREE.Vector3(x, f, z));
      seats.push({ id: \`interior-seat:\${id}:\${x}:\${z}\`, floor: point.toArray(),
        yaw: site.yaw, height: 0.48,
        visible: () => group.visible && this.e.landmarks.visible,
      });
`,
      '',
      'authored interior bench registration',
    );
  } else {
    throw new Error(`No reviewed seating projection for ${path}`);
  }
  return { source, reviewed };
}

export function assertProtectedSources(sources, baselineHashes) {
  assert.deepEqual(
    Object.keys(sources).sort(),
    Object.keys(baselineHashes).sort(),
  );
  const sourceHashes = {},
    compatibility = [];
  for (const [path, source] of Object.entries(sources)) {
    const actualHash = sha(source),
      baselineHash = baselineHashes[path];
    sourceHashes[path] = actualHash;
    if (actualHash === baselineHash) continue;
    // A newer fixture may already include seating. Accept character-only
    // subtraction only when every remaining byte equals that exact baseline;
    // otherwise retain the original pre-seating compatibility gate.
    let projected = projectBeforeCharacter(path, source);
    let projectedHash = sha(projected.source);
    if (projectedHash !== baselineHash) {
      projected = projectBeforeSeating(path, source);
      projectedHash = sha(projected.source);
    }
    assert.equal(
      projectedHash,
      baselineHash,
      `Protected pre-seating source drift: ${path}`,
    );
    compatibility.push({
      path,
      baselineHash,
      actualHash,
      projectedHash,
      reviewed: projected.reviewed,
    });
  }
  return { sourceHashes, compatibility, reviewedBase: SEATING_REVIEW_BASE };
}
