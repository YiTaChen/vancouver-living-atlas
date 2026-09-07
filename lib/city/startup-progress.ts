/** Weighted completion milestones, not downloaded-byte or remaining-time estimates.
 * Yield after publishing a milestone so synchronous geometry cannot hide every
 * intermediate update behind a single long browser task. Hidden tabs use a timer.
 */
export async function paintStartupProgress(
  percent: number,
  report: (percent: number) => void,
  cancelled: () => boolean,
): Promise<boolean> {
  if (cancelled()) return false;
  report(percent);
  await new Promise<void>((resolve) => {
    let frame = 0;
    let afterFrame: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      cancelAnimationFrame(frame);
      clearTimeout(fallback);
      clearTimeout(afterFrame);
      resolve();
    };
    const fallback = setTimeout(finish, 80);
    frame = requestAnimationFrame(() => {
      afterFrame = setTimeout(finish, 0);
    });
  });
  return !cancelled();
}
