/** Geometry randomness is split by purpose. Adding leaves must never move the
 * next primary branch when a tree crosses a detail threshold. */
export function treeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

export function treeClusterSeed(
  variant: number,
  x: number,
  y: number,
  z: number,
) {
  return (
    (Math.imul(Math.round(x * 100000), 73856093) ^
      Math.imul(Math.round(y * 100000), 19349663) ^
      Math.imul(Math.round(z * 100000), 83492791) ^
      ((variant + 1) * 12347)) >>>
    0
  );
}

/** Nested sample sets keep the same leaf sprays when detail increases. */
export function treeSprayIndices(conifer: boolean, ultra: boolean) {
  if (conifer) return ultra ? [0, 1, 2, 3, 4] : [0, 2, 4];
  return ultra ? Array.from({ length: 12 }, (_, i) => i) : [0, 3, 6, 9];
}

/** Existing medium tier population; Ultra adds twigs on these same boughs. */
export const CONIFER_PRIMARY_BOUGHS = [4, 4, 4, 3, 2] as const;
