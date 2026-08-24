/**
 * Dispatch lead-time estimate — mirrors INVT `_estimateDispatchLeadMins`
 * and the dispatcher Default.aspx updateDispatchSuggestion formula:
 *   3 min/km, min 5, snapped to [0,5,10,15,20,30,45,60,75,90,120].
 * No GPS → 30.
 */

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const SNAP_OPTS = [0, 5, 10, 15, 20, 30, 45, 60, 75, 90, 120];

/** Auckland fallback when company has no depot coords (same as INVT). */
const DEFAULT_BASE = { lat: -36.8485, lng: 174.7633 };

export function estimateDispatchLeadMins(
  pickLat: number | undefined | null,
  pickLng: number | undefined | null,
  base?: { lat: number; lng: number } | null,
): number {
  const plat = Number(pickLat);
  const plng = Number(pickLng);
  if (!Number.isFinite(plat) || !Number.isFinite(plng) || plat === 0 || plng === 0) {
    return 30;
  }
  const from = base && Number.isFinite(base.lat) && Number.isFinite(base.lng) ? base : DEFAULT_BASE;
  const dist = haversineKm(from.lat, from.lng, plat, plng);
  const rawMins = Math.max(5, Math.ceil(dist * 3));
  return SNAP_OPTS.reduce((p, c) => (Math.abs(c - rawMins) < Math.abs(p - rawMins) ? c : p));
}
