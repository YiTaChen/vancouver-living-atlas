/** World-space interaction contracts. Providers own object-specific geometry,
 * visibility/occlusion and safe transitions; this controller owns selection and
 * one authoritative action dispatch, shared by keyboard and touch controls. */
export type InteractionPoint = readonly [number, number, number];
export type InteractionKind = 'seat' | 'object' | 'person' | 'scene';
export interface InteractionCandidate {
  /** Stable within this provider. Reused IDs may not change action mid-press. */
  id: string;
  kind: InteractionKind;
  /** Localized action key, e.g. sit/stand/use/talk/inspect. */
  action: string;
  /** Visual prompt anchor in world space. */
  anchor: InteractionPoint;
  /** Physical range anchor, defaulting to anchor. Origin is the player's feet. */
  proximityPoint?: InteractionPoint;
  range: number;
  /** Explicit context priority; seated stand actions can override nearby seats. */
  priority?: number;
  /** Provider checks for occupancy, occlusion, correct floor and safe exits. */
  canInteract?(): boolean;
  execute(): boolean;
}
export interface InteractionPromptSnapshot {
  id: string;
  kind: InteractionKind;
  action: string;
  anchor: InteractionPoint;
  distance: number;
}
export type InteractionProvider = () => readonly InteractionCandidate[];
interface Selection {
  provider: string;
  candidate: InteractionCandidate;
  distance: number;
  priority: number;
}
const finitePoint = (point: InteractionPoint | undefined) =>
  Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const separation = (a: InteractionPoint, b: InteractionPoint) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const kinds = new Set<string>(['seat', 'object', 'person', 'scene']);
const sameSelection = (a: Selection, b: Selection) =>
  a.provider === b.provider &&
  a.candidate.id === b.candidate.id &&
  a.candidate.action === b.candidate.action;

export class ProximityInteractionController {
  private readonly providers = new Map<string, InteractionProvider>();
  private origin: InteractionPoint | null = null;
  private enabled = false;
  private selected: Selection | null = null;
  private disposed = false;
  private executing = false;
  constructor(private readonly hysteresis = 0.25) {}

  registerProvider(id: string, provider: InteractionProvider): () => void {
    if (this.disposed) return () => {};
    if (!id || this.providers.has(id))
      throw new Error('Interaction provider IDs must be unique and nonempty');
    this.providers.set(id, provider);
    return () => {
      if (this.providers.get(id) !== provider) return;
      this.providers.delete(id);
      if (this.selected?.provider === id) this.selected = null;
    };
  }

  update(origin: InteractionPoint | null, enabled = true) {
    this.enabled =
      enabled && !this.disposed && finitePoint(origin ?? undefined);
    this.origin = this.enabled && origin ? [...origin] : null;
    if (!this.enabled) {
      this.selected = null;
      return null;
    }
    const candidates = this.resolve();
    let next = candidates[0] ?? null;
    const previous =
      this.selected &&
      candidates.find((row) => sameSelection(row, this.selected!));
    const margin = Number.isFinite(this.hysteresis)
      ? Math.max(0, Math.min(0.5, this.hysteresis))
      : 0;
    if (
      next &&
      previous &&
      next.priority === previous.priority &&
      previous.distance <= next.distance + margin
    )
      next = previous;
    this.selected = next;
    return this.snapshot();
  }

  snapshot(): InteractionPromptSnapshot | null {
    if (!this.enabled || !this.selected || this.disposed) return null;
    const { candidate, distance } = this.selected;
    return {
      id: candidate.id,
      kind: candidate.kind,
      action: candidate.action,
      anchor: [...candidate.anchor],
      distance,
    };
  }

  /** Requery the current provider before dispatch. A disappearing/moving/claimed
   * seat cannot execute a stale callback or accidentally trigger another object. */
  execute(): boolean {
    if (!this.enabled || this.disposed || this.executing || !this.selected)
      return false;
    const previous = this.selected;
    const current = this.resolve().find((row) => sameSelection(row, previous));
    if (!current) {
      this.selected = null;
      return false;
    }
    this.selected = current;
    this.executing = true;
    try {
      const accepted = current.candidate.execute() === true;
      if (accepted) this.selected = null;
      return accepted;
    } catch {
      this.selected = null;
      return false;
    } finally {
      this.executing = false;
    }
  }

  clear() {
    this.selected = null;
    this.origin = null;
    this.enabled = false;
  }
  dispose() {
    this.disposed = true;
    this.clear();
    this.providers.clear();
  }

  private resolve(): Selection[] {
    if (!this.origin || !this.enabled || this.disposed) return [];
    const result: Selection[] = [];
    for (const [providerId, provider] of this.providers) {
      try {
        const rows = provider();
        const seen = new Set<string>();
        const duplicate = new Set<string>();
        for (const candidate of rows) {
          if (seen.has(candidate.id)) duplicate.add(candidate.id);
          seen.add(candidate.id);
        }
        for (const candidate of rows) {
          if (
            !candidate.id ||
            duplicate.has(candidate.id) ||
            !candidate.action ||
            !kinds.has(candidate.kind) ||
            typeof candidate.execute !== 'function' ||
            !finitePoint(candidate.anchor) ||
            !finitePoint(candidate.proximityPoint ?? candidate.anchor) ||
            !Number.isFinite(candidate.range) ||
            candidate.range <= 0
          )
            continue;
          const distance = separation(
            this.origin,
            candidate.proximityPoint ?? candidate.anchor,
          );
          if (distance > candidate.range) continue;
          try {
            if (candidate.canInteract && !candidate.canInteract()) continue;
          } catch {
            continue;
          }
          result.push({
            provider: providerId,
            // Providers may reuse mutable descriptors. Preserve the selected
            // identity/action until the next query so stale F presses cannot
            // become a different action just because that object was mutated.
            candidate: {
              ...candidate,
              anchor: [...candidate.anchor],
              proximityPoint: candidate.proximityPoint
                ? [...candidate.proximityPoint]
                : undefined,
            },
            distance,
            priority: Number.isFinite(candidate.priority)
              ? candidate.priority!
              : 0,
          });
        }
      } catch {
        // A failed optional scene provider cannot break every city interaction.
      }
    }
    return result.sort(
      (a, b) =>
        b.priority - a.priority ||
        a.distance - b.distance ||
        a.provider.localeCompare(b.provider) ||
        a.candidate.id.localeCompare(b.candidate.id),
    );
  }
}

/** Kept independent of the window listener so every host uses identical guards. */
export function shouldHandleInteractionKey(event: KeyboardEvent): boolean {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    (event.code !== 'KeyF' && event.key.toLowerCase() !== 'f')
  )
    return false;
  const target = event.target;
  if (typeof Element !== 'undefined' && target instanceof Element)
    return !target.closest(
      'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="listbox"],dialog,[role="dialog"]',
    );
  return true;
}
