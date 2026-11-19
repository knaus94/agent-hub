import type { Limit } from '../../shared/protocol.ts';

// A forecast waits for half a day of spending: one busy hour says little about the week.
const FORECAST_AFTER = 12 * 3600_000;

export type LimitLevel = 'ok' | 'high' | 'full';

export function limitLevel(percent: number): LimitLevel {
   return percent >= 90 ? 'full' : percent >= 70 ? 'high' : 'ok';
}

// expected is where an even pace through the window would be now, in percent; runsOut is when the pace so far spends
// the limit, if that comes before it resets.
export function limitPace(limit: Limit, now: number) {
   const left = limit.resetsAt - now;
   const elapsed = limit.window - left;
   if (!limit.resetsAt || left <= 0 || elapsed <= 0) return null;
   const finish =
      elapsed >= FORECAST_AFTER && limit.percent > 0 && limit.percent < 100 ? now + ((100 - limit.percent) * elapsed) / limit.percent : null;
   return { expected: (elapsed / limit.window) * 100, runsOut: finish !== null && finish < limit.resetsAt ? finish : null };
}
