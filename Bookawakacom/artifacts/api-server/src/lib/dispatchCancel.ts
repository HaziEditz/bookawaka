export const SUPPORT_EMAIL = "info@bookawaka.com";

export function dispatchApiBase(): string {
  return (
    process.env["DISPATCH_API_URL"] ||
    process.env["DISPATCH_SERVER_URL"] ||
    "https://invt-production.up.railway.app"
  ).replace(/\/+$/, "");
}

export async function forwardDispatchCancel(opts: {
  bookingId: string | number;
  companyId: string;
  cancelledBy: "website" | "passenger" | "dispatcher";
  reason?: string;
}): Promise<{
  ok: boolean;
  status: number;
  error?: string;
  data: Record<string, unknown>;
}> {
  const adminKey = process.env["BW_ADMIN_KEY"];
  if (!adminKey) {
    return { ok: false, status: 503, error: "BW_ADMIN_KEY not configured", data: {} };
  }
  const upstream = await fetch(`${dispatchApiBase()}/api/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": adminKey,
    },
    body: JSON.stringify({
      bookingId: Number(opts.bookingId) || opts.bookingId,
      companyId: opts.companyId,
      cancelledBy: opts.cancelledBy,
      reason: opts.reason || "Cancelled via BookaWaka",
    }),
  });
  const text = await upstream.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { ok: false, error: text || upstream.statusText };
  }
  return {
    ok: upstream.ok && data.ok !== false,
    status: upstream.status,
    error: typeof data.error === "string" ? data.error : undefined,
    data,
  };
}

export async function dispatchCancelQuote(opts: {
  bookingId: string | number;
  companyId: string;
}): Promise<Record<string, unknown> | null> {
  const adminKey = process.env["BW_ADMIN_KEY"];
  if (!adminKey) return null;
  try {
    const url = `${dispatchApiBase()}/api/cancel-quote?bookingId=${encodeURIComponent(String(opts.bookingId))}&companyId=${encodeURIComponent(opts.companyId)}`;
    const upstream = await fetch(url, { headers: { "X-Admin-Key": adminKey } });
    const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    return data;
  } catch {
    return null;
  }
}
