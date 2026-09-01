/**
 * Passenger-app booking create/cancel/edit — mounted at /api/booking/*.
 * Uses Admin SDK (same Firebase as website bookings) so live create no longer 404s.
 */
import { Router, type Request, type Response } from "express";
import { getAuth, getDatabase } from "../lib/firebase";
import {
  sendBookingCreatedEmails,
  sendBookingUpdatedEmails,
  sendBookingCancelledEmails,
} from "../lib/bookingNotifyEmails";

const bookingRouter = Router();

function paymentStatusOf(row: Record<string, unknown> | null | undefined): string {
  return String(row?.paymentStatus ?? row?.PaymentStatus ?? "")
    .trim()
    .toLowerCase();
}

function bookingEmailPayload(row: Record<string, unknown>, jobId: string) {
  return {
    ...row,
    BookingId: jobId,
    PickAddress: row.PickupAddress ?? row.pickupAddress ?? row.PickAddress,
    DropAddress: row.DropoffAddress ?? row.dropoffAddress ?? row.DropAddress,
    PassengerName: row.PassengerName ?? row.passengerName,
    PassengerPhone: row.PassengerPhone ?? row.passengerPhone ?? row.PhoneNo,
    PassengerEmail: row.PassengerEmail ?? row.passengerEmail ?? row.Email,
    Fare: row.EstimatedFare ?? row.estimatedFare ?? row.Fare ?? row.CustomeRate,
    paymentMethod: row.paymentMethod ?? row.PaymentMethod,
    ScheduledFor: row.ScheduledFor ?? row.scheduledFor,
    ScheduledForMs: row.ScheduledFor ?? row.scheduledFor ?? row.ScheduledForMs,
    Info: row.Info ?? row.Notes ?? row.notes ?? "",
    Stops: row.Stops ?? row.stops ?? [],
  };
}

async function requireUid(req: Request): Promise<string> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw Object.assign(new Error("Unauthorized — missing Authorization header"), { status: 401 });
  }
  const token = authHeader.slice(7);
  const decoded = await getAuth().verifyIdToken(token);
  return decoded.uid;
}

function isCardHold(rtdbData: Record<string, unknown>): boolean {
  const st = String(rtdbData.Status ?? rtdbData.status ?? "").toLowerCase().replace(/[_\s]/g, "");
  if (st === "pendingpayment" || st === "paymentpending") return true;
  const method = String(rtdbData.paymentMethod ?? rtdbData.PaymentMethod ?? "").toLowerCase();
  const paySt = String(rtdbData.paymentStatus ?? rtdbData.PaymentStatus ?? "").toLowerCase();
  return method === "card" && paySt !== "paid";
}

function isScheduledBooking(rtdbData: Record<string, unknown>): boolean {
  const sched = Number(rtdbData.ScheduledFor ?? rtdbData.scheduledFor ?? rtdbData.ScheduledForMs ?? 0);
  if (Number.isFinite(sched) && sched > Date.now() + 60_000) return true;
  const st = String(rtdbData.Status ?? rtdbData.status ?? "").toLowerCase();
  return st === "scheduled";
}

/** POST /api/booking/create */
bookingRouter.post("/booking/create", async (req: Request, res: Response) => {
  let uid: string;
  try {
    uid = await requireUid(req);
  } catch (e: any) {
    res.status(e.status ?? 401).json({ error: e.message ?? "Unauthorized" });
    return;
  }

  const { companyId, jobId, passengerUid, rtdbData, firestoreData } = req.body as {
    companyId?: string;
    jobId?: string;
    passengerUid?: string;
    rtdbData?: Record<string, unknown>;
    firestoreData?: Record<string, unknown>;
  };

  if (!companyId || !jobId || !rtdbData || typeof rtdbData !== "object") {
    res.status(400).json({ error: "Missing required fields: companyId, jobId, rtdbData" });
    return;
  }

  // Prefer authenticated uid; body passengerUid must match when provided.
  const paxKey = String(passengerUid || uid).trim() || uid;
  if (passengerUid && String(passengerUid).trim() !== uid) {
    res.status(403).json({ error: "passengerUid does not match authenticated user" });
    return;
  }

  const hold = isCardHold(rtdbData);
  const scheduled = isScheduledBooking(rtdbData);
  const nowIso = new Date().toISOString();

  // Stamp identity so verify-and-dispatch can update the same Passengerjobs key.
  const enriched: Record<string, unknown> = {
    ...rtdbData,
    passengerId: paxKey,
    PassengerId: paxKey,
    passengerUid: paxKey,
    PassengerUid: paxKey,
    CompanyId: companyId,
    companyId,
    BookingId: jobId,
    Id: jobId,
    jobId,
    UpdatedAt: nowIso,
    updatedAt: nowIso,
  };

  try {
    const db = getDatabase();
    const writes: Promise<unknown>[] = [];

    // Card hold: allbookings + Passengerjobs only — pendingjobs after Stripe confirms.
    // Non-card ASAP: pendingjobs immediately.
    // Non-card scheduled: pendingjobs with Status Scheduled so dispatch can see the prebook.
    if (!hold) {
      writes.push(db.ref(`pendingjobs/${companyId}/${jobId}`).set(enriched));
    }

    // allbookings + Passengerjobs/{firebaseUid} are required for My Rides / Scheduled tab.
    writes.push(db.ref(`allbookings/${companyId}/${jobId}`).set(enriched));
    writes.push(db.ref(`Passengerjobs/${paxKey}/${jobId}`).set(enriched));

    // Also index phone → uid so verify path can find the passenger row.
    const phone = String(enriched.PassengerPhone ?? enriched.passengerPhone ?? enriched.PhoneNo ?? enriched.phone ?? "")
      .replace(/[^0-9]/g, "");
    if (phone.length >= 8) {
      writes.push(db.ref(`passengerIndex/phone/${phone}`).update({ key: paxKey, uid: paxKey }));
    }

    await Promise.all(writes);

    // Confirmation emails for non-card (cash/account/wallet) once saved.
    // Card emails fire from verify-and-dispatch after Stripe succeeds.
    if (!hold) {
      const passengerEmail =
        String(enriched.PassengerEmail ?? enriched.passengerEmail ?? enriched.Email ?? "").trim() ||
        undefined;
      const companyEmail =
        String(enriched.CompanyEmail ?? enriched.companyEmail ?? "").trim() || undefined;
      const companyName =
        String(enriched.CompanyName ?? enriched.companyName ?? "").trim() || undefined;
      sendBookingCreatedEmails({
        booking: {
          ...enriched,
          BookingId: jobId,
          PickAddress: enriched.PickupAddress ?? enriched.pickupAddress ?? enriched.PickAddress,
          DropAddress: enriched.DropoffAddress ?? enriched.dropoffAddress ?? enriched.DropAddress,
          PassengerName: enriched.PassengerName ?? enriched.passengerName,
          PassengerPhone: enriched.PassengerPhone ?? enriched.passengerPhone ?? enriched.PhoneNo,
          PassengerEmail: passengerEmail,
          Fare: enriched.EstimatedFare ?? enriched.estimatedFare ?? enriched.Fare,
          paymentMethod: enriched.paymentMethod ?? enriched.PaymentMethod,
          ScheduledFor: enriched.ScheduledFor ?? enriched.scheduledFor,
          ScheduledForMs: enriched.ScheduledFor ?? enriched.scheduledFor,
        },
        companyId,
        companyName,
        companyEmail,
        passengerEmail,
        isScheduled: scheduled,
        isCardPayment: false,
        log: req.log,
      }).catch((e) => req.log.warn({ err: e, jobId }, "booking create emails failed"));
    }

    // firestoreData accepted for forward-compat; RTDB is source of truth for dispatch/app.
    if (firestoreData) {
      req.log.info({ jobId, companyId }, "booking/create: firestoreData ignored (RTDB canonical)");
    }

    req.log.info({ companyId, jobId, hold, scheduled, paxKey }, "POST /booking/create ok");
    res.json({ success: true, jobId, heldForPayment: hold });
  } catch (err: any) {
    req.log.error({ err }, "POST /booking/create failed");
    res.status(503).json({ error: err?.message ?? "Booking create failed" });
  }
});

/** POST /api/booking/cancel */
bookingRouter.post("/booking/cancel", async (req: Request, res: Response) => {
  let uid: string;
  try {
    uid = await requireUid(req);
  } catch (e: any) {
    res.status(e.status ?? 401).json({ error: e.message ?? "Unauthorized" });
    return;
  }

  const { companyId, jobId, cancelFields, passengerUid, mode } = req.body as {
    companyId?: string;
    jobId?: string;
    cancelFields?: Record<string, unknown>;
    passengerUid?: string;
    mode?: "abort" | "intentional";
  };

  if (!companyId || !jobId || !cancelFields) {
    res.status(400).json({ error: "Missing required fields: companyId, jobId, cancelFields" });
    return;
  }

  const paxKey = String(passengerUid || uid).trim() || uid;
  const abortMode = mode === "abort";
  const patch: Record<string, unknown> = {
    ...cancelFields,
    UpdatedAt: new Date().toISOString(),
  };

  try {
    const db = getDatabase();
    const abSnap = await db.ref(`allbookings/${companyId}/${jobId}`).once("value");
    const existing = (abSnap.val() || {}) as Record<string, unknown>;
    const pay = paymentStatusOf(existing);

    // Abort cleanup must never wipe a booking that already paid successfully.
    if (abortMode && (pay === "paid" || pay === "confirmed")) {
      req.log.info({ companyId, jobId, pay }, "booking/cancel abort refused — already paid");
      res.json({ success: true, skipped: true, reason: "already_paid" });
      return;
    }

    const nowIso = new Date().toISOString();
    const prevHistory = Array.isArray(existing.editHistory)
      ? existing.editHistory
      : Array.isArray(existing.EditHistory)
        ? existing.EditHistory
        : [];
    const historyEntry = !abortMode
      ? {
          at: nowIso,
          by: "passenger",
          actorName: "passenger_app",
          summary: "Passenger cancelled booking",
          changes: ["Passenger cancelled booking"],
          fields: ["Status", "CancelledBy", "CancelledAt", "CancelReason"],
        }
      : null;
    const patchWithHistory: Record<string, unknown> = {
      ...patch,
      UpdatedAt: nowIso,
      updatedAt: nowIso,
      ...(historyEntry
        ? {
            editHistory: [...prevHistory, historyEntry],
            EditHistory: [...prevHistory, historyEntry],
          }
        : {}),
    };

    await Promise.all([
      db.ref(`pendingjobs/${companyId}/${jobId}`).update(patchWithHistory),
      db.ref(`allbookings/${companyId}/${jobId}`).update(patchWithHistory),
      db.ref(`Passengerjobs/${paxKey}/${jobId}`).update(patchWithHistory),
    ]);

    // Company (+ passenger) cancel email for scheduled/later jobs on intentional cancel.
    const merged: Record<string, unknown> = { ...existing, ...patchWithHistory };
    if (!abortMode && isScheduledBooking(merged)) {
      const passengerEmail =
        String(merged.PassengerEmail ?? merged.passengerEmail ?? merged.Email ?? "").trim() || undefined;
      sendBookingCancelledEmails({
        booking: bookingEmailPayload(merged, jobId),
        companyId,
        companyName: String(merged.CompanyName ?? merged.companyName ?? "").trim() || undefined,
        companyEmail: String(merged.CompanyEmail ?? merged.companyEmail ?? "").trim() || undefined,
        passengerEmail,
        log: req.log,
      }).catch((e) => req.log.warn({ err: e, jobId }, "booking cancel emails failed"));
    }

    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "POST /booking/cancel failed");
    res.status(503).json({ error: err?.message ?? "Cancel failed" });
  }
});

/** POST /api/booking/edit */
bookingRouter.post("/booking/edit", async (req: Request, res: Response) => {
  let uid: string;
  try {
    uid = await requireUid(req);
  } catch (e: any) {
    res.status(e.status ?? 401).json({ error: e.message ?? "Unauthorized" });
    return;
  }

  const { companyId, jobId, editFields, passengerUid, changeSummary, notifyCompany } = req.body as {
    companyId?: string;
    jobId?: string;
    editFields?: Record<string, unknown>;
    passengerUid?: string;
    changeSummary?: string[];
    notifyCompany?: boolean;
  };

  if (!companyId || !jobId || !editFields) {
    res.status(400).json({ error: "Missing required fields: companyId, jobId, editFields" });
    return;
  }

  const paxKey = String(passengerUid || uid).trim() || uid;
  const nowIso = new Date().toISOString();
  const summary = Array.isArray(changeSummary) ? changeSummary.filter(Boolean).map(String) : [];

  try {
    const db = getDatabase();
    const abSnap = await db.ref(`allbookings/${companyId}/${jobId}`).once("value");
    const existing = (abSnap.val() || {}) as Record<string, unknown>;
    const prevHistory = Array.isArray(existing.editHistory)
      ? existing.editHistory
      : Array.isArray(existing.EditHistory)
        ? existing.EditHistory
        : [];

    const historyEntry = {
      at: nowIso,
      by: "passenger",
      actorName: "passenger_app",
      summary: summary.length ? summary.join("; ") : "Passenger updated booking",
      changes: summary,
      fields: Object.keys(editFields),
    };

    const patch: Record<string, unknown> = {
      ...editFields,
      UpdatedAt: nowIso,
      updatedAt: nowIso,
      editHistory: [...prevHistory, historyEntry],
      EditHistory: [...prevHistory, historyEntry],
    };

    const writes: Promise<unknown>[] = [
      db.ref(`allbookings/${companyId}/${jobId}`).update(patch),
      db.ref(`Passengerjobs/${paxKey}/${jobId}`).update(patch),
    ];

    // Only touch pendingjobs when a real dispatch row already exists (avoid sparse remnants).
    const pjSnap = await db.ref(`pendingjobs/${companyId}/${jobId}`).once("value");
    if (pjSnap.exists() && pjSnap.val() && typeof pjSnap.val() === "object") {
      const pj = pjSnap.val() as Record<string, unknown>;
      const keys = Object.keys(pj);
      if (keys.length > 3) {
        writes.push(db.ref(`pendingjobs/${companyId}/${jobId}`).update(patch));
      }
    }

    await Promise.all(writes);

    const merged = { ...existing, ...patch };
    const scheduled = isScheduledBooking(merged);
    const shouldEmail = notifyCompany !== false && (scheduled || summary.length > 0);
    if (shouldEmail) {
      const passengerEmail =
        String(merged.PassengerEmail ?? merged.passengerEmail ?? merged.Email ?? "").trim() || undefined;
      sendBookingUpdatedEmails({
        booking: bookingEmailPayload(merged, jobId),
        companyId,
        companyName: String(merged.CompanyName ?? merged.companyName ?? "").trim() || undefined,
        companyEmail: String(merged.CompanyEmail ?? merged.companyEmail ?? "").trim() || undefined,
        passengerEmail,
        changeSummary: summary.length ? summary : ["Passenger updated booking details"],
        scheduleChanged: summary.some((s) => /time|schedule|date/i.test(s)),
        log: req.log,
      }).catch((e) => req.log.warn({ err: e, jobId }, "booking edit emails failed"));
    }

    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err }, "POST /booking/edit failed");
    res.status(503).json({ error: err?.message ?? "Edit failed" });
  }
});

/**
 * POST /api/notify-booking — company (+ optional passenger) email for scheduled app bookings.
 * Thin wrapper around the same sendBookingCreatedEmails used by POST /bookings.
 */
bookingRouter.post("/notify-booking", async (req: Request, res: Response) => {
  const b = req.body as Record<string, any>;
  const companyEmail = String(b.companyEmail ?? b.CompanyEmail ?? "").trim();
  const bookingId = String(b.bookingId ?? b.BookingId ?? "").trim();
  const pickup = String(b.pickup ?? b.PickAddress ?? "").trim();
  const destination = String(b.destination ?? b.DropAddress ?? "").trim();
  const companyId = String(b.companyId ?? "").trim() || undefined;

  if ((!companyEmail && !companyId) || !bookingId || !pickup || !destination) {
    res.status(400).json({
      error: "companyEmail (or companyId), bookingId, pickup and destination are required",
    });
    return;
  }

  const scheduledFor = b.scheduledFor ?? b.ScheduledFor ?? null;
  const scheduledMs = scheduledFor ? new Date(scheduledFor).getTime() : 0;
  const payment = String(b.payment ?? "cash").toLowerCase();

  try {
    await sendBookingCreatedEmails({
      booking: {
        BookingId: bookingId,
        PassengerName: b.passengerName ?? "Passenger",
        PassengerPhone: b.passengerPhone ?? "",
        PassengerEmail: b.passengerEmail ?? "",
        PickAddress: pickup,
        DropAddress: destination,
        Stops: Array.isArray(b.stops) ? b.stops : [],
        VehicleType: b.vehicleType ?? "Taxi",
        Fare: String(b.fare ?? "").replace(/[^0-9.]/g, "") || undefined,
        paymentMethod: payment,
        ScheduledFor: Number.isFinite(scheduledMs) && scheduledMs > 0 ? scheduledMs : 0,
        ScheduledForMs: Number.isFinite(scheduledMs) && scheduledMs > 0 ? scheduledMs : 0,
        Info: b.notes ?? "",
      },
      companyId,
      companyName: b.companyName,
      companyEmail: companyEmail || undefined,
      passengerEmail: b.passengerEmail,
      isScheduled: Number.isFinite(scheduledMs) && scheduledMs > Date.now(),
      isCardPayment: payment === "card",
      log: req.log,
    });
    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "POST /notify-booking failed");
    res.status(500).json({ error: err?.message ?? "Email send failed" });
  }
});

export default bookingRouter;
