/** Copy + helpers for blocking a second ASAP at the first tap (not at payment). */

export const ACTIVE_ASAP_LATER_ONLY_TITLE = "You already have an active job";

export const ACTIVE_ASAP_LATER_ONLY_MSG =
  "You have an active job. You can only create a Later booking right now, not another ASAP, until this one's done.";

export type ActiveAsapMatch = {
  existingBookingId: string;
  existingStatus: string;
  serviceType: string;
  message: string;
};

export function parseActiveAsapCheck(data: Record<string, unknown> | null | undefined): ActiveAsapMatch | null {
  if (!data || data.hasActive !== true || !data.existingBookingId) return null;
  return {
    existingBookingId: String(data.existingBookingId),
    existingStatus: String(data.existingStatus ?? ""),
    serviceType: String(data.serviceType ?? "taxi"),
    message: ACTIVE_ASAP_LATER_ONLY_MSG,
  };
}

export async function fetchActiveAsapBooking(
  phone: string,
  serviceType: string,
  baseUrl: string,
): Promise<ActiveAsapMatch | null> {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  const params = new URLSearchParams({
    phone: String(phone).trim(),
    serviceType: serviceType || "taxi",
  });
  const prefix = String(baseUrl || "").replace(/\/$/, "");
  const res = await fetch(`${prefix}/api/bookings/active-check?${params}`, {
    signal: AbortSignal.timeout(8_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return parseActiveAsapCheck(data);
}
