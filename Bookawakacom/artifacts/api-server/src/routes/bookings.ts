import { Router } from "express";
import { getDatabase } from "../lib/firebase";
import { sendMailerSendEmail } from "../lib/mailersend";
import { registerScheduledDispatch } from "../lib/scheduler";
import { normalizeEmailKey } from "../lib/passengerKey";
import { debitWallet, readWalletBalanceCents } from "../lib/wallet";
import { findActiveBooking, normalizePhoneKey } from "../lib/active-booking-guard";
import { searchNzPlaces } from "../lib/geocode-search";
import { estimateDispatchLeadMins } from "../lib/estimateDispatchLeadMins";
import { resolveCompanyEmail } from "../lib/resolveCompanyEmail";

const SA_DISPATCH_URL = "https://taxitime.co.nz/DataManager/Data.aspx";

async function notifyFoodDispatch({
  jobId,
  companyId,
  pickAddress,
  dropAddress,
  log,
}: {
  jobId: string;
  companyId: string;
  pickAddress: string;
  dropAddress: string;
  log: any;
}): Promise<void> {
  try {
    const body = JSON.stringify({
      action: "InsertBookingv4",
      params: {
        serviceType: "food",
        BookingSource: "Website",
        ExternalJobId: jobId,
        pickupAddress: pickAddress,
        dropoffAddress: dropAddress,
        companyId,
      },
    });

    const res = await fetch(SA_DISPATCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.warn({ jobId, companyId, status: res.status, body: text }, "SA food dispatch: non-OK response");
    } else {
      log.info({ jobId, companyId }, "SA food dispatch: InsertBookingv4 sent");
    }
  } catch (err: any) {
    log.error({ err, jobId, companyId }, "SA food dispatch: fetch failed");
  }
}

// SA dispatch HQ shows the time column from the BookingDateTime field, formatted
// in NZ local time as `YYYY-MM-DD HH:mm:ss.` (note the trailing dot — that's
// the literal C# DateTime.ToString() output the SA app uses).
function formatNzBookingDateTime(d: Date): string {
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

async function geocodeAddress(
  address: string,
  log: any
): Promise<{ lat: number; lng: number }> {
  try {
    const results = await searchNzPlaces(address, { limit: 1 });
    if (results.length === 0) {
      log.warn({ address }, "geocodeAddress: no results from Nominatim");
      return { lat: 0, lng: 0 };
    }
    return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
  } catch (err) {
    log.warn({ err, address }, "geocodeAddress: Nominatim lookup failed");
    return { lat: 0, lng: 0 };
  }
}

const bookingsRouter = Router();

bookingsRouter.get("/bookings/active-check", async (req, res) => {
  const { phone, serviceType } = req.query as { phone?: string; serviceType?: string };

  if (!phone?.trim() || !serviceType?.trim()) {
    res.status(400).json({ error: "phone and serviceType are required" });
    return;
  }

  try {
    const match = await findActiveBooking(phone.trim(), serviceType.trim());
    if (!match) {
      res.json({ hasActive: false });
      return;
    }
    res.json({
      hasActive: true,
      code: "DUPLICATE_ACTIVE_BOOKING",
      existingBookingId: match.existingBookingId,
      existingStatus: match.existingStatus,
      serviceType: match.serviceType,
      message: `You already have an active ${match.serviceType} booking (#${match.existingBookingId}).`,
    });
  } catch (err: any) {
    req.log.warn({ err }, "GET /bookings/active-check error");
    res.json({ hasActive: false });
  }
});

bookingsRouter.post("/bookings", async (req, res) => {
  const {
    jobId,
    passengerKey,
    companyId,
    companyName,
    companyEmail,
    serviceType,
    passengerName,
    passengerPhone,
    passengerEmail,
    pickAddress,
    dropAddress,
    scheduledFor,
    notes,
    amount,
    paymentMethod,
    vehicleType,
    passengers,
    pickLat,
    pickLng,
    dropLat,
    dropLng,
    restaurantId,
    restaurantName,
    orderItems,
    notifyDispatchBeforeMinutes,
    accountNumber,
    tmCardNumber,
    giftCardCode,
    useWallet,
  } = req.body as {
    jobId?: string;
    passengerKey?: string;
    companyId?: string;
    companyName?: string;
    companyEmail?: string;
    serviceType?: string;
    passengerName?: string;
    passengerPhone?: string;
    passengerEmail?: string;
    pickAddress?: string;
    dropAddress?: string;
    scheduledFor?: string;
    vehicleType?: string;
    passengers?: number;
    notes?: string;
    amount?: number;
    paymentMethod?: "card" | "account" | "acc" | "tm" | "giftcard" | "cash";
    pickLat?: number;
    pickLng?: number;
    dropLat?: number;
    dropLng?: number;
    restaurantId?: string;
    restaurantName?: string;
    orderItems?: Array<{ menuItemId: string; name: string; price: number; quantity: number }>;
    notifyDispatchBeforeMinutes?: number;
    accountNumber?: string;
    tmCardNumber?: string;
    giftCardCode?: string;
    useWallet?: boolean;
  };

  if (!companyId || !passengerName || !passengerPhone || !pickAddress || !dropAddress) {
    res.status(400).json({
      error: "companyId, passengerName, passengerPhone, pickAddress and dropAddress are required",
    });
    return;
  }

  // Normalise phone to digits-only before any storage. The SA driver app keys
  // passenger ratings (and other passenger lookups) by digits-only phone, so
  // anything written with `+`, spaces, or hyphens breaks the rating link.
  const normalizedPhone = normalizePhoneKey(passengerPhone);
  if (!normalizedPhone) {
    res.status(400).json({ error: "passengerPhone must contain digits" });
    return;
  }

  // jobId is required and MUST come from POST /api/job/create. The SA sync endpoint
  // rejects any ID that isn't 9+ digits, so we must never invent one here.
  if (!jobId || !/^\d{9,}$/.test(jobId)) {
    res.status(400).json({
      error: "Invalid jobId — must be a numeric booking ID from /api/job/create",
    });
    return;
  }

  const now = new Date();
  const bookingId = jobId;

  const scheduledDate = scheduledFor && scheduledFor.trim() ? new Date(scheduledFor) : null;
  const isScheduled = scheduledDate !== null && scheduledDate.getTime() > now.getTime();

  // ---- Duplicate-active-booking guard ----------------------------------
  // Business rule (SA-confirmed): one ASAP booking per (phone, service) at a
  // time. Passenger must wait for it to complete OR cancel it before booking
  // another ASAP of the same service. Scheduled (future) bookings are exempt
  // — passengers can hold a few future bookings concurrently.
  //
  // Authoritative status is read from allbookings (NOT Passengerjobs which
  // can lag behind dispatch updates). We resolve the passenger by digits-only
  // phone via passengerIndex.
  //
  // Terminal states do NOT count as active: Completed, Closed, Cancelled,
  // NoShow, Declined (driver declined → dispatch reassigns, but if the whole
  // booking ends up Declined permanently that's terminal from passenger PoV).
  const normalizedServiceType = (serviceType ?? "").toLowerCase().trim();
  if (!isScheduled && normalizedServiceType) {
    try {
      const match = await findActiveBooking(passengerPhone, serviceType ?? "", bookingId);
      if (match) {
        res.status(409).json({
          error: `You already have an active ${serviceType} booking (#${match.existingBookingId}). Please wait for it to be completed or cancel it before booking another.`,
          code: "DUPLICATE_ACTIVE_BOOKING",
          existingBookingId: match.existingBookingId,
          existingStatus: match.existingStatus,
          serviceType,
        });
        return;
      }
    } catch (err) {
      req.log.warn({ err, normalizedPhone, serviceType }, "duplicate-active-booking guard read failed; allowing booking through");
    }
  }
  // ---------------------------------------------------------------------

  // Wallet spend at booking time (card flow only — verified account/ACC/TM unchanged).
  let walletAmountApplied = 0;
  let walletAmountPending = 0;
  let cardAmountDue: number | null = null;
  let walletDebitEntryId: string | null = null;
  let isWalletOnly = false;

  const fareNum = amount != null && amount > 0 ? amount : 0;
  const emailKey = passengerEmail?.trim()
    ? normalizeEmailKey(passengerEmail.trim())
    : undefined;

  if (useWallet && fareNum > 0 && paymentMethod === "card") {
    try {
      const walletDb = getDatabase();
      const walletPassengerRef = {
        key: passengerKey,
        phone: normalizedPhone,
        email: passengerEmail?.trim() ?? emailKey,
      };
      const balanceCents = await readWalletBalanceCents(walletDb, walletPassengerRef);
      const fareCents = Math.round(fareNum * 100);
      const spendCents = Math.min(balanceCents, fareCents);
      walletAmountApplied = +(spendCents / 100).toFixed(2);
      const remainderCents = fareCents - spendCents;
      cardAmountDue = remainderCents > 0 ? +(remainderCents / 100).toFixed(2) : 0;

      if (spendCents >= fareCents) {
        const debit = await debitWallet(walletDb, walletPassengerRef, fareCents, {
          reason: "booking_payment",
          jobId: bookingId,
          companyId,
        });
        if (!debit.ok) {
          res.status(402).json({ error: debit.error ?? "Insufficient wallet balance" });
          return;
        }
        walletDebitEntryId = debit.entryId;
        isWalletOnly = true;
      } else if (spendCents > 0) {
        walletAmountPending = walletAmountApplied;
      }
    } catch (err) {
      req.log.warn(
        { err, passengerKey, phone: normalizedPhone, bookingId },
        "wallet spend read/debit failed",
      );
      res.status(500).json({ error: "Could not apply wallet credit" });
      return;
    }
  }

  // Card payments hold at PendingPayment until Stripe confirms (full or remainder).
  // Wallet-only bookings dispatch immediately with paymentStatus paid.
  const isCardPayment = paymentMethod === "card" && !isWalletOnly;
  const status = isCardPayment ? "PendingPayment" : isScheduled ? "Scheduled" : "Pending";

  const fare = fareNum > 0 ? String(fareNum) : "";

  // Geocode server-side if the client didn't provide coordinates (or sent 0,0).
  // This covers addresses pre-filled from URL params and manual text entry.
  const needsPickGeocode = (!pickLat || pickLat === 0) && pickAddress;
  const needsDropGeocode = (!dropLat || dropLat === 0) && dropAddress;
  const [resolvedPick, resolvedDrop] = await Promise.all([
    needsPickGeocode
      ? geocodeAddress(pickAddress!, req.log)
      : Promise.resolve({ lat: pickLat ?? 0, lng: pickLng ?? 0 }),
    needsDropGeocode
      ? geocodeAddress(dropAddress!, req.log)
      : Promise.resolve({ lat: dropLat ?? 0, lng: dropLng ?? 0 }),
  ]);

  // SA-dispatch-canonical fields — see scripts/inspect-pending.mjs comparison.
  // SA's auto-dispatcher classifies a job as ASAP iff `ScheduledFor === 0` (numeric).
  // Its HQ time column reads `BookingDateTime` formatted as "YYYY-MM-DD HH:mm:ss."
  // in NZ local time. Both must be present or jobs land in the scheduled tab with
  // a blank time and never auto-dispatch.
  const scheduledMs = isScheduled ? scheduledDate!.getTime() : 0;
  const bookingDateTime = formatNzBookingDateTime(isScheduled ? scheduledDate! : now);
  const effectiveMethod = isWalletOnly ? "wallet" : (paymentMethod ?? "account");
  const isCard = effectiveMethod === "card";
  const isWallet = effectiveMethod === "wallet";
  const isAccount = effectiveMethod === "account" || effectiveMethod === "acc";
  const isCash = effectiveMethod === "cash";
  const pickLatLngStr = `${resolvedPick.lat},${resolvedPick.lng}`;
  const dropLatLngStr = `${resolvedDrop.lat},${resolvedDrop.lng}`;

  // Fixed price when pickup + dropoff known and a fare was pre-calculated at booking.
  // Driver app treats TarriffId === '-1' as fixed (no live meter).
  const hasDropoff =
    !!(dropAddress && String(dropAddress).trim()) &&
    (resolvedDrop.lat !== 0 || resolvedDrop.lng !== 0 || !!(dropAddress && String(dropAddress).trim()));
  const isFixedPrice = fareNum > 0 && hasDropoff;

  const paxCount = (() => {
    const n = parseInt(String(passengers ?? ""), 10);
    if (!isNaN(n) && n >= 1) return Math.min(n, 20);
    return 1;
  })();
  // 5+ passengers force Van vehicle type for dispatch eligibility.
  // "Any" / "Not Specified" / blank = open eligibility (no VehicleType stamp).
  let resolvedVehicleType = vehicleType ? String(vehicleType).trim() : "";
  if (/^(any|not\s*specified|all)$/i.test(resolvedVehicleType)) {
    resolvedVehicleType = "";
  }
  if (paxCount >= 5) {
    resolvedVehicleType = "Van";
  }

  const booking = {
    BookingId: bookingId,
    CreatedAt: now.toISOString(),
    createdAt: now.getTime(), // numeric ms — SA sort key
    CreatedBy: "WEB",
    CreatedByName: "Web Booking Portal",
    CreatedByVehicle: "",
    CompanyId: companyId,
    companyId, // lowercase alias used by some SA queries
    CompanyName: companyName ?? "",
    BookingSource: "Website",
    // Time fields — critical for SA dispatch HQ display + auto-dispatcher
    BookingDateTime: bookingDateTime,
    ScheduledFor: scheduledMs,    // numeric: 0 = ASAP, >0 = pre-book
    ScheduledForMs: scheduledMs,  // numeric: same as above (legacy alias)
    DropAddress: dropAddress,
    dropAddress, // lowercase alias
    Fare: fare,
    EstimatedFare: fare,
    ...(isFixedPrice
      ? {
          TarriffId: "-1",
          TariffId: "-1",
          TarriffType: "Fixed",
          TariffType: "Fixed",
          CustomeRate: fare,
          isFixedPrice: true,
        }
      : {}),
    Info: notes ?? "",
    PassengerEmail: passengerEmail ?? "",
    PassengerName: passengerName,
    PassengerPhone: normalizedPhone,
    passengerPhone: normalizedPhone, // lowercase — SA driver app reads this for rating linkage
    PhoneNo: normalizedPhone, // SA legacy field name
    phone: normalizedPhone, // lowercase alias used by some SA queries
    Passengers: paxCount,
    PassengersNo: paxCount,
    passengers: paxCount,
    PickAddress: pickAddress,
    pickAddress, // lowercase alias
    PickLatLng: pickLatLngStr,
    DropLatLng: dropLatLngStr,
    // Structured location objects (consumed by driver/dispatcher apps)
    pickupLocation: { address: pickAddress, lat: resolvedPick.lat, lng: resolvedPick.lng },
    dropoffLocation: { address: dropAddress, lat: resolvedDrop.lat, lng: resolvedDrop.lng },
    // Prebook flags — SA dispatch app uses these to distinguish ASAP vs pre-booked jobs
    Prebook: isScheduled,
    IsPreBook: isScheduled,
    BookingType: isScheduled ? "Prebook" : "ASAP",
    ...(isScheduled
      ? (() => {
          // Same estimate as INVT/_estimateDispatchLeadMins / passenger app — ignore client chips.
          const leadMins = estimateDispatchLeadMins(resolvedPick.lat, resolvedPick.lng);
          const notifyAt = new Date(scheduledDate!.getTime() - leadMins * 60 * 1000).toISOString();
          return {
            DispatchTimebefore: leadMins,
            Dispatchbefore: leadMins,
            NotifyDispatchBeforeMinutes: leadMins,
            NotifyDispatchAt: notifyAt,
          };
        })()
      : {}),
    ServiceType: serviceType ?? "taxi",
    Status: status,
    WebBooking: true,
    dispatcherOnly: false,
    // Vehicle type — same labels as passenger app (Sedan/SUV/Van/Luxury/Electric/Wheelchair).
    // Auto-dispatch filters on VehicleType via _driverEligibleForJob.
    ...(resolvedVehicleType
      ? { VehicleType: resolvedVehicleType, vehicleType: resolvedVehicleType }
      : {}),
    // Payment fields — SA reports read PascalCase + boolean flags
    paymentMethod: effectiveMethod,
    PaymentMethod: effectiveMethod,
    PaymentType: effectiveMethod,
    cashPayment: isCash,
    cardPayment: isCard,
    walletPayment: isWallet,
    accountPayment: isAccount,
    ...(walletAmountApplied > 0
      ? {
          walletAmountApplied,
          ...(walletAmountPending > 0 ? { walletAmountPending, cardAmountDue } : {}),
          ...(walletDebitEntryId ? { walletDebitEntryId, walletDebited: true } : {}),
        }
      : {}),
    ...(isWalletOnly ? { paymentStatus: "paid", paidAt: now.toISOString() } : {}),
    ...(restaurantId ? { RestaurantId: restaurantId, RestaurantName: restaurantName ?? "" } : {}),
    ...(orderItems && orderItems.length > 0 ? { OrderItems: orderItems } : {}),
    ...(accountNumber ? { accountNumber } : {}),
    ...(tmCardNumber ? { tmCardNumber } : {}),
    ...(giftCardCode ? { giftCardCode } : {}),
  };

  try {
    const db = getDatabase();
    const writes: Array<Promise<any>> = [];

    // Dispatch queue rules:
    // - Card payments: never write to pendingjobs immediately — wait for Stripe webhook/verify-and-dispatch.
    // - Scheduled (Later) cash bookings: stay in allbookings with Status:"Scheduled" so the SA portal
    //   shows them in its pre-booking view. They must NOT appear in pendingjobs (the immediate dispatch
    //   queue) until it is actually time to dispatch — otherwise dispatchers treat them as needing a
    //   driver right now.
    // - ASAP cash bookings: write to pendingjobs immediately for instant dispatch.
    if (!isCardPayment && !isScheduled) {
      writes.push(db.ref(`/pendingjobs/${companyId}/${bookingId}`).set(booking));
    }

    writes.push(
      db.ref(`/allbookings/${companyId}/${bookingId}`).set({
        ...booking,
        AssignedDriver: "",
        AssignedVehicle: "",
        paymentMethod: effectiveMethod,
        paymentStatus: isWalletOnly ? "paid" : isCardPayment ? "pending" : (effectiveMethod ?? "account"),
      })
    );

    if (passengerKey) {
      writes.push(
        db.ref(`/Passengerjobs/${passengerKey}/${bookingId}`).set({
          ...booking,
        })
      );

      // Phone index uses the same digits-only normalisation as the booking write
      writes.push(db.ref(`passengerIndex/phone/${normalizedPhone}`).set({ key: passengerKey }));

      if (passengerEmail) {
        const emailKey = normalizeEmailKey(passengerEmail);
        writes.push(db.ref(`passengerIndex/email/${emailKey}`).set({ key: passengerKey }));
      }

      // Bidirectional resolver row for SA Portal admin wallet endpoints.
      // SA dev confirmed: Option 1 — keep wallet storage at passengerWallet/{key}
      // forever; resolve uid→key via this index. We write the `key` side here
      // with a createdAt stamp. The `uid` side is added later, at first mobile
      // Firebase Auth sign-in (not implemented yet — Phase B).
      // Use update() not set() so we don't clobber a UID that was added later.
      writes.push(
        db.ref(`passengerIndex/key/${passengerKey}`).update({
          key: passengerKey,
          createdAt: now.toISOString(),
        })
      );
    }

    await Promise.all(writes);

    // Arm the auto-dispatch timer for scheduled cash bookings so they appear in the
    // dispatcher's live queue at the right time without manual intervention.
    if (isScheduled && !isCardPayment) {
      const leadMins = Number(booking.NotifyDispatchBeforeMinutes ?? booking.DispatchTimebefore ?? 30) || 30;
      const notifyAtMs = scheduledDate!.getTime() - leadMins * 60 * 1000;
      registerScheduledDispatch({
        companyId,
        bookingId,
        notifyAt: new Date(notifyAtMs).toISOString(),
      });
    }

    // Send email alerts (fire-and-forget — don't fail the booking if email fails).
    // ASAP cash bookings: the SA portal sends its own notifications within ~30 s of the
    // record landing in pendingjobs, so we skip website emails to avoid double-sending.
    // Scheduled cash bookings no longer go to pendingjobs at booking time, so the SA
    // portal will NOT fire — we must send the company email ourselves.
    // Card payment bookings also always get website emails.
    const saSendsEmails = !isCardPayment && !isScheduled;
    if (!saSendsEmails) {
      sendBookingEmails({
        booking,
        companyId,
        companyName,
        companyEmail,
        passengerEmail,
        isScheduled,
        isCardPayment,
        log: req.log,
      }).catch((e) => req.log.error({ e }, "Email send failed"));
    } else {
      req.log.info({ bookingId }, "Skipping website emails — SA portal handles ASAP cash booking notifications");
    }

    // Food orders: notify SA SQL dispatch API so they appear in the food panel
    if (serviceType === "food") {
      notifyFoodDispatch({
        jobId: bookingId,
        companyId,
        pickAddress,
        dropAddress,
        log: req.log,
      }).catch((e) => req.log.error({ e }, "notifyFoodDispatch unexpected error"));
    }

    res.json({ success: true, bookingId, status });
  } catch (err: any) {
    req.log.error({ err }, "POST /bookings error");
    res.status(500).json({ error: err.message });
  }
});

bookingsRouter.get("/bookings/:bookingId/payment-status", async (req, res) => {
  const { bookingId } = req.params;
  const { cid } = req.query as { cid?: string };

  if (!cid) {
    res.status(400).json({ error: "cid is required" });
    return;
  }

  try {
    const db = getDatabase();
    const snap = await db.ref(`allbookings/${cid}/${bookingId}/paymentStatus`).once("value");
    res.json({ paymentStatus: snap.val() ?? "unpaid" });
  } catch (err: any) {
    req.log.error({ err }, "GET /bookings/:bookingId/payment-status error");
    res.status(500).json({ error: err.message });
  }
});

async function sendBookingEmails({
  booking,
  companyId,
  companyName,
  companyEmail,
  passengerEmail,
  isScheduled,
  isCardPayment,
  log,
}: {
  booking: any;
  companyId?: string;
  companyName?: string;
  companyEmail?: string;
  passengerEmail?: string;
  isScheduled?: boolean;
  isCardPayment?: boolean;
  log?: { warn: (obj: object, msg?: string) => void };
}) {
  const paymentMethodLabel: Record<string, string> = {
    card: "Card (Stripe)",
    account: "Account",
    acc: "ACC",
    tm: "Total Mobility",
    giftcard: "Gift Card",
    wallet: "BookaWaka Wallet",
  };
  const pmLabel = paymentMethodLabel[booking.paymentMethod] ?? booking.paymentMethod ?? "Account";
  const fareDisplay = booking.Fare ? `NZD $${parseFloat(booking.Fare).toFixed(2)}` : "";

  const scheduledLabel = booking.ScheduledFor
    ? new Date(booking.ScheduledFor).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland" })
    : "As soon as possible";

  const paymentNote = isCardPayment
    ? `<tr><td style="padding:8px 0;font-weight:bold;color:#333;width:130px;">Payment</td><td style="padding:8px 0;color:#e67e00;font-weight:bold;">Awaiting card payment — not yet dispatched</td></tr>`
    : `<tr><td style="padding:8px 0;font-weight:bold;color:#333;width:130px;">Payment</td><td style="padding:8px 0;color:#555;">${pmLabel}${fareDisplay ? ` — ${fareDisplay}` : ""}</td></tr>`;

  const bookingDetailsHtml = `
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 0;font-weight:bold;color:#333;width:130px;">Booking ID</td><td style="padding:8px 0;color:#555;">${booking.BookingId}</td></tr>
      <tr><td style="padding:8px 0;font-weight:bold;color:#333;">Service</td><td style="padding:8px 0;color:#555;">${booking.ServiceType ?? "Taxi"}</td></tr>
      ${booking.VehicleType ? `<tr><td style="padding:8px 0;font-weight:bold;color:#333;">Vehicle</td><td style="padding:8px 0;color:#555;">${booking.VehicleType}</td></tr>` : ""}
      <tr><td style="padding:8px 0;font-weight:bold;color:#333;">Passenger</td><td style="padding:8px 0;color:#555;">${booking.PassengerName}</td></tr>
      <tr><td style="padding:8px 0;font-weight:bold;color:#333;">Phone</td><td style="padding:8px 0;color:#555;">${booking.PassengerPhone}</td></tr>
      ${booking.PassengerEmail ? `<tr><td style="padding:8px 0;font-weight:bold;color:#333;">Email</td><td style="padding:8px 0;color:#555;">${booking.PassengerEmail}</td></tr>` : ""}
      <tr><td style="padding:8px 0;font-weight:bold;color:#333;">Pick Up</td><td style="padding:8px 0;color:#555;">${booking.PickAddress}</td></tr>
      <tr><td style="padding:8px 0;font-weight:bold;color:#333;">Drop Off</td><td style="padding:8px 0;color:#555;">${booking.DropAddress}</td></tr>
      <tr><td style="padding:8px 0;font-weight:bold;color:#333;">Scheduled</td><td style="padding:8px 0;color:#555;">${scheduledLabel}</td></tr>
      ${paymentNote}
      ${booking.Info ? `<tr><td style="padding:8px 0;font-weight:bold;color:#333;">Notes</td><td style="padding:8px 0;color:#555;">${booking.Info}</td></tr>` : ""}
    </table>
  `;

  if (isScheduled) {
    const resolvedCompanyEmail = await resolveCompanyEmail(companyId, companyEmail);

    if (resolvedCompanyEmail) {
      await sendMailerSendEmail({
        to: [{ email: resolvedCompanyEmail, name: companyName ?? "Operator" }],
        subject: `[Pre-booking] ${booking.PassengerName} — ${booking.PickAddress}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
            <h2 style="color:#0a6b6b;margin-bottom:4px;">New Pre-booked Job</h2>
            <p style="color:#666;margin-top:0;margin-bottom:24px;">via BookaWaka booking portal</p>
            ${bookingDetailsHtml}
            <p style="margin-top:24px;font-size:12px;color:#0a6b6b;"><strong>Pre-booked job</strong> — this booking is scheduled for the time above. It will be added to your dispatch queue automatically at that time.</p>
          </div>
        `,
        fromName: "BookaWaka Bookings",
      });
    } else {
      log?.warn(
        { companyId, bookingId: booking.BookingId },
        "Scheduled booking: no company email resolved (companyProfiles/superClients empty)",
      );
    }

    if (passengerEmail) {
      await sendMailerSendEmail({
        to: [{ email: passengerEmail, name: booking.PassengerName }],
        subject: `Booking Confirmed — ${booking.BookingId}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
            <h2 style="color:#0a6b6b;">Your ride is scheduled!</h2>
            <p>Hi ${booking.PassengerName}, your pre-booking with ${companyName ?? "your chosen company"} has been confirmed.</p>
            <p style="color:#555;">Payment method: <strong>${pmLabel}</strong>${fareDisplay ? ` — ${fareDisplay}` : ""}.</p>
            ${bookingDetailsHtml}
            <p style="color:#666;margin-top:24px;">Questions? Reply to this email or contact the company directly.</p>
          </div>
        `,
        fromName: "BookaWaka Bookings",
      });
    }
    return;
  }

  const companyHtml = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <h2 style="color:#0a6b6b;margin-bottom:4px;">New Web Booking</h2>
      <p style="color:#666;margin-top:0;margin-bottom:24px;">via BookaWaka booking portal</p>
      ${bookingDetailsHtml}
      ${isCardPayment
        ? `<p style="margin-top:24px;font-size:12px;color:#e67e00;">This booking will appear in your dispatch queue once the passenger completes card payment.</p>`
        : `<p style="margin-top:24px;font-size:12px;color:#999;">This booking has been added to your dispatch queue automatically.</p>`
      }
    </div>
  `;

  const resolvedCompanyEmail = await resolveCompanyEmail(companyId, companyEmail);
  const companyRecipients: { email: string; name?: string }[] = [{ email: "info@bookawaka.com", name: "BookaWaka Admin" }];
  if (resolvedCompanyEmail) companyRecipients.push({ email: resolvedCompanyEmail, name: companyName });

  await sendMailerSendEmail({
    to: companyRecipients,
    subject: `[New Booking] ${booking.PassengerName} — ${booking.PickAddress}`,
    html: companyHtml,
    fromName: "BookaWaka Bookings",
  });

  if (passengerEmail) {
    const passengerPaymentNote = isCardPayment
      ? `<p style="color:#e67e00;font-weight:bold;">Your booking is reserved. Complete payment to confirm dispatch.</p>`
      : `<p style="color:#555;">Payment method: <strong>${pmLabel}</strong>${fareDisplay ? ` — ${fareDisplay}` : ""}.</p>`;

    await sendMailerSendEmail({
      to: [{ email: passengerEmail, name: booking.PassengerName }],
      subject: `Booking ${isCardPayment ? "Reserved" : "Confirmed"} — ${booking.BookingId}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <h2 style="color:#0a6b6b;">Your booking is ${isCardPayment ? "reserved" : "confirmed"}!</h2>
          <p>Hi ${booking.PassengerName}, your booking with ${companyName ?? "your chosen company"} has been received.</p>
          ${passengerPaymentNote}
          ${bookingDetailsHtml}
          <p style="color:#666;">Questions? Reply to this email or contact the company directly.</p>
        </div>
      `,
      fromName: "BookaWaka Bookings",
    });
  }
}

export default bookingsRouter;
