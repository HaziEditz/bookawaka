/**
 * PhoneField — country-code selector (default +64 NZ) + local number field.
 * Emits a single canonical digits-only string via onChange (e.g. "6421123567").
 */
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface CountryCode {
  code: string;
  flag: string;
  name: string;
  label: string;
}

export const COUNTRY_CODES: CountryCode[] = [
  { code: "64", flag: "🇳🇿", name: "New Zealand",    label: "+64" },
  { code: "61", flag: "🇦🇺", name: "Australia",      label: "+61" },
  { code: "1",  flag: "🇺🇸", name: "USA / Canada",   label: "+1"  },
  { code: "44", flag: "🇬🇧", name: "United Kingdom", label: "+44" },
  { code: "65", flag: "🇸🇬", name: "Singapore",      label: "+65" },
  { code: "91", flag: "🇮🇳", name: "India",          label: "+91" },
  { code: "86", flag: "🇨🇳", name: "China",          label: "+86" },
  { code: "81", flag: "🇯🇵", name: "Japan",          label: "+81" },
  { code: "82", flag: "🇰🇷", name: "South Korea",    label: "+82" },
  { code: "33", flag: "🇫🇷", name: "France",         label: "+33" },
  { code: "49", flag: "🇩🇪", name: "Germany",        label: "+49" },
  { code: "39", flag: "🇮🇹", name: "Italy",          label: "+39" },
  { code: "34", flag: "🇪🇸", name: "Spain",          label: "+34" },
  { code: "7",  flag: "🇷🇺", name: "Russia",         label: "+7"  },
  { code: "55", flag: "🇧🇷", name: "Brazil",         label: "+55" },
  { code: "52", flag: "🇲🇽", name: "Mexico",         label: "+52" },
  { code: "27", flag: "🇿🇦", name: "South Africa",   label: "+27" },
  { code: "66", flag: "🇹🇭", name: "Thailand",       label: "+66" },
  { code: "62", flag: "🇮🇩", name: "Indonesia",      label: "+62" },
  { code: "63", flag: "🇵🇭", name: "Philippines",    label: "+63" },
  { code: "84", flag: "🇻🇳", name: "Vietnam",        label: "+84" },
  { code: "60", flag: "🇲🇾", name: "Malaysia",       label: "+60" },
];

function stripLeadingZero(local: string): string {
  return local.replace(/^0+/, "");
}

export function buildCanonical(countryCode: string, localRaw: string): string {
  const localDigits = localRaw.replace(/\D/g, "");
  const stripped = stripLeadingZero(localDigits);
  return stripped ? countryCode + stripped : "";
}

/** Convert a canonical (or legacy) digit string into { country, local }. */
export function parseCanonical(raw: string): { country: CountryCode; local: string } {
  const digits = String(raw || "").replace(/\D/g, "");
  const defaultCountry = COUNTRY_CODES[0];
  if (!digits) return { country: defaultCountry, local: "" };
  // Prefer longer codes first so "64" beats "6"
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  const matched = sorted.find((c) => digits.startsWith(c.code));
  if (matched) return { country: matched, local: digits.slice(matched.code.length) };
  // Legacy local NZ form starting with 0 → strip 0, keep NZ
  if (digits.startsWith("0")) return { country: defaultCountry, local: digits.slice(1) };
  return { country: defaultCountry, local: digits };
}

interface Props {
  /** Canonical digits-only value (e.g. "6421123567") */
  value: string;
  onChange: (canonical: string) => void;
  id?: string;
  required?: boolean;
  className?: string;
  placeholder?: string;
}

export default function PhoneField({
  value,
  onChange,
  id = "phone",
  required,
  className = "",
  placeholder = "21 123 4567",
}: Props) {
  const parsed = parseCanonical(value);
  const [country, setCountry] = useState<CountryCode>(parsed.country);
  const [local, setLocal] = useState(parsed.local);
  const [open, setOpen] = useState(false);

  // Sync when parent value changes externally (e.g. session prefill)
  useEffect(() => {
    const p = parseCanonical(value);
    setCountry(p.country);
    setLocal(p.local);
  }, [value]);

  const emit = (c: CountryCode, loc: string) => {
    onChange(buildCanonical(c.code, loc));
  };

  return (
    <div className={`relative flex rounded-xl overflow-hidden border border-border bg-background focus-within:ring-2 focus-within:ring-ring h-11 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 border-r border-border bg-muted/40 text-sm font-medium whitespace-nowrap hover:bg-muted transition-colors shrink-0"
      >
        <span>{country.flag}</span>
        <span>{country.label}</span>
        <ChevronDown className="w-3 h-3 text-muted-foreground" />
      </button>
      <input
        id={id}
        type="tel"
        required={required}
        value={local}
        onChange={(e) => {
          const next = e.target.value.replace(/[^0-9\s\-()]/g, "");
          setLocal(next);
          emit(country, next);
        }}
        placeholder={placeholder}
        className="flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground min-w-0"
      />
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-72 max-h-72 overflow-y-auto bg-popover border border-border rounded-xl shadow-xl">
          {COUNTRY_CODES.map((c) => (
            <button
              key={c.code + c.name}
              type="button"
              onClick={() => {
                setCountry(c);
                setOpen(false);
                emit(c, local);
              }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted transition-colors text-left ${
                country.code === c.code && country.name === c.name ? "bg-muted" : ""
              }`}
            >
              <span>{c.flag}</span>
              <span className="flex-1">{c.name}</span>
              <span className="text-muted-foreground">{c.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
