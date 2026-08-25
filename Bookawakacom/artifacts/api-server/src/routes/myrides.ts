import { Router } from "express";
import { getDatabase } from "../lib/firebase";
import { cancelScheduledDispatch, registerScheduledDispatch } from "../lib/scheduler";
import { creditWallet } from "../lib/wallet";
import { resolvePassengerWalletKey } from "../lib/passengerKey";
import { formatNzBookingDateTime } from "../lib/formatNzBookingDateTime";
import {
  sendBookingCancelledEmails,
  sendBookingUpdatedEmails,
} from "../lib/bookingNotifyEmails";

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

  try {
    const db = getDatabase();
    const resolvedKey = await resolvePassengerKey(db, { key, email, phone });

    if (!resolvedKey) {
      res.json({ rides: [], passengerKey: null });
      return;
    }

    const snap = await db.ref(`Passengerjobs/${resolvedKey}`).once("value");
    const data = snap.val() ?? {};
    const rides = Object.values(data) as any[];

    // Authoritative-status overlay. Passengerjobs is the per-passenger index, but
    // dispatch HQ (SA Portal / driver app) only writes Status updates to
    // allbookings/{companyId}/{bookingId} — they don't fan-out to Passengerjobs.
    // Without this overlay, the My Rides page shows forever-stale "Pending" rows
    // even when the trip has been Offered / Assigned / Completed in dispatch.
    // We read allbookings for each ride in parallel and patch the live fields
    // (Status / status / DriverId / paymentStatus / CancelledAt). Reads are
    // best-effort: if one fails the original ride is returned unchanged.
    const overlaid = await Promise.all(
      rides.map(async (r: any) => {
        const cid = r?.CompanyId ?? r?.companyId;
        const bid = r?.BookingId;
        if (!cid || !bid) return r;
        try {
          const liveSnap = await db.ref(`allbookings/${cid}/${bid}`).once("value");
          const live = liveSnap.val();
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
          };
        } catch (e) {
          req.log.warn({ e, cid, bid }, "my-rides: allbookings overlay read failed");
          return r;
        }
      })
    );

    // Never cache — this endpoint is polled live to track payment/status changes
    res.setHeader("Cache-Control", "no-store");
    res.json({ rides: overlaid, passengerKey: resolvedKey });
  } catch (err: any) {
    req.log.error({ err }, "GET /my-rides error");
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

    const cancellable = [
      "Scheduled", "scheduled",
      "Pending", "pending",
      "PendingPayment", "pendingpayment", "paymentpending",
      // Dispatcher pool / waiting states — passenger still sees "Looking for driver".
      "No One", "no one", "NoOne", "noone",
      "Waiting", "waiting",
      "Queued", "queued",
      // "Offered" = dispatch presented the job to a driver; no driver has accepted yet,
      // so passenger-initiated cancel is still allowed (same as Pending).
      "Offered", "offered", "Offer", "offer", "Offering", "offering",
    ];
    if (currentStatus && !cancellable.includes(currentStatus)) {
      res.status(409).json({
        error: `Cannot cancel a job with status "${currentStatus}". Contact the company directly.`,
      });
      return;
    }

    // --- Wallet credit logic (NO Stripe refund) ---
    // Policy: card-paid cancellations are credited to the passenger's BookaWaka wallet,
    // never refunded back to the card. Passenger sees a notice on /book before paying so
    // they know this upfront. Wallet balance can be spent on future bookings.
    // No credit is issued if a driver has already been assigned (consistent with the old
    // "no refund after driver assigned" rule).
    let walletCredited = false;
    let walletCreditAmount: number | null = null;
    let driverAssigned = false;

    const paymentMethod: string | null = booking?.paymentMethod ?? null;
    const paymentStatus: string | null = booking?.paymentStatus ?? null;
    const fareRaw: string | number | null = booking?.Fare ?? booking?.fare ?? null;

    if (paymentMethod === "card" && paymentStatus === "paid") {
      const driverId = booking?.DriverId ?? booking?.driverId ?? booking?.assignedDriver ?? null;
      driverAssigned = !!(driverId && String(driverId).trim() !== "");

      if (!driverAssigned) {
        const fareNum = typeof fareRaw === "number" ? fareRaw : parseFloat(String(fareRaw ?? ""));
        if (Number.isFinite(fareNum) && fareNum > 0) {
          const cents = Math.round(fareNum * 100);
          const walletRef = db.ref(`passengerWallet/${key}`);
          const entryRef = walletRef.child("entries").push();
          const entryId = entryRef.key!;
          const nowIso = new Date().toISOString();

          // Atomic balance increment via transaction (cents to avoid float drift)
          const txResult = await walletRef.child("balanceCents").transaction(
            (current: number | null) => (typeof current === "number" ? current : 0) + cents
          );
          if (txResult.committed) {
            const newBalanceCents = txResult.snapshot.val() as number;
            await walletRef.update({
              balance: +(newBalanceCents / 100).toFixed(2),
              currency: "NZD",
              updatedAt: nowIso,
              [`entries/${entryId}`]: {
                amount: +(cents / 100).toFixed(2),
                amountCents: cents,
                type: "credit",
                reason: "cancellation",
                jobId,
                companyId,
                createdAt: nowIso,
              },
            });
            walletCredited = true;
            walletCreditAmount = +(cents / 100).toFixed(2);
            req.log.info(
              { jobId, companyId, key, walletCreditAmount, newBalance: newBalanceCents / 100 },
              "Wallet credit issued for cancellation"
            );
          } else {
            req.log.error({ jobId, key }, "Wallet credit transaction failed — cancelling anyway");
          }
        } else {
          req.log.warn({ jobId, fareRaw }, "Card-paid cancellation but Fare not parseable — no wallet credit");
        }
      }
    } else if (paymentMethod === "wallet" && paymentStatus === "paid") {
      const driverId = booking?.DriverId ?? booking?.driverId ?? booking?.assignedDriver ?? null;
      driverAssigned = !!(driverId && String(driverId).trim() !== "");

      if (!driverAssigned) {
        const spentRaw =
          booking?.walletAmountApplied ??
          (typeof fareRaw === "number" ? fareRaw : parseFloat(String(fareRaw ?? "")));
        const spentNum = typeof spentRaw === "number" ? spentRaw : parseFloat(String(spentRaw ?? ""));
        if (Number.isFinite(spentNum) && spentNum > 0) {
          const cents = Math.round(spentNum * 100);
          const credit = await creditWallet(db, key, cents, {
            reason: "cancellation",
            jobId,
            companyId,
            note: "Wallet-paid booking cancelled before driver assigned",
          });
          if (credit.ok) {
            walletCredited = true;
            walletCreditAmount = +(cents / 100).toFixed(2);
            req.log.info(
              { jobId, companyId, key, walletCreditAmount },
              "Wallet spend refunded for wallet-paid cancellation"
            );
          } else {
            req.log.error({ jobId, key, err: credit.error }, "Wallet refund failed — cancelling anyway");
          }
        }
      }
    }

    const cancelledAt = new Date().toISOString();
    const updates: Record<string, any> = {};

    const cancelFields: Record<string, any> = {
      Status: "Cancelled",
      status: "Cancelled",
      CancelledAt: cancelledAt,
      CancelledBy: "passenger",
      ...(walletCredited ? { refundStatus: "wallet_credited", walletCreditAmount } : {}),
      ...(driverAssigned && (paymentMethod === "card" || paymentMethod === "wallet")
        ? { refundStatus: "not_credited_driver_assigned" }
        : {}),
    };

    // Write cancellation fields to allbookings and Passengerjobs
    for (const [field, value] of Object.entries(cancelFields)) {
      updates[`allbookings/${companyId}/${jobId}/${field}`] = value;
      updates[`Passengerjobs/${key}/${jobId}/${field}`] = value;
    }

    // Alert the dispatcher by writing Status: "Cancelled" to pendingjobs — the SA
    // dispatch system listens to pendingjobs in real-time and will surface the
    // cancellation to the dispatcher/driver immediately.
    // If there was no pendingjobs entry (e.g. payment was never confirmed), this
    // write is a no-op from the dispatcher's perspective — Firebase ignores writes
    // to paths that don't affect existing listeners.
    for (const [field, value] of Object.entries(cancelFields)) {
      updates[`pendingjobs/${companyId}/${jobId}/${field}`] = value;
    }

    await db.ref().update(updates);

    // Cancel any pending auto-dispatch timer for this booking (safe no-op if none exists)
    cancelScheduledDispatch(companyId, jobId);

    // Email company + passenger on cancellation (fire-and-forget).
    const cancelledBooking = { ...(booking || {}), ...cancelFields, BookingId: booking?.BookingId ?? jobId };
    sendBookingCancelledEmails({
      booking: cancelledBooking,
      companyId,
      companyName: booking?.CompanyName,
      companyEmail: booking?.companyEmail,
      passengerEmail: booking?.PassengerEmail,
      log: req.log,
    }).catch((e) => req.log.warn({ e, jobId }, "Cancel emails failed"));

    req.log.info({ jobId, companyId, key, walletCredited, driverAssigned }, "Job cancelled — dispatcher alerted via pendingjobs Status update");
    res.json({ ok: true, walletCredited, walletCreditAmount, driverAssigned });
  } catch (err: any) {
    req.log.error({ err }, "POST /my-rides/:jobId/cancel error");
    res.status(500).json({ error: err.message });
  }
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

    res.setHeader("Cache-Control", "no-store");
    res.json({ balance, currency: data.currency ?? "NZD", entries, passengerKey: resolvedKey });
  } catch (err: any) {
    req.log.error({ err }, "GET /wallet error");
    res.status(500).json({ error: err.message });
  }
});

export default myRidesRouter;
