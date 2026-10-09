import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export type InteractiveMotion =
  | 'idle'
  | 'walk'
  | 'look'
  | 'yield'
  | 'guide'
  | 'sit';
export interface InteractiveTemplate {
  root: THREE.Object3D;
  clips: readonly THREE.AnimationClip[];
}
export interface InteractivePose {
  actorId: string;
  appearanceId: string;
  motion: InteractiveMotion;
  phase: number;
  position: readonly [number, number, number];
  quaternion: readonly [number, number, number, number];
}
interface Entry {
  appearanceId: string;
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  motion: InteractiveMotion;
  action: THREE.AnimationAction;
}
const motions: readonly InteractiveMotion[] = [
  'idle',
  'walk',
  'look',
  'yield',
  'guide',
  'sit',
];
/** Source-only candidate. One instance consumes the selector's GLOBAL skeleton
 * allocation (max 4); it never independently selects or spawns city actors.
 * Caller retains actor identities/phase and owns shared template meshes/materials.
 * This module is intentionally not imported by the city engine or main app. */
export class InteractiveRendererCandidate {
  readonly root = new THREE.Group();
  private entries = new Map<string, Entry>();
  private disposed = false;
  constructor(
    private readonly templates: ReadonlyMap<string, InteractiveTemplate>,
    readonly capacity: number,
  ) {
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > 4)
      throw new Error('Invalid global skeleton allocation');
    if (templates.size > 4)
      throw new Error('Only four shared silhouettes are supported');
    for (const template of templates.values()) {
      if (
        template.clips.length !== motions.length ||
        template.clips.some(
          (clip) => !Number.isFinite(clip.duration) || clip.duration <= 0,
        ) ||
        motions.some(
          (name) =>
            template.clips.filter((clip) => clip.name === name).length !== 1,
        )
      )
        throw new Error('Missing or ambiguous animation clip');
    }
  }
  /** Atomic metadata validation before changes. phase is normalized [0,1).
   * An existing actor cannot silently change its silhouette during upgrade. */
  sync(poses: readonly InteractivePose[]): void {
    if (this.disposed) throw new Error('Renderer disposed');
    if (poses.length > this.capacity)
      throw new Error('Global skeleton cap exceeded');
    const ids = new Set<string>();
    for (const pose of poses) {
      if (
        !pose.actorId ||
        ids.has(pose.actorId) ||
        !this.templates.has(pose.appearanceId) ||
        !motions.includes(pose.motion) ||
        !Number.isFinite(pose.phase) ||
        pose.phase < 0 ||
        pose.phase >= 1 ||
        pose.position.length !== 3 ||
        !pose.position.every(Number.isFinite) ||
        pose.quaternion.length !== 4 ||
        !pose.quaternion.every(Number.isFinite) ||
        Math.abs(Math.hypot(...pose.quaternion) - 1) > 1e-5
      )
        throw new Error('Invalid actor pose');
      ids.add(pose.actorId);
      const entry = this.entries.get(pose.actorId);
      if (entry && entry.appearanceId !== pose.appearanceId)
        throw new Error('Actor silhouette changed');
    }
    // Prepare all clones before discarding previous valid actors.
    const additions = new Map<string, Entry>();
    try {
      for (const pose of poses) {
        if (this.entries.has(pose.actorId)) continue;
        const template = this.templates.get(pose.appearanceId)!;
        const root = clone(template.root);
        root.name = `interactive-${pose.actorId}`;
        root.traverse((object) => {
          object.castShadow = false;
          // At most four selected skins. Until pose-envelope WebGL acceptance,
          // never cull animated limbs against a stale rest-pose sphere.
          if (object instanceof THREE.SkinnedMesh) object.frustumCulled = false;
        });
        const mixer = new THREE.AnimationMixer(root);
        const action = mixer.clipAction(
          template.clips.find((c) => c.name === pose.motion)!,
        );
        additions.set(pose.actorId, {
          appearanceId: pose.appearanceId,
          root,
          mixer,
          action,
          motion: pose.motion,
        });
      }
    } catch (error) {
      for (const entry of additions.values()) this.release(entry);
      throw error;
    }
    for (const [id, entry] of this.entries)
      if (!ids.has(id)) {
        this.release(entry);
        this.entries.delete(id);
      }
    for (const [id, entry] of additions) {
      this.entries.set(id, entry);
      this.root.add(entry.root);
    }
    for (const pose of poses) {
      const entry = this.entries.get(pose.actorId)!;
      if (entry.motion !== pose.motion) {
        entry.action.stop();
        entry.action = entry.mixer.clipAction(
          this.templates
            .get(pose.appearanceId)!
            .clips.find((c) => c.name === pose.motion)!,
        );
        entry.motion = pose.motion;
      }
      entry.root.position.fromArray(pose.position);
      entry.root.quaternion.fromArray(pose.quaternion);
      entry.action.play();
      entry.action.time = pose.phase * entry.action.getClip().duration;
      // The simulation owns phase, including pause/hidden-tab handling. No
      // accumulated wall clock, catch-up or duplicate AI tick lives here.
      entry.mixer.update(0);
      entry.root.updateMatrixWorld(true);
    }
  }
  get size(): number {
    return this.entries.size;
  }
  private release(entry: Entry): void {
    entry.mixer.stopAllAction();
    entry.mixer.uncacheRoot(entry.root);
    const skeletons = new Set<THREE.Skeleton>();
    entry.root.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    });
    for (const skeleton of skeletons) skeleton.dispose();
    entry.root.removeFromParent();
    // Shared geometry/material/texture ownership remains with template lease.
  }
  dispose(): void {
    if (this.disposed) return;
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
    this.disposed = true;
  }
}
