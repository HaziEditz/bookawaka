/** Website auto sign-out after genuine inactivity. Live trip tracking is not idle. */

export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

const LIVE_TRIP_STATUSES = new Set([
  "offered",
  "offer",
  "assigned",
  "accepted",
  "enroute",
  "en route",
  "picking",
  "arrived",
  "ontrip",
  "on trip",
  "started",
  "active",
  "reassigned",
]);

export function isLiveTripStatus(status: string | null | undefined): boolean {
  return LIVE_TRIP_STATUSES.has(String(status || "").trim().toLowerCase());
}

export function isLiveTripTrackingPath(pathname: string): boolean {
  const p = String(pathname || "").replace(/\/+$/, "") || "/";
  return p === "/my-rides" || p.endsWith("/my-rides") || p === "/tow/track" || p.endsWith("/tow/track");
}

export function shouldHoldIdleForLiveTracking(opts: {
  pathname: string;
  liveTripVisible: boolean;
}): boolean {
  if (!opts.liveTripVisible) return false;
  return isLiveTripTrackingPath(opts.pathname);
}

export function isIdleExpired(lastActivityMs: number, nowMs: number, holdLiveTracking: boolean): boolean {
  if (holdLiveTracking) return false;
  return nowMs - lastActivityMs >= IDLE_TIMEOUT_MS;
}
