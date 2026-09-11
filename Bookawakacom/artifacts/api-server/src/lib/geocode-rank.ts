export interface GeocodeHit {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
  type?: string;
  class?: string;
  address?: Record<string, string>;
}

export type TypedNzAddress = {
  raw: string;
  unit: string | null;
  house: string | null;
  street: string | null;
  locality: string | null;
};

const STREET_WORD =
  /^(street|st|road|rd|avenue|ave|lane|ln|drive|dr|place|pl|crescent|cres|terrace|tce|way|close|cl|parade|pde|highway|hwy|boulevard|blvd|quay|mall|court|ct|track|grove|gr|rise|circuit|cct)$/i;

/** Parse NZ typed queries like `88 Dee Street Invercargill` or unit form `9/6 Dee Street`. */
export function parseTypedNzAddress(query: string): TypedNzAddress {
  const raw = String(query || "")
    .trim()
    .replace(/\s+/g, " ");
  const m = raw.match(/^(?:(\d+)\s*\/\s*)?(\d+[A-Za-z]?)\s+(.+)$/);
  if (!m) {
    return { raw, unit: null, house: null, street: null, locality: null };
  }
  const unit = m[1] || null;
  const house = m[2];
  const tokens = m[3]
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[.,]+$/g, ""))
    .filter(Boolean);
  let suffixIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (STREET_WORD.test(tokens[i])) suffixIdx = i;
  }
  let street: string | null = null;
  let locality: string | null = null;
  if (suffixIdx >= 0) {
    street = tokens.slice(0, suffixIdx + 1).join(" ");
    locality = tokens
      .slice(suffixIdx + 1)
      .join(" ")
      .replace(/\b(new zealand|nz|aotearoa)\b/gi, "")
      .trim() || null;
  } else {
    street = tokens[0] || null;
    locality = tokens.slice(1).join(" ").replace(/\b(new zealand|nz|aotearoa)\b/gi, "").trim() || null;
  }
  return { raw, unit, house, street, locality };
}

export function streetOnlyQuery(parsed: TypedNzAddress): string | null {
  if (!parsed.street) return null;
  const loc = parsed.locality || "Invercargill";
  return `${parsed.street} ${loc}`.replace(/\s+/g, " ").trim();
}

function normalizeHouse(s: string): string {
  return String(s || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function hitHouse(hit: GeocodeHit): string {
  return String(hit.address?.house_number || "").trim();
}

function hitRoad(hit: GeocodeHit): string {
  return String(hit.address?.road || hit.name || "").trim();
}

export function houseNumberMatches(hit: GeocodeHit, parsed: TypedNzAddress): boolean {
  if (!parsed.house) return false;
  const wantExact = normalizeHouse(parsed.unit ? `${parsed.unit}/${parsed.house}` : parsed.house);
  const wantStreet = normalizeHouse(parsed.house);
  const got = normalizeHouse(hitHouse(hit));
  const display = String(hit.display_name || "").toUpperCase();
  const displayCompact = display.replace(/\s+/g, "");

  if (parsed.unit) {
    return (
      got === wantExact ||
      displayCompact.startsWith(wantExact) ||
      display.startsWith(`${parsed.unit}/${parsed.house}`.toUpperCase())
    );
  }

  if (got && got.startsWith(wantStreet)) {
    const rest = got.slice(wantStreet.length);
    if (rest === "" || /^[A-Z]$/.test(rest)) return true;
    return false;
  }
  const houseToken = parsed.house.toUpperCase();
  if (display.startsWith(`${houseToken} `) || display.startsWith(`${houseToken},`)) return true;
  return false;
}

export function streetMatches(hit: GeocodeHit, parsed: TypedNzAddress): boolean {
  if (!parsed.street) return false;
  const street = parsed.street.toLowerCase();
  const core = street.replace(/\b(street|st|road|rd|avenue|ave|lane|ln|drive|dr|place|pl)\b/gi, "").trim();
  const blob = `${hitRoad(hit)} ${hit.display_name || ""}`.toLowerCase();
  if (core && blob.includes(core)) return true;
  return blob.includes(street);
}

export function scoreGeocodeHit(hit: GeocodeHit, parsed: TypedNzAddress): number {
  let score = 0;
  if (parsed.house && houseNumberMatches(hit, parsed)) score += 800;
  if (parsed.street && streetMatches(hit, parsed)) score += 200;
  if (parsed.locality) {
    const loc = parsed.locality.toLowerCase().split(/\s+/)[0];
    const blob = `${hit.display_name || ""} ${JSON.stringify(hit.address || {})}`.toLowerCase();
    if (loc && blob.includes(loc)) score += 50;
  }
  return score;
}

export function rankGeocodeHits(hits: GeocodeHit[], query: string): GeocodeHit[] {
  const parsed = parseTypedNzAddress(query);
  return [...hits].sort((a, b) => scoreGeocodeHit(b, parsed) - scoreGeocodeHit(a, parsed));
}

export function typedHouseUnresolved(query: string, hits: GeocodeHit[]): boolean {
  const parsed = parseTypedNzAddress(query);
  if (!parsed.house) return false;
  return !hits.some((h) => houseNumberMatches(h, parsed));
}

function hashPlaceId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return 900000000 + Math.abs(h % 99999999);
}

/** Bookable stand-in when OSM has the street but not the typed house number. */
export function makeCanonicalHit(query: string, donor: GeocodeHit): GeocodeHit {
  const parsed = parseTypedNzAddress(query);
  const houseLine = parsed.house
    ? `${parsed.unit ? `${parsed.unit}/` : ""}${parsed.house}${parsed.street ? ` ${parsed.street}` : ""}`.trim()
    : parsed.raw;
  const locality = parsed.locality || donor.address?.city || donor.address?.town || "Invercargill";
  return {
    place_id: hashPlaceId(`canon:${query.toLowerCase()}`),
    display_name: [houseLine, locality, "New Zealand"].filter(Boolean).join(", "),
    lat: donor.lat,
    lon: donor.lon,
    type: "house",
    class: "place",
    address: {
      house_number: parsed.unit && parsed.house ? `${parsed.unit}/${parsed.house}` : parsed.house || "",
      road: parsed.street || donor.address?.road || "",
      city: locality,
      country: "New Zealand",
    },
  };
}

export function finalizeGeocodeHits(query: string, hits: GeocodeHit[], limit = 8): GeocodeHit[] {
  const parsed = parseTypedNzAddress(query);
  const ranked = rankGeocodeHits(hits, query);
  if (parsed.house && ranked.length > 0 && !ranked.some((h) => houseNumberMatches(h, parsed))) {
    const donor = ranked.find((h) => streetMatches(h, parsed)) || ranked[0];
    ranked.unshift(makeCanonicalHit(query, donor));
  }
  const seen = new Set<number>();
  const out: GeocodeHit[] = [];
  for (const h of ranked) {
    const id = Number(h.place_id);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}
