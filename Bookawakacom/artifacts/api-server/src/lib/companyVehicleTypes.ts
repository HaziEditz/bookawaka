/** Booking options from the real fleet (`vehicles`), not Settings → Vehicle Types. */

export type CompanyVehicleType = {
  id: string;
  name: string;
  capacity: number;
  description?: string;
};

export function vehicleTypeLooksLikeVan(name: string): boolean {
  const s = String(name || "").toLowerCase();
  return /van|minibus|wav|wheelchair|accessible/.test(s);
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function looksLikeVehicleRecord(rec: Record<string, unknown>): boolean {
  return (
    "vehicleType" in rec ||
    "VehicleType" in rec ||
    "vehicleTypeCode" in rec ||
    "vehicleClass" in rec ||
    "vehicletype" in rec ||
    "taxiNumber" in rec ||
    "vehicleNo" in rec ||
    "vehicleNumber" in rec ||
    "seatCapacity" in rec ||
    "cofNumber" in rec ||
    "make" in rec
  );
}

function fleetVehicleActive(rec: Record<string, unknown>): boolean {
  if (rec.active === false) return false;
  const status = String(rec.status ?? rec.Status ?? "active").toLowerCase();
  return !["inactive", "maintenance", "disabled", "suspended"].includes(status);
}

/** Prefer the live fleet field over leftover VehicleType aliases. */
function fleetTypeName(rec: Record<string, unknown>): string {
  return String(
    rec.vehicleType ??
      rec.vehicleTypeCode ??
      rec.vehicleClass ??
      rec.VehicleClass ??
      rec.VehicleType ??
      rec.vehicletype ??
      "",
  ).trim();
}

function fleetSeats(rec: Record<string, unknown>): number {
  const n = parseInt(
    String(
      rec.seatCapacity ??
        rec.SeatCapacity ??
        rec.seats ??
        rec.Seats ??
        rec.passengerCapacity ??
        rec.PassengerCapacity ??
        rec.capacity ??
        rec.Capacity ??
        0,
    ),
    10,
  );
  return Number.isFinite(n) && n > 0 ? n : 4;
}

function fleetTaxiNo(rec: Record<string, unknown>, fallback: string): string {
  return String(
    rec.taxiNumber ?? rec.vehicleNo ?? rec.vehicleNumber ?? rec.vehiclenumber ?? fallback,
  ).trim();
}

function typeIdFromName(name: string): string {
  const id = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
  return id || name;
}

/**
 * Unique bookable types from this company's real vehicles.
 * Dedupes nested `vehicles/{cid}/{taxi}` and push-id fleet rows.
 * Catalog `vehicleTypes/{cid}` is Owner Panel add-vehicle menu only — ignored here.
 */
export function parseFleetVehicleTypes(
  vehiclesRoot: unknown,
  companyId: string,
): CompanyVehicleType[] {
  const cid = String(companyId || "").trim();
  if (!cid) return [];
  const root = asRecord(vehiclesRoot);
  if (!root) return [];

  const seenTaxi = new Set<string>();
  const byName = new Map<string, CompanyVehicleType>();

  function take(rec: Record<string, unknown>, fallbackKey: string) {
    const recCid = String(rec.companyId ?? rec.companyID ?? rec.CompanyId ?? rec.company_id ?? "").trim();
    if (recCid && recCid !== cid) return;
    if (!fleetVehicleActive(rec)) return;
    const name = fleetTypeName(rec);
    if (!name) return;
    const taxi = fleetTaxiNo(rec, fallbackKey).toUpperCase();
    const dedupe = `${cid}:${taxi || fallbackKey}`;
    if (seenTaxi.has(dedupe)) return;
    seenTaxi.add(dedupe);
    const capacity = fleetSeats(rec);
    const prev = byName.get(name);
    if (!prev || capacity > prev.capacity) {
      const make = String(rec.make ?? rec.Make ?? "").trim();
      const model = String(rec.model ?? rec.Model ?? "").trim();
      const description = [make, model].filter(Boolean).join(" ") || undefined;
      byName.set(name, {
        id: typeIdFromName(name),
        name,
        capacity,
        description,
      });
    }
  }

  for (const [key, raw] of Object.entries(root)) {
    const rec = asRecord(raw);
    if (!rec) continue;
    if (looksLikeVehicleRecord(rec)) {
      take(rec, key);
      continue;
    }
    if (key !== cid) continue;
    for (const [innerKey, innerRaw] of Object.entries(rec)) {
      const inner = asRecord(innerRaw);
      if (!inner) continue;
      take({ ...inner, companyId: inner.companyId ?? cid }, innerKey);
    }
  }

  return [...byName.values()].sort(
    (a, b) => a.capacity - b.capacity || a.name.localeCompare(b.name),
  );
}

/**
 * Stamp the passenger's explicit type. 5+ pax must stay a van-class name
 * (keep fleet "6-seater Van" — do not rewrite it to generic "Van").
 */
export function resolveBookingVehicleType(opts: {
  vehicleType?: string;
  passengers: number;
}): string {
  let resolved = String(opts.vehicleType || "").trim();
  if (/^(any|not\s*specified|all)$/i.test(resolved)) resolved = "";
  if (opts.passengers >= 5 && !vehicleTypeLooksLikeVan(resolved)) {
    resolved = "Van";
  }
  return resolved;
}
