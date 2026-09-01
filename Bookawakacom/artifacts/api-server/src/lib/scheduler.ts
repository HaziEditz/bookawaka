/**
 * Scheduled-booking auto-dispatch scheduler
 *
 * When a "Later" cash booking is created we store a lightweight record in
 * `scheduledDispatch/{companyId}/{bookingId}` containing just the fields
 * needed to trigger dispatch at the right moment.
 *
 * On server start we load all pending records, arm a timer for each one, and
 * when the timer fires we:
 *   1. Re-read the booking from `allbookings` to confirm it is still "Scheduled"
 *      (passenger may have cancelled it in the meantime).
 *   2. Write the full booking to `pendingjobs` so the dispatcher sees it.
 *   3. Update `allbookings` Status + BookingStatus → "Pending".
 *   4. Delete the `scheduledDispatch` index record.
 *
 * Node.js `setTimeout` is capped at ~24.8 days (max 32-bit signed ms). For
 * bookings further in the future than MAX_TIMER_MS we re-arm a shorter timer
 * that fires MAX_TIMER_MS later and recalculates — so arbitrarily far-future
 * bookings work correctly even across re-checks.
 */

import type { DataSnapshot } from "firebase-admin/database";
import { getDatabase } from "./firebase";
import { logger } from "./logger";

export interface ScheduledDispatchRecord {
  companyId: string;
  bookingId: string;
  notifyAt: string;
}

const MAX_TIMER_MS = 2_147_483_647; // ~24.8 days, Node.js setTimeout upper limit
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function timerKey(companyId: string, bookingId: string) {
  return `${companyId}::${bookingId}`;
}

async function dispatchNow(companyId: string, bookingId: string) {
  const db = getDatabase();
  const key = timerKey(companyId, bookingId);
  timers.delete(key);

  try {
    const snap = await db.ref(`/allbookings/${companyId}/${bookingId}`).get();
    if (!snap.exists()) {
      logger.warn({ companyId, bookingId }, "scheduler: booking not found in allbookings — skipping");
      await db.ref(`/scheduledDispatch/${companyId}/${bookingId}`).remove();
      return;
    }

    const booking = snap.val() as Record<string, unknown>;
    // Prefer BookingStatus when present — Status alone was historically left Pending
    // while BookingStatus stayed Scheduled (live #8692608313 split-brain).
    const currentStatus = String(
      booking.BookingStatus ?? booking.Status ?? booking.status ?? "",
    ).trim();

    if (currentStatus !== "Scheduled") {
      logger.info(
        { companyId, bookingId, currentStatus },
        "scheduler: booking is no longer Scheduled (likely cancelled or already dispatched) — skipping"
      );
      await db.ref(`/scheduledDispatch/${companyId}/${bookingId}`).remove();
      return;
    }

    // Always set BookingStatus + Status together — Offer-tab reads Status while
    // accept/auto-dispatch require BookingStatus === Pending.
    const pendingFields = {
      Status: "Pending",
      status: "Pending",
      BookingStatus: "Pending",
    };
    await Promise.all([
      db.ref(`/pendingjobs/${companyId}/${bookingId}`).set({ ...booking, ...pendingFields }),
      db.ref(`/allbookings/${companyId}/${bookingId}`).update(pendingFields),
      db.ref(`/scheduledDispatch/${companyId}/${bookingId}`).remove(),
    ]);

    logger.info({ companyId, bookingId }, "scheduler: booking moved to pendingjobs for dispatch");
  } catch (err) {
    logger.error({ err, companyId, bookingId }, "scheduler: failed to dispatch booking");
  }
}

function armTimer(companyId: string, bookingId: string, notifyAt: Date) {
  const key = timerKey(companyId, bookingId);

  if (timers.has(key)) {
    clearTimeout(timers.get(key)!);
  }

  const msUntil = notifyAt.getTime() - Date.now();

  if (msUntil <= 0) {
    logger.info({ companyId, bookingId }, "scheduler: dispatch time already passed — dispatching immediately");
    void dispatchNow(companyId, bookingId);
    return;
  }

  const delay = Math.min(msUntil, MAX_TIMER_MS);
  const t = setTimeout(() => {
    if (msUntil > MAX_TIMER_MS) {
      // Not yet time — re-arm for another round
      armTimer(companyId, bookingId, notifyAt);
    } else {
      void dispatchNow(companyId, bookingId);
    }
  }, delay);

  t.unref();
  timers.set(key, t);
}

/**
 * Register a new scheduled booking. Call this immediately after the booking is
 * written to Firebase so the timer is armed without waiting for a server restart.
 */
export function registerScheduledDispatch(record: ScheduledDispatchRecord) {
  const db = getDatabase();
  const notifyAt = new Date(record.notifyAt);

  db.ref(`/scheduledDispatch/${record.companyId}/${record.bookingId}`)
    .set(record)
    .catch((err: unknown) =>
      logger.error({ err, record }, "scheduler: failed to persist scheduledDispatch record")
    );

  armTimer(record.companyId, record.bookingId, notifyAt);
  logger.info(
    { companyId: record.companyId, bookingId: record.bookingId, notifyAt: record.notifyAt },
    "scheduler: timer armed"
  );
}

/**
 * Cancel a scheduled dispatch (e.g. passenger cancelled the booking).
 */
export function cancelScheduledDispatch(companyId: string, bookingId: string) {
  const key = timerKey(companyId, bookingId);
  const t = timers.get(key);
  if (t) {
    clearTimeout(t);
    timers.delete(key);
  }

  const db = getDatabase();
  db.ref(`/scheduledDispatch/${companyId}/${bookingId}`)
    .remove()
    .catch((err: unknown) =>
      logger.error({ err, companyId, bookingId }, "scheduler: failed to remove scheduledDispatch record on cancel")
    );

  logger.info({ companyId, bookingId }, "scheduler: timer cancelled");
}

/**
 * Load all pending scheduled-dispatch records from Firebase and arm timers.
 * Called once on server startup.
 */
export async function initScheduler() {
  const db = getDatabase();

  try {
    const snap = await db.ref("/scheduledDispatch").get();
    if (!snap.exists()) {
      logger.info("scheduler: no pending scheduled dispatches on startup");
      return;
    }

    let count = 0;
    snap.forEach((companySnap: DataSnapshot) => {
      companySnap.forEach((bookingSnap: DataSnapshot) => {
        const record = bookingSnap.val() as ScheduledDispatchRecord;
        if (record?.notifyAt) {
          armTimer(record.companyId, record.bookingId, new Date(record.notifyAt));
          count++;
        }
      });
    });

    logger.info({ count }, "scheduler: timers armed from Firebase on startup");
  } catch (err) {
    logger.error({ err }, "scheduler: failed to load scheduledDispatch on startup");
  }
}
