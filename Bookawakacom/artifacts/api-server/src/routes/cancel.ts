import { Router } from "express";

const cancelRouter = Router();

const DISPATCH_API_URL = (
  process.env["DISPATCH_API_URL"] ||
  process.env["DISPATCH_SERVER_URL"] ||
  "https://invt-production.up.railway.app"
).replace(/\/+$/, "");

/**
 * POST /api/cancel — Customer Web → Dispatch HQ unified cancel proxy.
 *
 * Frontend body: { bookingId, companyId, reason? }
 * Forwards to Dispatch POST /api/cancel with X-Admin-Key (BW_ADMIN_KEY).
 */
cancelRouter.post("/cancel", async (req, res) => {
  const { bookingId, companyId, reason } = req.body as {
    bookingId?: string | number;
    companyId?: string;
    reason?: string;
  };

  const adminKey = process.env["BW_ADMIN_KEY"];
  if (!adminKey) {
    req.log.error("BW_ADMIN_KEY is not configured — cannot forward cancel to Dispatch");
    res.status(503).json({ ok: false, error: "Cancel API not configured on this server" });
    return;
  }

  const bid = parseInt(String(bookingId ?? ""), 10);
  const cid = String(companyId ?? "").trim();

  if (!bid || !cid) {
    res.status(400).json({ ok: false, error: "bookingId and companyId are required" });
    return;
  }

  const payload = {
    bookingId: bid,
    companyId: cid,
    reason: String(reason ?? "Cancelled via Customer Web").trim(),
    cancelledBy: "website",
  };

  try {
    const upstream = await fetch(`${DISPATCH_API_URL}/api/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Key": adminKey,
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = { ok: false, error: text || upstream.statusText };
    }

    if (!upstream.ok) {
      req.log.warn(
        { bookingId: bid, companyId: cid, status: upstream.status, body: data },
        "Dispatch /api/cancel returned non-OK",
      );
      res.status(upstream.status).json(data);
      return;
    }

    req.log.info({ bookingId: bid, companyId: cid }, "Cancel forwarded to Dispatch");
    res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err: message, bookingId: bid, companyId: cid }, "POST /cancel forward failed");
    res.status(502).json({ ok: false, error: "Dispatch server unreachable" });
  }
});

export default cancelRouter;
