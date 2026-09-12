/** Owner Panel vehicle types: Firebase `vehicleTypes/{companyId}/{id}`. */

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

export function parseCompanyVehicleTypes(raw: unknown): CompanyVehicleType[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: CompanyVehicleType[] = [];
  for (const [id, row] of Object.entries(raw as Record<string, unknown>)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const v = row as Record<string, unknown>;
    if (v.active === false) continue;
    const name = String(v.name ?? id).trim();
    if (!name) continue;
    const cap = parseInt(String(v.capacity ?? 4), 10);
    out.push({
      id,
      name,
      capacity: Number.isFinite(cap) && cap > 0 ? cap : 4,
      description: v.description != null && String(v.description).trim() ? String(v.description).trim() : undefined,
    });
  }
  out.sort((a, b) => a.capacity - b.capacity || a.name.localeCompare(b.name));
  return out;
}

/**
 * Stamp the passenger's explicit type. 5+ pax must stay a van-class name
 * (keep Owner Panel "6-seater Van" — do not rewrite it to generic "Van").
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
