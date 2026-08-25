/**
 * datetime-local ↔ NZ wall-clock helpers.
 * Parse as explicit Pacific/Auckland (same approach as INVT parseNzBookingDateTimeMs),
 * never the broken "UTC + NZ offset hack" that fails when the browser is already NZ.
 */

const NZ_TZ = "Pacific/Auckland";

/** Format an instant as datetime-local value in NZ wall time (`YYYY-MM-DDTHH:mm`). */
export function toNZDatetimeLocal(isoOrMs: string | number | undefined): string {
  if (isoOrMs == null || isoOrMs === "" || isoOrMs === 0) return "";
  const d = new Date(isoOrMs);
  if (isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NZ_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/**
 * Parse a datetime-local string as Pacific/Auckland wall clock → UTC ISO.
 * Input: `YYYY-MM-DDTHH:mm` (or with seconds).
 */
export function fromNZDatetimeLocal(localStr: string): string {
  if (!localStr) throw new Error("No scheduled time entered");
  const m = String(localStr)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) throw new Error("Invalid scheduled time");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6] || "0");

  // Guess UTC from wall components, then correct by Auckland offset at that instant.
  let guess = Date.UTC(y, mo - 1, d, h, mi, s);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: NZ_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(guess));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    const hour = get("hour") === "24" ? "00" : get("hour");
    const shownAsUtc = Date.UTC(
      Number(get("year")),
      Number(get("month")) - 1,
      Number(get("day")),
      Number(hour),
      Number(get("minute")),
      Number(get("second")),
    );
    const targetAsUtc = Date.UTC(y, mo - 1, d, h, mi, s);
    const diff = targetAsUtc - shownAsUtc;
    if (diff === 0) break;
    guess += diff;
  }

  const result = new Date(guess);
  if (isNaN(result.getTime())) throw new Error("Invalid scheduled time");
  return result.toISOString();
}
