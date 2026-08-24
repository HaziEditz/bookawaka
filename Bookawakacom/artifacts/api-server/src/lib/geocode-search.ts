/**
 * NZ place search with policy-compliant Nominatim use + optional LocationIQ.
 *
 * Nominatim (operations.osmfoundation.org/policies/nominatim):
 *  - Valid identifying User-Agent + Referer (not a stock HTTP client UA)
 *  - Absolute max 1 request / second (app-wide)
 *  - Cache repeated queries
 *  - Public Nominatim forbids client-side autocomplete; when LOCATIONIQ_API_KEY
 *    is set we prefer LocationIQ (OSM-compatible free tier) for search.
 */

const NOMINATIM_TIMEOUT_MS = 8000;
const LOCATIONIQ_TIMEOUT_MS = 8000;
const DEFAULT_VIEWBOX = "167,-47,170,-45"; // Invercargill area bias
const MIN_INTERVAL_MS = 1100; // slightly over 1s to stay under Nominatim absolute max
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX = 500;

const NOMINATIM_HEADERS: Record<string, string> = {
  "User-Agent": "BookaWaka Booking Portal/1.0 (https://bookawaka.com; info@bookawaka.com)",
  Referer: "https://bookawaka.com/",
  "Accept-Language": "en",
  Accept: "application/json",
};

export interface NominatimHit {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
  type?: string;
  class?: string;
  address?: Record<string, string>;
}

export class GeocodeUpstreamError extends Error {
  status: number;
  provider: string;
  constructor(message: string, status: number, provider: string) {
    super(message);
    this.name = "GeocodeUpstreamError";
    this.status = status;
    this.provider = provider;
  }
}

type CacheEntry = { at: number; hits: NominatimHit[] };

const resultCache = new Map<string, CacheEntry>();
let nominatimChain: Promise<void> = Promise.resolve();
let lastNominatimAt = 0;

function cacheKey(provider: string, q: string, opts: Record<string, string | number | undefined>): string {
  return `${provider}|${q}|${opts.countrycodes || "nz"}|${opts.viewbox || DEFAULT_VIEWBOX}|${opts.bounded || "0"}|${opts.limit || 8}`;
}

function cacheGet(key: string): NominatimHit[] | null {
  const hit = resultCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    resultCache.delete(key);
    return null;
  }
  // LRU-ish: re-insert
  resultCache.delete(key);
  resultCache.set(key, hit);
  return hit.hits;
}

function cacheSet(key: string, hits: NominatimHit[]): void {
  if (resultCache.size >= CACHE_MAX) {
    const oldest = resultCache.keys().next().value;
    if (oldest) resultCache.delete(oldest);
  }
  resultCache.set(key, { at: Date.now(), hits });
}

function mergeHits(primary: NominatimHit[], secondary: NominatimHit[], max: number): NominatimHit[] {
  const seen = new Set<number>();
  const merged: NominatimHit[] = [];
  for (const hit of [...primary, ...secondary]) {
    const id = Number(hit.place_id);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    merged.push(hit);
    if (merged.length >= max) break;
  }
  return merged;
}

/** Serialise Nominatim calls and enforce ≥1.1s between upstream requests. */
function withNominatimThrottle<T>(fn: () => Promise<T>): Promise<T> {
  const run = nominatimChain.then(async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastNominatimAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatimAt = Date.now();
    return fn();
  });
  // Keep chain alive even if this call fails
  nominatimChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function fetchJsonHits(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  provider: string,
): Promise<NominatimHit[]> {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 429) {
    throw new GeocodeUpstreamError(
      "Address lookup is temporarily rate-limited. Please wait a moment and try again.",
      429,
      provider,
    );
  }
  if (!res.ok) {
    throw new GeocodeUpstreamError(
      `Address lookup failed (${provider} HTTP ${res.status}). Please try again.`,
      res.status,
      provider,
    );
  }
  const data = (await res.json()) as NominatimHit[];
  return Array.isArray(data) ? data : [];
}

async function nominatimSearch(
  q: string,
  opts: {
    countrycodes?: string;
    viewbox?: string;
    bounded?: string;
    limit?: number;
  },
): Promise<NominatimHit[]> {
  const key = cacheKey("nominatim", q, opts as Record<string, string | number | undefined>);
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("countrycodes", opts.countrycodes ?? "nz");
  url.searchParams.set("limit", String(opts.limit ?? 8));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("namedetails", "1");
  url.searchParams.set("dedupe", "1");
  url.searchParams.set("viewbox", opts.viewbox ?? DEFAULT_VIEWBOX);
  url.searchParams.set("bounded", opts.bounded ?? "0");

  const hits = await withNominatimThrottle(() =>
    fetchJsonHits(url.toString(), NOMINATIM_HEADERS, NOMINATIM_TIMEOUT_MS, "nominatim"),
  );
  cacheSet(key, hits);
  return hits;
}

async function locationIqSearch(
  q: string,
  opts: {
    countrycodes?: string;
    viewbox?: string;
    bounded?: string;
    limit?: number;
  },
  apiKey: string,
): Promise<NominatimHit[]> {
  const key = cacheKey("locationiq", q, opts as Record<string, string | number | undefined>);
  const cached = cacheGet(key);
  if (cached) return cached;

  // LocationIQ is Nominatim-compatible (OSM data). Free tier: 5,000 req/day.
  const url = new URL("https://us1.locationiq.com/v1/search");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("countrycodes", opts.countrycodes ?? "nz");
  url.searchParams.set("limit", String(opts.limit ?? 8));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("normalizecity", "1");
  if (opts.viewbox) {
    // LocationIQ viewbox: min_lon,max_lat,max_lon,min_lat (differs from Nominatim)
    // Our stored box is Nominatim form: left,top,right,bottom = minLon,maxLat,maxLon,minLat
    // which is already min_lon,max_lat,max_lon,min_lat — same order for LocationIQ.
    url.searchParams.set("viewbox", opts.viewbox);
    url.searchParams.set("bounded", opts.bounded === "1" ? "1" : "0");
  }

  const hits = await fetchJsonHits(
    url.toString(),
    {
      "User-Agent": NOMINATIM_HEADERS["User-Agent"],
      "Accept-Language": "en",
      Accept: "application/json",
    },
    LOCATIONIQ_TIMEOUT_MS,
    "locationiq",
  );
  cacheSet(key, hits);
  return hits;
}

async function photonSearch(
  q: string,
  opts: {
    limit?: number;
  },
): Promise<NominatimHit[]> {
  const key = cacheKey("photon", q, { limit: opts.limit ?? 8 });
  const cached = cacheGet(key);
  if (cached) return cached;

  // Photon is designed for typeahead (unlike public Nominatim, which forbids autocomplete).
  // Bias toward Invercargill CBD.
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(opts.limit ?? 8));
  url.searchParams.set("lang", "en");
  url.searchParams.set("lat", "-46.4132");
  url.searchParams.set("lon", "168.3538");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": NOMINATIM_HEADERS["User-Agent"],
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(LOCATIONIQ_TIMEOUT_MS),
  });
  if (res.status === 429 || res.status === 403) {
    throw new GeocodeUpstreamError(
      "Address lookup is temporarily rate-limited. Please wait a moment and try again.",
      res.status,
      "photon",
    );
  }
  if (!res.ok) {
    throw new GeocodeUpstreamError(
      `Address lookup failed (photon HTTP ${res.status}). Please try again.`,
      res.status,
      "photon",
    );
  }

  const geo = (await res.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: Record<string, unknown>;
    }>;
  };
  const features = Array.isArray(geo?.features) ? geo.features : [];
  const hits: NominatimHit[] = [];
  for (const f of features) {
    const props = f.properties || {};
    const countryCode = String(props.countrycode || props.country_code || "").toLowerCase();
    const country = String(props.country || "").trim();
    if (countryCode && countryCode !== "nz") continue;
    if (!countryCode && country && !/new zealand|aotearoa/i.test(country)) continue;
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const [lon, lat] = coords;
    const house = String(props.housenumber || "").trim();
    const street = String(props.street || "").trim();
    const city = String(props.city || props.town || props.village || "").trim();
    const state = String(props.state || "").trim();
    const postcode = String(props.postcode || "").trim();
    const name = String(props.name || "").trim();
    const osmId = Number(props.osm_id || 0);
    const roadOrName = street || name;
    const parts = [
      house && roadOrName ? `${house} ${roadOrName}` : roadOrName,
      String(props.district || props.suburb || "").trim(),
      city,
      state,
      postcode,
      country || "New Zealand",
    ].filter(Boolean);
    hits.push({
      place_id: osmId || Math.abs(Math.round(lat * 1e6 + lon * 1e3)),
      display_name: parts.join(", "),
      lat: String(lat),
      lon: String(lon),
      name: name || undefined,
      type: String(props.osm_value || props.type || ""),
      class: String(props.osm_key || props.class || ""),
      address: {
        ...(house ? { house_number: house } : {}),
        ...(roadOrName ? { road: roadOrName } : {}),
        ...(city ? { city } : {}),
        ...(state ? { state } : {}),
        ...(postcode ? { postcode } : {}),
        country: country || "New Zealand",
        ...(String(props.suburb || props.district || "")
          ? { suburb: String(props.suburb || props.district || "") }
          : {}),
      },
    });
  }
  cacheSet(key, hits);
  return hits;
}

function locationIqKey(): string {
  return String(process.env.LOCATIONIQ_API_KEY || process.env.LOCATION_IQ_API_KEY || "").trim();
}

function preferredProvider(): "locationiq" | "photon" | "nominatim" {
  if (locationIqKey()) return "locationiq";
  const forced = String(process.env.GEOCODE_PROVIDER || "")
    .trim()
    .toLowerCase();
  if (forced === "nominatim" || forced === "photon" || forced === "locationiq") {
    return forced as "locationiq" | "photon" | "nominatim";
  }
  // Public Nominatim forbids autocomplete — default to Photon (free) for typeahead.
  return "photon";
}

/** Free-text search biased to NZ. Prefers LocationIQ when configured, else Photon, else Nominatim. */
export async function searchNzPlaces(
  query: string,
  opts?: {
    countrycodes?: string;
    viewbox?: string;
    bounded?: string;
    limit?: number;
  },
): Promise<NominatimHit[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const limit = opts?.limit ?? 8;
  const searchOpts = {
    countrycodes: opts?.countrycodes ?? "nz",
    viewbox: opts?.viewbox ?? DEFAULT_VIEWBOX,
    bounded: opts?.bounded ?? "0",
    limit,
  };

  const provider = preferredProvider();
  const liqKey = locationIqKey();

  if (provider === "locationiq" && liqKey) {
    const primary = await locationIqSearch(trimmed, searchOpts, liqKey);
    const hasNzHint = /\b(new zealand|nz)\b/i.test(trimmed);
    const looksLikePlaceName = !/^\d+\s/.test(trimmed);
    if (looksLikePlaceName && !hasNzHint && primary.length === 0) {
      const boosted = await locationIqSearch(`${trimmed}, New Zealand`, searchOpts, liqKey);
      return mergeHits(primary, boosted, limit);
    }
    return primary.slice(0, limit);
  }

  if (provider === "photon" || provider === "locationiq") {
    // locationiq without key falls through to photon
    try {
      const hits = await photonSearch(trimmed, { limit });
      if (hits.length > 0) return hits.slice(0, limit);
      // Empty is a real miss — try NZ-suffixed once from cache-friendly path
      if (!/\b(new zealand|nz)\b/i.test(trimmed) && !/^\d+\s/.test(trimmed)) {
        const boosted = await photonSearch(`${trimmed}, New Zealand`, { limit });
        return boosted.slice(0, limit);
      }
      return hits;
    } catch (err) {
      // Fall through to throttled Nominatim only if Photon is down
      if (!(err instanceof GeocodeUpstreamError)) throw err;
    }
  }

  // Nominatim path — throttled + cached (policy: no autocomplete, but used as last-resort fallback).
  const primary = await nominatimSearch(trimmed, searchOpts);
  const hasNzHint = /\b(new zealand|nz)\b/i.test(trimmed);
  const looksLikePlaceName = !/^\d+\s/.test(trimmed);
  if (looksLikePlaceName && !hasNzHint && primary.length === 0) {
    const boosted = await nominatimSearch(`${trimmed}, New Zealand`, searchOpts);
    return mergeHits(primary, boosted, limit);
  }
  return primary.slice(0, limit);
}

export function geocodeProviderLabel(): string {
  const p = preferredProvider();
  if (p === "locationiq" && locationIqKey()) return "locationiq";
  if (p === "nominatim") return "nominatim";
  return "photon";
}
