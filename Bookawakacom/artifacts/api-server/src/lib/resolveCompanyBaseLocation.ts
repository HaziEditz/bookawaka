import { getDatabase } from "./firebase";

/**
 * Company depot / base for dispatch lead-time — mirrors INVT `_companyBaseLocation`
 * + `_cityCenterFromArea` (registration baseLat/baseLng, then city lookup, then Auckland).
 */

export type LatLng = { lat: number; lng: number };

const AUCKLAND_FALLBACK: LatLng = { lat: -36.8485, lng: 174.7633 };

const CITY_CENTERS: { keys: string[]; lat: number; lng: number }[] = [
  { keys: ["invercargill"], lat: -46.4127, lng: 168.3538 },
  { keys: ["auckland"], lat: -36.8485, lng: 174.7633 },
  { keys: ["wellington"], lat: -41.2865, lng: 174.7762 },
  { keys: ["christchurch"], lat: -43.5321, lng: 172.6362 },
  { keys: ["hamilton"], lat: -37.787, lng: 175.2793 },
  { keys: ["tauranga"], lat: -37.6878, lng: 176.1651 },
  { keys: ["dunedin"], lat: -45.8788, lng: 170.5028 },
  { keys: ["queenstown"], lat: -45.0312, lng: 168.6626 },
];

export function cityCenterFromArea(areaRaw: string | undefined | null): LatLng | null {
  const area = String(areaRaw || "")
    .trim()
    .toLowerCase();
  if (!area) return null;
  for (const row of CITY_CENTERS) {
    if (row.keys.some((k) => area.includes(k))) return { lat: row.lat, lng: row.lng };
  }
  return null;
}

function readBaseCoords(obj: Record<string, unknown> | null | undefined): LatLng | null {
  if (!obj || typeof obj !== "object") return null;
  // Match INVT registration depot fields only — do not treat generic lat/lng as base.
  const lat = Number(obj.baseLat ?? obj.BaseLat ?? obj.depotLat ?? obj.DepotLat);
  const lng = Number(obj.baseLng ?? obj.BaseLng ?? obj.depotLng ?? obj.DepotLng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
    return { lat, lng };
  }
  return null;
}

function readCityArea(obj: Record<string, unknown> | null | undefined): string {
  if (!obj || typeof obj !== "object") return "";
  return String(obj.area ?? obj.Area ?? obj.city ?? obj.City ?? "").trim();
}

/**
 * Resolve company base for lead-time estimate.
 * Prefer explicit depot coords on profiles/settings/superClients, then city/area
 * lookup (same table as INVT), else Auckland.
 */
export async function resolveCompanyBaseLocation(
  companyId: string | undefined | null,
): Promise<LatLng> {
  const cid = String(companyId || "").trim();
  if (!cid) return AUCKLAND_FALLBACK;

  try {
    const db = getDatabase();
    const [profileSnap, settingsSnap, superSnap] = await Promise.all([
      db.ref(`companyProfiles/${cid}`).once("value"),
      db.ref(`companySettings/${cid}`).once("value"),
      db.ref(`superClients/${cid}`).once("value"),
    ]);
    const profile = (profileSnap.val() || {}) as Record<string, unknown>;
    const settings = (settingsSnap.val() || {}) as Record<string, unknown>;
    const superClient = (superSnap.val() || {}) as Record<string, unknown>;

    for (const src of [profile, settings, superClient]) {
      const coords = readBaseCoords(src);
      if (coords) return coords;
    }
    for (const src of [profile, settings, superClient]) {
      const fromCity = cityCenterFromArea(readCityArea(src));
      if (fromCity) return fromCity;
    }
  } catch {
    /* fall through */
  }
  return AUCKLAND_FALLBACK;
}
