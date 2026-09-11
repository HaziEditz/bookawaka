import { Router } from "express";
import { getDatabase } from "../lib/firebase";
import { cancelScheduledDispatch, registerScheduledDispatch } from "../lib/scheduler";
import { resolvePassengerWalletKey } from "../lib/passengerKey";
import { formatNzBookingDateTime } from "../lib/formatNzBookingDateTime";
import {
  sendBookingCancelledEmails,
  sendBookingUpdatedEmails,
} from "../lib/bookingNotifyEmails";
import { selfServeCancelAllowed, SUPPORT_EMAIL } from "../lib/cancelCopy";
import { forwardDispatchCancel, dispatchCancelQuote } from "../lib/dispatchCancel";

const myRidesRouter = Router();

/** True when pendingjobs already has a real dispatch row (not a sparse edit remnant). */
function pendingjobsLooksFull(pj: Record<string, any> | null | undefined): boolean {
  if (!pj || typeof pj !== "object") return false;
  // Sparse remnant from older buggy edits: only UpdatedAt / Info / Cancelled fields.
  const keys = Object.keys(pj);
  if (keys.length === 0) return false;
  const hasIdentity = !!(
    pj.BookingSource ||
    pj.PassengerName ||
    pj.Name ||
    pj.PickAddress ||
    pj.WebBooking
  );
  // Dispatcher may stamp edit overlays (DispatchTimebefore, EditHistory) without Status.
  if (hasIdentity) return true;
  // Cancelled / Status-only alert rows are not "full" create rows but should not be deleted
  // by a passenger edit path — leave them alone (caller skips write, does not null).
  return false;
}

/** Only wipe clearly sparse passenger-edit remnants (no identity, no dispatcher edits). */
function isSparsePendingjobsRemnant(pj: Record<string, any>): boolean {
  if (pendingjobsLooksFull(pj)) return false;
  const keys = Object.keys(pj);
  const allowedSparse = new Set([
    "UpdatedAt",
    "updatedAt",
    "Info",
    "Notes",
    "ScheduledFor",
    "ScheduledForMs",
    "PickAddress",
    "DropAddress",
    "NotifyDispatchAt",
    "Status",
    "status",
    "CancelledAt",
    "CancelledBy",
    "pickupLocation",
    "dropoffLocation",
  ]);
  return keys.length > 0 && keys.every((k) => allowedSparse.has(k));
}

function stopsPayloadNonEmpty(raw: unknown): boolean {
  if (raw == null || raw === "") return false;
  if (Array.isArray(raw)) return raw.length > 0;
  if (typeof raw === "string") return raw.trim().length > 0;
  if (typeof raw === "object") return Object.keys(raw as object).length > 0;
  return false;
}

/** Prefer live allbookings stops; keep Passengerjobs if HQ row has none. */
function overlayStops(live: Record<string, any>, _pax: Record<string, any>): Record<string, unknown> {
  const liveHas =
    stopsPayloadNonEmpty(live.Stops) ||
    stopsPayloadNonEmpty(live.stops) ||
    stopsPayloadNonEmpty(live.nextstopdata) ||
    stopsPayloadNonEmpty(live.Nextstopdata);
  if (!liveHas) return {};
  return {
    ...(live.Stops != null ? { Stops: live.Stops } : {}),
    ...(live.stops != null ? { stops: live.stops } : {}),
    ...(live.nextstopdata != null ? { nextstopdata: live.nextstopdata } : {}),
    ...(live.Nextstopdata != null ? { Nextstopdata: live.Nextstopdata } : {}),
  };
}

function scheduledMsOf(booking: Record<string, any>): number {
  const raw = booking.ScheduledForMs ?? booking.ScheduledFor;
  if (raw == null || raw === 0 || raw === "0") return 0;
  const n = typeof raw === "number" ? raw : new Date(raw).getTime();
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function resolvePassengerKey(
  db: ReturnType<typeof getDatabase>,
  query: { key?: string; email?: string; phone?: string },
): Promise<string | null> {
  return resolvePassengerWalletKey(db, query);
}

myRidesRouter.get("/my-rides", async (req, res) => {
  const { key, email, phone } = req.query as {
    key?: string;
    email?: string;
    phone?: string;
  };

  if (!key && !email && !phone) {
    res.status(400).json({ error: "key, email, or phone is required" });
    return;
  }

  const startedAt = Date.now();
  /** Admin SDK once() can hang indefinitely on some Railway/Firebase pairings — never block the page. */
  const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      p.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        },
      );
    });

  try {
    const db = getDatabase();
    const resolvedKey = await withTimeout(
      resolvePassengerKey(db, { key, email, phone }),
      8_000,
      "resolvePassengerKey",
    );

    if (!resolvedKey) {
      res.json({ rides: [], passengerKey: null });
      return;
    }

    const snap = (await withTimeout(
      db.ref(`Passengerjobs/${resolvedKey}`).once("value"),
      10_000,
      `Passengerjobs/${resolvedKey}`,
    )) as { val: () => unknown };
    const data = (snap.val() ?? {}) as Record<string, unknown>;
    const rides = Object.values(data) as any[];

    // Authoritative-status overlay. Passengerjobs is the per-passenger index, but
    // dispatch HQ (SA Portal / driver app) only writes Status updates to
    // allbookings/{companyId}/{bookingId} — they don't fan-out to Passengerjobs.
    // Without this overlay, the My Rides page shows forever-stale "Pending" rows
    // even when the trip has been Offered / Assigned / Completed in dispatch.
    // Reads are best-effort with a hard per-ride timeout — Admin SDK hangs were
    // observed hanging the whole GET /my-rides for passengers with many jobs.
    const OVERLAY_TIMEOUT_MS = 2_500;
    const OVERLAY_CONCURRENCY = 6;

    async function overlayOne(r: any): Promise<any> {
      const cid = r?.CompanyId ?? r?.companyId;
      const bid = r?.BookingId;
      if (!cid || !bid) return r;
      try {
        const liveSnap = (await withTimeout(
          db.ref(`allbookings/${cid}/${bid}`).once("value"),
          OVERLAY_TIMEOUT_MS,
          `allbookings/${cid}/${bid}`,
        )) as { val: () => unknown };
        const live = liveSnap.val() as Record<string, any> | null;
        if (!live || typeof live !== "object") return r;
        const paxSt = String(r.Status ?? r.status ?? "").toLowerCase();
        const liveSt = String(live.Status ?? live.status ?? "").toLowerCase();
        const paxTerminal = paxSt === "cancelled" || paxSt === "canceled" || paxSt === "completed";
        const liveTerminal =
          liveSt === "cancelled" ||
          liveSt === "canceled" ||
          liveSt === "completed" ||
          liveSt === "closed" ||
          liveSt === "noshow" ||
          liveSt === "no_show";
        // Half-cancel guard: if Passengerjobs is Cancelled (wallet credited) but
        // allbookings was healed back to Pending, keep Cancelled for My Rides.
        const keepPaxStatus = paxTerminal && !liveTerminal;
        return {
          ...r,
          ...(live.Status != null && !keepPaxStatus ? { Status: live.Status } : {}),
          ...(live.status != null && !keepPaxStatus ? { status: live.status } : {}),
          ...(keepPaxStatus
            ? { Status: r.Status ?? "Cancelled", status: r.status ?? "Cancelled" }
            : {}),
          ...(live.DriverId ? { DriverId: live.DriverId } : {}),
          ...(live.paymentStatus ? { paymentStatus: live.paymentStatus } : {}),
          ...(live.CancelledAt ? { CancelledAt: live.CancelledAt } : {}),
          ...(live.CancelledBy ? { CancelledBy: live.CancelledBy } : {}),
          ...(r.CancelledAt && !live.CancelledAt ? { CancelledAt: r.CancelledAt } : {}),
          ...(r.refundStatus ? { refundStatus: r.refundStatus } : {}),
          ...(live.Info != null ? { Info: live.Info } : {}),
          ...(live.Notes != null ? { Notes: live.Notes } : {}),
          ...(live.PickAddress ? { PickAddress: live.PickAddress } : {}),
          ...(live.DropAddress ? { DropAddress: live.DropAddress } : {}),
          ...(live.BookingDateTime ? { BookingDateTime: live.BookingDateTime } : {}),
          ...(live.Pickingtime ? { Pickingtime: live.Pickingtime } : {}),
          ...(live.ScheduledFor != null ? { ScheduledFor: live.ScheduledFor } : {}),
          ...(live.ScheduledForMs != null ? { ScheduledForMs: live.ScheduledForMs } : {}),
          ...overlayStops(live, r),
        };
      } catch (e) {
        req.log.warn({ e, cid, bid }, "my-rides: allbookings overlay read failed/timed out");
        return r;
      }
    }

    const overlaid: any[] = [];
    for (let i = 0; i < rides.length; i += OVERLAY_CONCURRENCY) {
      const chunk = rides.slice(i, i + OVERLAY_CONCURRENCY);
      const part = await Promise.all(chunk.map(overlayOne));
      overlaid.push(...part);
      // Soft overall budget — return what we have rather than hang the client forever.
      if (Date.now() - startedAt > 18_000) {
        req.log.warn(
          { resolvedKey, rideCount: rides.length, done: overlaid.length, ms: Date.now() - startedAt },
          "my-rides: overall budget hit — returning partial overlay",
        );
        // Append remaining rides without overlay so the page still loads.
        overlaid.push(...rides.slice(overlaid.length));
        break;
      }
    }

    req.log.info(
      { resolvedKey, rideCount: rides.length, ms: Date.now() - startedAt },
      "GET /my-rides ok",
    );

    // Never cache — this endpoint is polled live to track payment/status changes
    res.setHeader("Cache-Control", "no-store");
    res.json({ rides: overlaid, passengerKey: resolvedKey });
  } catch (err: any) {
    req.log.error({ err, ms: Date.now() - startedAt }, "GET /my-rides error");
    res.status(500).json({ error: err.message });
  }
});

myRidesRouter.post("/my-rides/:jobId/cancel", async (req, res) => {
  const { jobId } = req.params;
  const { key, companyId } = req.body as { key?: string; companyId?: string };

  if (!key || !companyId) {
    res.status(400).json({ error: "key and companyId are required" });
    return;
  }

  try {
    const db = getDatabase();

    // Read the full booking from allbookings — it is always the authoritative record.
    // Passengerjobs can be stale (e.g. after card payment verified but Passengerjobs not yet synced).
    const bookingSnap = await db.ref(`allbookings/${companyId}/${jobId}`).once("value");
    const booking = bookingSnap.val() as Record<string, any> | null;
    const currentStatus: string | null = booking?.Status ?? booking?.status ?? null;

    if (currentStatus && !selfServeCancelAllowed(currentStatus)) {
      res.status(409).json({
        error: `The driver has arrived — cancellation is no longer available. Contact the company or email ${SUPPORT_EMAIL}.`,
        error_code: "self_serve_locked",
        supportEmail: SUPPORT_EMAIL,
      });
      return;
    }

    const cancelledAt = new Date().toISOString();

    // Dispatch is the money + driver-notify source of truth (same fairness as
    // passenger app and dispatcher Cancel). Wallet credit / account bill happen there.
    const fwd = await forwardDispatchCancel({
      bookingId: jobId,
      companyId,
      cancelledBy: "website",
      reason: "Cancelled via My Rides (passenger)",
    });
    if (!fwd.ok) {
      req.log.warn({ jobId, companyId, status: fwd.status, body: fwd.data }, "Dispatch /api/cancel failed");
      res.status(fwd.status === 409 ? 409 : fwd.status >= 400 ? fwd.status : 502).json({
        error: fwd.error || "Could not cancel this booking",
        error_code: fwd.data.error_code,
        companyPhone: fwd.data.companyPhone,
        supportEmail: fwd.data.supportEmail || SUPPORT_EMAIL,
        fairness: fwd.data.fairness,
      });
      return;
    }

    const fairness = (fwd.data.fairness && typeof fwd.data.fairness === "object"
      ? (fwd.data.fairness as Record<string, unknown>)
      : null);
    const walletCredited = fwd.data.walletCredited === true || Number(fwd.data.walletCreditAmount) > 0;
    const walletCreditAmount =
      typeof fwd.data.walletCreditAmount === "number"
        ? fwd.data.walletCreditAmount
        : Number(fairness?.creditAmount) || null;
    const passengerMessage = String(
      (fairness && fairness.passengerMessage) || fwd.data.passengerMessage || "",
    );

    const cancelFields: Record<string, any> = {
      Status: "Cancelled",
      status: "Cancelled",
      CancelledAt: cancelledAt,
      CancelledBy: "passenger",
      ...(fairness ? { cancelFairness: fairness, cancelPassengerMessage: passengerMessage } : {}),
      ...(walletCredited ? { refundStatus: "wallet_credited", walletCreditAmount } : {}),
    };

    const updates: Record<string, any> = {};
    for (const [field, value] of Object.entries(cancelFields)) {
      updates[`allbookings/${companyId}/${jobId}/${field}`] = value;
      updates[`Passengerjobs/${key}/${jobId}/${field}`] = value;
      updates[`pendingjobs/${companyId}/${jobId}/${field}`] = value;
    }
    await db.ref().update(updates);

    cancelScheduledDispatch(companyId, jobId);

    const cancelledBooking = { ...(booking || {}), ...cancelFields, BookingId: booking?.BookingId ?? jobId };
    sendBookingCancelledEmails({
      booking: cancelledBooking,
      companyId,
      companyName: booking?.CompanyName,
      companyEmail: booking?.companyEmail,
      passengerEmail: booking?.PassengerEmail,
      log: req.log,
    }).catch((e) => req.log.warn({ e, jobId }, "Cancel emails failed"));

    req.log.info(
      { jobId, companyId, key, walletCredited, fairnessOutcome: fairness?.outcome },
      "Job cancelled via Dispatch fairness",
    );
    res.json({
      ok: true,
      walletCredited,
      walletCreditAmount,
      driverAssigned: String(fairness?.stage || "") !== "not_assigned",
      fairness,
      passengerMessage,
      companyPhone: fwd.data.companyPhone,
      supportEmail: fwd.data.supportEmail || SUPPORT_EMAIL,
      cashCancelWarning: fwd.data.cashCancelWarning === true,
      cashCancelCardOnly: fwd.data.cashCancelCardOnly === true,
      dispatchCancel: { ok: true },
    });
    return;
  } catch (err: any) {
    req.log.error({ err }, "POST /my-rides/:jobId/cancel error");
    res.status(500).json({ error: err.message });
  }
});

myRidesRouter.get("/my-rides/:jobId/cancel-quote", async (req, res) => {
  const { jobId } = req.params;
  const { companyId } = req.query as { companyId?: string };
  if (!companyId) {
    res.status(400).json({ error: "companyId is required" });
    return;
  }
  const quote = await dispatchCancelQuote({ bookingId: jobId, companyId });
  if (!quote) {
    res.status(502).json({ error: "Could not load cancel quote" });
    return;
  }
  res.json(quote);
});

myRidesRouter.post("/my-rides/:jobId/update", async (req, res) => {
  const { jobId } = req.params;
  const { key, companyId, scheduledFor, notes, pickAddress, dropAddress } = req.body as {
    key?: string;
    companyId?: string;
    scheduledFor?: string;
    notes?: string;
    pickAddress?: string;
    dropAddress?: string;
  };

  if (!key || !companyId) {
    res.status(400).json({ error: "key and companyId are required" });
    return;
  }

  try {
    const db = getDatabase();

    // Full authoritative row — edits must write the same fields dispatch reads.
    const bookingSnap = await db.ref(`allbookings/${companyId}/${jobId}`).once("value");
    const booking = bookingSnap.val() as Record<string, any> | null;
    if (!booking) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }

    const currentStatus: string | null = booking.Status ?? booking.status ?? null;
    // Allow edits on Scheduled rides (full edit) and Pending rides (address/notes only)
    const editableStatuses = ["Scheduled", "scheduled", "Pending", "pending"];
    if (currentStatus && !editableStatuses.includes(currentStatus)) {
      res.status(409).json({ error: `Only Scheduled or Pending bookings can be edited (current: ${currentStatus}).` });
      return;
    }

    const isScheduled = currentStatus === "Scheduled" || currentStatus === "scheduled";
    const nowIso = new Date().toISOString();
    const changeSummary: string[] = [];
    let scheduleChanged = false;

    const content: Record<string, any> = { UpdatedAt: nowIso };

    // ScheduledFor changes only allowed on Scheduled rides
    if (scheduledFor && isScheduled) {
      const d = new Date(scheduledFor);
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ error: "Invalid scheduledFor" });
        return;
      }
      const ms = d.getTime();
      const prevMs = scheduledMsOf(booking);
      // Ignore sub-minute jitter from datetime-local round-trips
      if (Math.abs(ms - prevMs) >= 30_000) {
        scheduleChanged = true;
        const bookingDateTime = formatNzBookingDateTime(d);
        content.ScheduledFor = ms; // numeric ms — matches create path / SA ASAP contract
        content.ScheduledForMs = ms;
        content.BookingDateTime = bookingDateTime;
        content.Pickingtime = bookingDateTime;

        const nbm =
          booking.NotifyDispatchBeforeMinutes != null
            ? Number(booking.NotifyDispatchBeforeMinutes)
            : booking.DispatchTimebefore != null
              ? Number(booking.DispatchTimebefore)
              : null;
        const notifyAtMs = nbm != null && Number.isFinite(nbm) ? ms - nbm * 60 * 1000 : ms;
        const notifyAtIso = new Date(notifyAtMs).toISOString();
        content.NotifyDispatchAt = notifyAtIso;

        changeSummary.push(
          `Pickup time → ${d.toLocaleString("en-NZ", { timeZone: "Pacific/Auckland" })}`,
        );
      }
    }

    if (notes !== undefined) {
      const nextNotes = String(notes);
      const prevNotes = String(booking.Info ?? booking.Notes ?? "");
      if (nextNotes !== prevNotes) {
        content.Info = nextNotes;
        content.Notes = nextNotes;
        changeSummary.push(nextNotes.trim() ? `Notes → ${nextNotes.trim()}` : "Notes cleared");
      }
    }

    if (pickAddress) {
      const next = String(pickAddress).trim();
      if (next && next !== String(booking.PickAddress ?? "").trim()) {
        content.PickAddress = next;
        content.pickupLocation = {
          ...(typeof booking.pickupLocation === "object" && booking.pickupLocation
            ? booking.pickupLocation
            : {}),
          address: next,
        };
        changeSummary.push(`Pickup → ${next}`);
      }
    }

    if (dropAddress) {
      const next = String(dropAddress).trim();
      if (next && next !== String(booking.DropAddress ?? "").trim()) {
        content.DropAddress = next;
        content.dropoffLocation = {
          ...(typeof booking.dropoffLocation === "object" && booking.dropoffLocation
            ? booking.dropoffLocation
            : {}),
          address: next,
        };
        changeSummary.push(`Drop-off → ${next}`);
      }
    }

    if (Object.keys(content).length <= 1 && !scheduleChanged) {
      // Only UpdatedAt — nothing material changed
      res.json({ ok: true, unchanged: true, changes: [] });
      return;
    }

    const updates: Record<string, any> = {};
    const writePaths = [
      `allbookings/${companyId}/${jobId}`,
      `Passengerjobs/${key}/${jobId}`,
    ];

    // pendingjobs: full content sync only when a real dispatch row already exists.
    // Never create sparse edit remnants for Scheduled-until-release jobs.
    const pjSnap = await db.ref(`pendingjobs/${companyId}/${jobId}`).once("value");
    const pj = pjSnap.val() as Record<string, any> | null;
    if (pendingjobsLooksFull(pj)) {
      writePaths.push(`pendingjobs/${companyId}/${jobId}`);
    } else if (pj && isScheduled && isSparsePendingjobsRemnant(pj)) {
      // Clear sparse remnant from older buggy edits so dispatch does not flicker.
      updates[`pendingjobs/${companyId}/${jobId}`] = null;
    }

    for (const path of writePaths) {
      for (const [field, value] of Object.entries(content)) {
        if (field === "pickupLocation" || field === "dropoffLocation") {
          updates[`${path}/${field}`] = value;
        } else {
          updates[`${path}/${field}`] = value;
        }
      }
    }

    if (scheduleChanged && content.NotifyDispatchAt) {
      updates[`scheduledDispatch/${companyId}/${jobId}/notifyAt`] = content.NotifyDispatchAt;
      cancelScheduledDispatch(companyId, jobId);
      registerScheduledDispatch({
        companyId,
        bookingId: jobId,
        notifyAt: content.NotifyDispatchAt,
      });
    }

    await db.ref().update(updates);

    const merged: Record<string, any> = {
      ...booking,
      ...content,
      BookingId: booking.BookingId ?? jobId,
    };

    // Notify company + passenger on a real date/time change (not notes-only edits).
    if (scheduleChanged) {
      sendBookingUpdatedEmails({
        booking: merged,
        companyId,
        companyName: booking.CompanyName,
        companyEmail: booking.companyEmail,
        passengerEmail: booking.PassengerEmail,
        changeSummary,
        scheduleChanged,
        log: req.log,
      }).catch((e) => req.log.warn({ e, jobId }, "Update emails failed"));
    }

    req.log.info(
      { jobId, companyId, key, isScheduled, scheduleChanged, changeSummary },
      "Job updated by passenger",
    );
    res.json({
      ok: true,
      changes: changeSummary,
      booking: {
        BookingId: merged.BookingId,
        PickAddress: merged.PickAddress,
        DropAddress: merged.DropAddress,
        Info: merged.Info ?? merged.Notes ?? "",
        Notes: merged.Notes ?? merged.Info ?? "",
        ScheduledFor: merged.ScheduledFor,
        ScheduledForMs: merged.ScheduledForMs,
        BookingDateTime: merged.BookingDateTime,
        Pickingtime: merged.Pickingtime,
      },
    });
  } catch (err: any) {
    req.log.error({ err }, "POST /my-rides/:jobId/update error");
    res.status(500).json({ error: err.message });
  }
});

// --- Wallet ---
// Returns the passenger's wallet balance and recent entries.
// Resolves the passenger by key/email/phone using the same logic as /my-rides.
myRidesRouter.get("/wallet", async (req, res) => {
  const { key, email, phone } = req.query as {
    key?: string;
    email?: string;
    phone?: string;
  };

  if (!key && !email && !phone) {
    res.status(400).json({ error: "key, email, or phone is required" });
    return;
  }

  try {
    const db = getDatabase();
    const resolvedKey = await resolvePassengerKey(db, { key, email, phone });
    if (!resolvedKey) {
      res.json({ balance: 0, currency: "NZD", entries: [], passengerKey: null });
      return;
    }

    const snap = await db.ref(`passengerWallet/${resolvedKey}`).once("value");
    const data = snap.val() ?? {};
    const balance: number = typeof data.balance === "number" ? data.balance : 0;
    const entriesObj: Record<string, any> = data.entries ?? {};
    const entries = Object.entries(entriesObj)
      .map(([id, e]) => ({ id, ...(e as Record<string, any>) }) as Record<string, any>)
      .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));

    const abuseSnap = await db.ref(`passengerCancelAbuse/${resolvedKey}`).once("value");
    const abuse = (abuseSnap.val() ?? {}) as Record<string, any>;
    res.setHeader("Cache-Control", "no-store");
    res.json({
      balance,
      currency: data.currency ?? "NZD",
      entries,
      passengerKey: resolvedKey,
      cardOnly: abuse.cardOnly === true,
      cashCancelWarning: abuse.warning === true || (Array.isArray(abuse.cashCancels) && abuse.cashCancels.length >= 3),
      cashCancelCount: Array.isArray(abuse.cashCancels) ? abuse.cashCancels.length : 0,
    });
  } catch (err: any) {
    req.log.error({ err }, "GET /wallet error");
    res.status(500).json({ error: err.message });
  }
});

export default myRidesRouter;
