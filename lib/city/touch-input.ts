/** A circular stick with a small dead zone; x points right, y points forward. */
export function stickAxes(dx: number, dy: number, radius = 44) {
  if (![dx, dy, radius].every(Number.isFinite) || radius <= 0)
    return { x: 0, y: 0 };
  const length = Math.hypot(dx, dy),
    magnitude = Math.min(1, length / radius);
  if (magnitude <= 0.12) return { x: 0, y: 0 };
  const strength = (magnitude - 0.12) / 0.88;
  return { x: (dx / length) * strength, y: (-dy / length) * strength };
}
export function safeTouchAxis(value: number) {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}
