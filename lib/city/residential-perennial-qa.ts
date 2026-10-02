/** LOCAL VISUAL QA: opt-in Blender perennial comparison; never a production feature. */
import { residentialPerennial } from './assets/residential-perennial';

export function createPerennialQAEvidence(search: string) {
  const values = new URLSearchParams(search).getAll('qaPerennial');
  const variant = values.length === 1 ? values[0] : null;
  if (variant !== 'baseline' && variant !== 'blender') return null;
  return {
    marker: 'residential-perennial-qa-v1',
    variant,
    beds: [] as {
      sourceId: string;
      cell: string;
      positions: number[];
    }[],
    plants: [] as {
      sourceId: string;
      cell: string;
      center: number[];
      seed: number;
      firstVertex: number;
    }[],
  };
}

/** Same shared batch/material/21 corners; no loader, resource, listener or timer. */
export function appendBlenderPerennialQA(
  batch: { positions: number[]; colors: number[] },
  x: number,
  z: number,
  base: number,
  seed: number,
  sample: (x: number, z: number, fallback: number) => number | undefined,
  tint: { r: number; g: number; b: number },
) {
  const plant = residentialPerennial(x, z, base, seed, sample);
  batch.positions.push(...plant.positions);
  for (let i = 0; i < plant.colors.length; i += 3)
    batch.colors.push(
      tint.r * plant.colors[i],
      tint.g * plant.colors[i + 1],
      tint.b * plant.colors[i + 2],
    );
}
