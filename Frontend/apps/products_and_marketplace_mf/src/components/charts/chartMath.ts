/** How many grid bands the value axis is divided into. */
export const TICKS = 4;

/** The smallest "round" step (1, 2, 5, 10, 20, 50…) that fits the largest value in about four grid bands. */
export function niceStep(max: number): number {
  if (max <= 0) return 1;
  const raw = max / TICKS;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return Math.max(1, nice * magnitude);
}
