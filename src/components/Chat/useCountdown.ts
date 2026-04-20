import { useEffect, useState } from 'react';

/**
 * Returns remaining seconds until `untilMs` (epoch ms), ticking every second.
 * Returns 0 when expired, null when no target was provided.
 *
 * Clock skew safety: if untilMs is already in the past at first render we
 * still return 0 (rather than a negative or null) so the caller can show
 * a frozen badge without a countdown number.
 */
export function useCountdown(untilMs: number | undefined): number | null {
  const [remaining, setRemaining] = useState<number | null>(() => {
    if (untilMs === undefined) return null;
    return Math.max(0, Math.round((untilMs - Date.now()) / 1000));
  });

  useEffect(() => {
    if (untilMs === undefined) {
      setRemaining(null);
      return;
    }
    const tick = () => {
      const next = Math.max(0, Math.round((untilMs - Date.now()) / 1000));
      setRemaining(next);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [untilMs]);

  return remaining;
}
