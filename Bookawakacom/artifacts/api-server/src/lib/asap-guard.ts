/** Pure ASAP duplicate-guard helpers (no Firebase). */

const TERMINAL = new Set([
  "completed",
  "closed",
  "cancelled",
  "canceled",
  "noshow",
  "declined",
]);

export function serviceTypesMatch(jobService: unknown, requested: unknown): boolean {
  const j = String(jobService || "taxi").toLowerCase().trim() || "taxi";
  const r = String(requested || "taxi").toLowerCase().trim() || "taxi";
  return j === r;
}

export function jobLooksAsap(job: Record<string, unknown> | null | undefined): boolean {
  if (!job) return false;
  const bt = String(job.BookingType ?? job.bookingType ?? "").trim();
  if (/prebook|scheduled|later/i.test(bt)) return false;
  if (/^asap$/i.test(bt)) return true;
  const ms = Number(job.ScheduledForMs ?? job.ScheduledFor ?? 0);
  return !Number.isFinite(ms) || ms <= 0;
}

/** Live ASAP / in-progress — not unpaid holds, Later, or terminal. */
export function isLiveAsapStatus(status: unknown): boolean {
  const n = String(status || "").toLowerCase().replace(/[\s_-]/g, "");
  if (!n) return false;
  if (TERMINAL.has(n)) return false;
  if (n === "pendingpayment" || n === "paymentpending") return false;
  if (n === "scheduled") return false;
  return true;
}
