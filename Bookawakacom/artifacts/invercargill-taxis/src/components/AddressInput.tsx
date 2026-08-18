import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2 } from "lucide-react";

interface NominatimAddress {
  house_number?: string;
  road?: string;
  suburb?: string;
  neighbourhood?: string;
  quarter?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  postcode?: string;
  amenity?: string;
  shop?: string;
  tourism?: string;
  building?: string;
  leisure?: string;
  office?: string;
  historic?: string;
}

interface NominatimResult {
  display_name: string;
  place_id: number;
  lat: string;
  lon: string;
  name?: string;
  type?: string;
  class?: string;
  address?: NominatimAddress;
}

const MIN_SEARCH_LENGTH = 3;
const SEARCH_TIMEOUT_MS = 5000;
const SEARCH_DEBOUNCE_MS = 200;
const ADDRESS_FOCUS_EVENT = "bookawaka-address-input-focus";

/** Only one address field should show suggestions at a time (pickup vs drop-off). */
function notifyAddressFocus(id: string) {
  window.dispatchEvent(new CustomEvent(ADDRESS_FOCUS_EVENT, { detail: id }));
}

/** NZ-only search, biased toward Invercargill (centre -46.4132, 168.3538). */
const NOMINATIM_COUNTRY_CODES = "nz";
const NOMINATIM_BOUNDED = "0";
const NOMINATIM_LIMIT = "8";
const NOMINATIM_VIEWBOX = "167,-47,170,-45";

function cleanDisplayName(displayName: string): string {
  return displayName
    .replace(/, New Zealand(?: \/ Aotearoa)?$/i, "")
    .replace(/, Aotearoa$/i, "")
    .trim();
}

/** Nominatim often returns "Invercargill City" — passengers expect "Invercargill". */
function tidyPlaceName(name: string): string {
  return name
    .replace(/\bInvercargill City\b/gi, "Invercargill")
    .replace(/\bCity of Invercargill\b/gi, "Invercargill")
    .trim();
}

/**
 * NZ street line: unit/street-number + road.
 * Nominatim sometimes returns house_number="1" and road="88 Dee Street" for unit 1 / 88 Dee —
 * join as "1/88 Dee Street" instead of the garbled "1 88 Dee Street".
 */
function formatStreetLine(addr?: NominatimAddress): string {
  if (!addr) return "";
  const num = String(addr.house_number || "").trim();
  const road = String(addr.road || "").trim();
  if (!num && !road) return "";
  if (!num) return road;
  if (!road) return num;
  if (road.toLowerCase().startsWith(num.toLowerCase() + " ") || road.toLowerCase() === num.toLowerCase()) {
    return road;
  }
  // Already NZ unit form in house_number (e.g. 9/6)
  if (num.includes("/")) {
    return `${num} ${road}`.replace(/\s+/g, " ").trim();
  }
  const roadNumMatch = road.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (roadNumMatch && /^\d+[A-Za-z]?$/.test(num)) {
    return `${num}/${roadNumMatch[1]} ${roadNumMatch[2]}`.replace(/\s+/g, " ").trim();
  }
  return `${num} ${road}`.replace(/\s+/g, " ").trim();
}

function pickLocality(addr?: NominatimAddress): string {
  if (!addr) return "";
  return tidyPlaceName(
    addr.suburb ||
      addr.neighbourhood ||
      addr.quarter ||
      addr.city ||
      addr.town ||
      addr.village ||
      addr.municipality ||
      "",
  );
}

function pickCity(addr?: NominatimAddress): string {
  if (!addr) return "";
  const suburb = pickLocality(addr);
  const city = tidyPlaceName(
    (addr.city || addr.town || addr.village || addr.municipality || "").trim(),
  );
  return city && city.toLowerCase() !== suburb.toLowerCase() ? city : "";
}

/** Primary line: business / POI name, or street number + street name. */
export function getPlaceTitle(r: NominatimResult): string {
  const addr = r.address;
  const street = formatStreetLine(addr);

  if (r.name?.trim()) return tidyPlaceName(r.name.trim());

  const poiName =
    addr?.amenity ||
    addr?.shop ||
    addr?.tourism ||
    addr?.leisure ||
    addr?.office ||
    addr?.historic ||
    (addr?.building && addr.building !== "yes" ? addr.building : "");
  if (poiName?.trim()) return tidyPlaceName(poiName.trim());

  if (street) return street;

  const parts = tidyPlaceName(cleanDisplayName(r.display_name))
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts[0] ?? tidyPlaceName(r.display_name);
}

/** Secondary line: street (when title is a business), suburb, city, postcode. */
export function getPlaceSubtitle(r: NominatimResult): string {
  const addr = r.address;
  const title = getPlaceTitle(r);
  const street = formatStreetLine(addr);
  const suburb = addr?.suburb || addr?.neighbourhood || addr?.quarter || "";
  const city = pickCity(addr);
  const postcode = addr?.postcode?.trim() || "";
  const region = addr?.state?.trim() || addr?.county?.trim() || "";

  const parts: string[] = [];
  const titleLower = title.toLowerCase();
  const streetLower = street.toLowerCase();

  if (street && titleLower !== streetLower && !titleLower.includes(streetLower)) {
    parts.push(street);
  }
  if (suburb && !parts.some((p) => p.toLowerCase() === suburb.toLowerCase())) {
    parts.push(tidyPlaceName(suburb));
  }
  if (city && !parts.some((p) => p.toLowerCase() === city.toLowerCase())) {
    parts.push(city);
  }
  if (postcode) parts.push(postcode);
  else if (region && !parts.some((p) => p.toLowerCase() === region.toLowerCase())) {
    parts.push(region);
  }

  if (parts.length > 0) return parts.join(", ");

  const displayParts = cleanDisplayName(r.display_name)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const rest = displayParts.filter((p) => p.toLowerCase() !== titleLower);
  return rest.join(", ");
}

/** Value stored in the input after the user picks a suggestion. */
export function formatSelectedAddress(r: NominatimResult): string {
  const title = tidyPlaceName(getPlaceTitle(r));
  const subtitle = tidyPlaceName(getPlaceSubtitle(r));
  if (subtitle && subtitle.toLowerCase() !== title.toLowerCase()) {
    // Avoid "Street, Street, Suburb" duplication
    const combined = `${title}, ${subtitle}`.replace(/\s+,/g, ",").replace(/,\s*,/g, ",");
    return tidyPlaceName(combined);
  }
  return title || tidyPlaceName(cleanDisplayName(r.display_name));
}

/** Client-side URL → proxied to Nominatim on the API server. */
function buildGeocodeSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    countrycodes: NOMINATIM_COUNTRY_CODES,
    bounded: NOMINATIM_BOUNDED,
    limit: NOMINATIM_LIMIT,
    viewbox: NOMINATIM_VIEWBOX,
  });
  return `${import.meta.env.BASE_URL}api/geocode?${params}`;
}

export default function AddressInput({
  id,
  name,
  value,
  onChange,
  onCoordChange,
  onActiveChange,
  placeholder,
  required,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (val: string) => void;
  onCoordChange?: (lat: number, lng: number) => void;
  /** Fired when the input is focused or the suggestion dropdown is open. */
  onActiveChange?: (active: boolean) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const latestQueryRef = useRef("");

  const runSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    latestQueryRef.current = trimmed;

    if (trimmed.length < MIN_SEARCH_LENGTH) {
      setResults([]);
      setOpen(false);
      setSearching(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    setSearching(true);

    try {
      const res = await fetch(buildGeocodeSearchUrl(trimmed), {
        signal: controller.signal,
        headers: { "Accept-Language": "en" },
      });
      if (!res.ok || latestQueryRef.current !== trimmed) {
        if (latestQueryRef.current === trimmed) {
          setResults([]);
          setOpen(false);
        }
        return;
      }
      const data: NominatimResult[] = await res.json();
      if (!Array.isArray(data) || latestQueryRef.current !== trimmed) {
        if (latestQueryRef.current === trimmed) {
          setResults([]);
          setOpen(false);
        }
        return;
      }
      setResults(data);
      setOpen(data.length > 0);
    } catch {
      if (latestQueryRef.current === trimmed) {
        setResults([]);
        setOpen(false);
      }
    } finally {
      clearTimeout(timeoutId);
      if (latestQueryRef.current === trimmed) {
        setSearching(false);
      }
    }
  }, [id]);

  const scheduleSearch = useCallback(
    (query: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const trimmed = query.trim();

      if (trimmed.length < MIN_SEARCH_LENGTH) {
        setResults([]);
        setOpen(false);
        setSearching(false);
        return;
      }

      setSearching(true);
      const delay = trimmed.length === MIN_SEARCH_LENGTH ? 0 : SEARCH_DEBOUNCE_MS;
      debounceRef.current = setTimeout(() => {
        void runSearch(trimmed);
      }, delay);
    },
    [runSearch]
  );

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);
    onCoordChange?.(0, 0);
    abortRef.current?.abort();
    abortRef.current = null;
    scheduleSearch(val);
  };

  const select = (r: NominatimResult) => {
    onChange(formatSelectedAddress(r));
    onCoordChange?.(parseFloat(r.lat), parseFloat(r.lon));
    setResults([]);
    setOpen(false);
    setSearching(false);
    setFocused(false);
    latestQueryRef.current = "";
  };

  useEffect(() => {
    onActiveChange?.(focused || open);
  }, [focused, open, onActiveChange]);

  useEffect(() => {
    const onSiblingFocus = (e: Event) => {
      const activeId = (e as CustomEvent<string>).detail;
      if (activeId !== id) {
        setOpen(false);
        setFocused(false);
        abortRef.current?.abort();
        if (debounceRef.current) clearTimeout(debounceRef.current);
      }
    };
    window.addEventListener(ADDRESS_FOCUS_EVENT, onSiblingFocus);
    return () => window.removeEventListener(ADDRESS_FOCUS_EVENT, onSiblingFocus);
  }, [id]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target || !containerRef.current) return;
      if (containerRef.current.contains(target)) return;
      setOpen(false);
      setFocused(false);
    };
    document.addEventListener("mousedown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const isActive = focused || open;

  return (
    <div
      ref={containerRef}
      className="relative"
      style={isActive ? { position: "relative", zIndex: 9999 } : undefined}
    >
      <input
        id={id}
        name={name}
        type="text"
        value={value}
        onChange={handleInput}
        onFocus={() => {
          notifyAddressFocus(id);
          setFocused(true);
          if (value.trim().length >= MIN_SEARCH_LENGTH) {
            if (results.length > 0) {
              setOpen(true);
            } else {
              scheduleSearch(value);
            }
          }
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (!containerRef.current?.contains(document.activeElement)) {
              setFocused(false);
              setOpen(false);
            }
          }, 150);
        }}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        className="flex h-12 w-full rounded-xl border border-input bg-transparent px-3 py-2 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm pr-10"
      />
      {searching && (
        <Loader2 className="absolute right-3 top-3.5 w-5 h-5 animate-spin text-muted-foreground pointer-events-none" />
      )}
      {open && results.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1 w-full bg-card border border-border rounded-xl shadow-xl overflow-hidden max-h-72 overflow-y-auto"
          style={{ position: "absolute", zIndex: 9999 }}
          role="listbox"
          aria-label="Address suggestions"
        >
          {results.map((r) => {
            const title = getPlaceTitle(r);
            const subtitle = getPlaceSubtitle(r);
            return (
              <button
                key={r.place_id}
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  select(r);
                }}
                onClick={() => select(r)}
                className="w-full text-left px-4 py-3 hover:bg-muted transition-colors border-b border-border/50 last:border-0"
              >
                <div className="text-sm font-semibold text-foreground leading-snug">{title}</div>
                {subtitle ? (
                  <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{subtitle}</div>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
