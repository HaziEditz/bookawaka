/** Company vehicle types from Owner Panel (`vehicleTypes/{cid}` via GET /companies). */

export const ANY_VEHICLE = "Any";

export type CompanyVehicleType = {
  id: string;
  name: string;
  capacity: number;
  description?: string;
};

export function parseCompanyVehicleTypesFromApi(raw: unknown): CompanyVehicleType[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Record<string, unknown> => row != null && typeof row === "object")
    .map((row) => {
      const cap = parseInt(String(row.capacity ?? 4), 10);
      return {
        id: String(row.id ?? row.name ?? ""),
        name: String(row.name ?? "").trim(),
        capacity: Number.isFinite(cap) && cap > 0 ? cap : 4,
        description: row.description != null ? String(row.description) : undefined,
      };
    })
    .filter((row) => row.name);
}

export function vehicleTypeLooksLikeVan(name: string): boolean {
  const s = String(name || "").toLowerCase();
  return /van|minibus|wav|wheelchair|accessible/.test(s);
}

/** 5+ passengers: first Owner Panel type that seats them, preferring van-class. */
export function pickForcedVehicleForPax(types: CompanyVehicleType[], pax: number): string | null {
  if (pax < 5) return null;
  const fit = types.filter((t) => t.capacity >= pax);
  const pool = fit.length ? fit : [...types];
  if (!pool.length) return "Van";
  const van = pool.find((t) => vehicleTypeLooksLikeVan(t.name));
  return (van ?? pool[pool.length - 1])!.name;
}

export function farePurposeForVehicle(opts: {
  vehicleName: string;
  passengers: number;
  paymentMethod: string;
}): "Van" | "Standard" | "Total Mobility" {
  if (opts.paymentMethod === "tm") return "Total Mobility";
  if (opts.passengers >= 5 || vehicleTypeLooksLikeVan(opts.vehicleName)) return "Van";
  return "Standard";
}

export function vehicleOptionLabel(name: string, capacity?: number): string {
  if (name === ANY_VEHICLE) return "Any";
  if (capacity && capacity > 0 && !/\d[\s-]*seat/i.test(name)) {
    return `${name} (${capacity} seat${capacity === 1 ? "" : "s"})`;
  }
  return name;
}
