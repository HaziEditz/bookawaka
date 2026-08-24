/**
 * SA dispatch HQ shows the time column from BookingDateTime, formatted in NZ
 * local time as `YYYY-MM-DD HH:mm:ss.` (trailing dot matches C# DateTime.ToString()).
 */
export function formatNzBookingDateTime(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  // en-CA hour can render "24" at midnight; clamp to "00".
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}:${get("second")}.`;
}
