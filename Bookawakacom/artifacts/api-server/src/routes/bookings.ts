import { Router } from "express";
import { getDatabase } from "../lib/firebase";
import { registerScheduledDispatch } from "../lib/scheduler";
import { normalizeEmailKey } from "../lib/passengerKey";
import { debitWallet, readWalletBalanceCents } from "../lib/wallet";
import { findActiveBooking, normalizePhoneKey } from "../lib/active-booking-guard";
import { searchNzPlaces } from "../lib/geocode-search";
import { estimateDispatchLeadMins } from "../lib/estimateDispatchLeadMins";
import { resolveCompanyBaseLocation } from "../lib/resolveCompanyBaseLocation";
import { formatNzBookingDateTime } from "../lib/formatNzBookingDateTime";
import { sendBookingCreatedEmails } from "../lib/bookingNotifyEmails";

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
    isTM,
    tmCardName,
    tmCardExpiry,
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
    isTM?: boolean;
    tmCardName?: string;
    tmCardExpiry?: string;
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
      ? await (async () => {
          // Same estimate as INVT/_estimateDispatchLeadMins — company base (not Auckland default).
          const companyBase = await resolveCompanyBaseLocation(companyId);
          const leadMins = estimateDispatchLeadMins(
            resolvedPick.lat,
            resolvedPick.lng,
            companyBase,
          );
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
    ...(accountNumber
      ? {
          accountNumber,
          Account_id: accountNumber,
          AccountId: accountNumber,
          jobAccountId: accountNumber,
        }
      : {}),
    ...(tmCardNumber
      ? {
          tmCardNumber,
          TmCardNumber: tmCardNumber,
          tmVoucherNo: tmCardNumber,
        }
      : {}),
    ...(giftCardCode ? { giftCardCode, GiftCardCode: giftCardCode } : {}),
    ...(isTM
      ? {
          isTM: true,
          IsTM: true,
          isTotalMobility: true,
          ...(tmCardName ? { tmCardName, TmCardName: tmCardName } : {}),
          ...(tmCardExpiry ? { tmCardExpiry, TmCardExpiry: tmCardExpiry } : {}),
        }
      : {}),
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
    // Card (PendingPayment): NEVER email at create — "Awaiting card payment" was firing
    // before Stripe confirmed. Confirmation emails go out from verify-and-dispatch / webhook.
    if (isCardPayment) {
      req.log.info(
        { bookingId },
        "Skipping website emails at create — card hold; emails after Stripe confirms",
      );
    } else if (!isScheduled) {
      req.log.info({ bookingId }, "Skipping website emails — SA portal handles ASAP cash booking notifications");
    } else {
      sendBookingCreatedEmails({
        booking,
        companyId,
        companyName,
        companyEmail,
        passengerEmail,
        isScheduled,
        isCardPayment: false,
        log: req.log,
      }).catch((e) => req.log.error({ e }, "Email send failed"));
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

export default bookingsRouter;
