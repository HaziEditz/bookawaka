import { Router } from "express";
import { getDatabase } from "../lib/firebase";
import { debitWallet } from "../lib/wallet";
import { resolveStripePaymentContext } from "../lib/stripe-keys";
import {
  calcConnectPaymentSplit,
  commissionFieldsFromMetadata,
  resolveTaxiCommissionPct,
} from "../lib/stripe-commission";
import { registerScheduledDispatch } from "../lib/scheduler";
import { sendBookingCreatedEmails } from "../lib/bookingNotifyEmails";

const stripeRouter = Router();

/**
 * Fire company + passenger confirmation emails only after Stripe has confirmed payment.
 * Idempotent via allbookings.bookingEmailsSentAt.
 */
async function sendCardPaidBookingEmails(opts: {
  db: ReturnType<typeof getDatabase>;
  booking: Record<string, any>;
  companyId: string;
  bookingId: string;
  isScheduled: boolean;
  log: any;
}): Promise<void> {
  const { db, booking, companyId, bookingId, isScheduled, log } = opts;
  if (booking.bookingEmailsSentAt) {
    log.info({ bookingId, companyId }, "card paid emails already sent — skip");
    return;
  }
  const passengerEmail =
    booking.PassengerEmail || booking.passengerEmail || booking.Email || undefined;
  const companyName =
    booking.CompanyName || booking.companyName || booking.company_name || undefined;
  const companyEmail =
    booking.CompanyEmail || booking.companyEmail || booking.company_email || undefined;

  await sendBookingCreatedEmails({
    booking: {
      ...booking,
      paymentMethod: "card",
      paymentStatus: "paid",
    },
    companyId,
    companyName,
    companyEmail,
    passengerEmail,
    isScheduled,
    // Paid — show Card (Stripe), not "Awaiting card payment".
    isCardPayment: false,
    log,
  });

  await db.ref(`allbookings/${companyId}/${bookingId}`).update({
    bookingEmailsSentAt: new Date().toISOString(),
  });
}

/** Debit walletAmountPending after card payment confirms (partial wallet + card bookings). */
async function applyPendingWalletDebit(
  db: ReturnType<typeof getDatabase>,
  booking: Record<string, any>,
  bookingId: string,
  companyId: string,
  log: any
): Promise<Record<string, any>> {
  if (booking.walletDebited || !booking.walletAmountPending || booking.walletAmountPending <= 0) {
    return {};
  }

  const rawPhone: string | null = booking.PassengerPhone ?? booking.passengerPhone ?? null;
  if (!rawPhone) {
    log.warn({ bookingId, companyId }, "wallet pending debit: no passenger phone");
    return {};
  }

  const normalizedPhone = rawPhone.replace(/[^0-9]/g, "");
  const bookingKey =
    booking.passengerKey ?? booking.PassengerKey ?? booking.passenger_key ?? null;
  const bookingEmail = booking.passengerEmail ?? booking.PassengerEmail ?? null;

  const pendingCents = Math.round(Number(booking.walletAmountPending) * 100);
  const debit = await debitWallet(
    db,
    {
      key: bookingKey ? String(bookingKey) : undefined,
      phone: normalizedPhone,
      email: bookingEmail ? String(bookingEmail) : undefined,
    },
    pendingCents,
    {
      reason: "booking_payment",
      jobId: bookingId,
      companyId,
    },
  );

  if (!debit.ok) {
    log.error(
      { bookingId, companyId, phone: normalizedPhone, err: debit.error },
      "wallet pending debit failed after card payment",
    );
    return {};
  }

  log.info(
    {
      bookingId,
      companyId,
      passengerKey: debit.passengerKey,
      walletAmount: booking.walletAmountPending,
    },
    "Wallet debit applied after card payment",
  );

  return {
    walletAmountApplied: booking.walletAmountPending,
    walletAmountPending: null,
    walletDebited: true,
    walletDebitEntryId: debit.entryId,
  };
}

/**
 * Public web origin for Stripe success/cancel redirects.
 *
 * Evidence (2026-08-26): www.bookawaka.com CNAMEs to zy36s73i.up.railway.app which
 * returns Railway `Application not found`. Prefer the request Host (the working app
 * the passenger is actually on, e.g. bookawaka-production.up.railway.app) over a
 * stale CUSTOMER_WEB_URL that points at the dead CNAME.
 */
function normalizePublicOrigin(raw: string | undefined | null): string {
  const t = String(raw || "").trim();
  if (!t) return "";
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname) return "";
    // Known-dead Railway service previously bound to www.bookawaka.com
    if (/^zy36s73i\.up\.railway\.app$/i.test(u.hostname)) return "";
    return `${u.protocol}//${u.host}`.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function getCustomerWebUrl(req?: { get?: (name: string) => string | undefined; protocol?: string }): string {
  const xfHost = (req?.get?.("x-forwarded-host") || "").split(",")[0]?.trim();
  const host = xfHost || (req?.get?.("host") || "").trim();
  const xfProto = (req?.get?.("x-forwarded-proto") || "").split(",")[0]?.trim();
  const proto = xfProto || (req?.protocol === "http" ? "http" : "https");
  const fromRequest = host ? normalizePublicOrigin(`${proto}://${host}`) : "";

  const candidates = [
    // Prefer the live request host first — matches the SPA the user is booking on.
    fromRequest,
    normalizePublicOrigin(process.env.CUSTOMER_WEB_URL),
    normalizePublicOrigin(process.env.RAILWAY_PUBLIC_DOMAIN),
    normalizePublicOrigin(process.env.RAILWAY_STATIC_URL),
    normalizePublicOrigin(process.env.REPLIT_DOMAINS?.split(",")[0]),
    normalizePublicOrigin(process.env.REPLIT_DEV_DOMAIN),
  ];
  for (const c of candidates) {
    if (c) return c;
  }
  return "";
}

/** Allowed Stripe return hosts for https success/cancel overrides (website). */
const ALLOWED_RETURN_HOSTS = new Set([
  "bookawaka-production.up.railway.app",
  "bookawaka.com",
  "www.bookawaka.com",
]);

/** Passenger app custom scheme (must match app.json scheme). */
const ALLOWED_APP_SCHEMES = new Set(["passenger-app:"]);

/**
 * Optional client-supplied Stripe return URLs (passenger app deep links).
 * Reject anything outside the allowlist so this cannot become an open redirect.
 * Website clients omit these → defaults stay on the customer web origin.
 */
function resolveStripeReturnUrls(
  req: { get?: (name: string) => string | undefined; protocol?: string },
  body: { successUrl?: string; cancelUrl?: string },
  bookingId: string,
  cid: string,
): { success_url: string; cancel_url: string; returnBase: string } | { error: string } {
  const customerWebUrl = getCustomerWebUrl(req);

  const tryParseAllowed = (raw: string | undefined): string | null => {
    const t = String(raw || "").trim();
    if (!t) return null;
    try {
      const u = new URL(t);
      if (ALLOWED_APP_SCHEMES.has(u.protocol)) return t;
      if (u.protocol === "https:" && ALLOWED_RETURN_HOSTS.has(u.hostname.toLowerCase())) return t;
      return null;
    } catch {
      return null;
    }
  };

  const customSuccess = tryParseAllowed(body.successUrl);
  const customCancel = tryParseAllowed(body.cancelUrl);

  if (body.successUrl && !customSuccess) {
    return { error: "successUrl is not an allowed return URL" };
  }
  if (body.cancelUrl && !customCancel) {
    return { error: "cancelUrl is not an allowed return URL" };
  }

  if (body.successUrl || body.cancelUrl) {
    if (!customSuccess || !customCancel) {
      return {
        error: "Both successUrl and cancelUrl are required when overriding Stripe return URLs",
      };
    }
    return {
      success_url: customSuccess,
      cancel_url: customCancel,
      returnBase: customSuccess,
    };
  }

  if (!customerWebUrl) {
    return {
      error:
        "Payment redirect URL is not configured. Use https://bookawaka-production.up.railway.app (www.bookawaka.com currently points at a dead Railway service).",
    };
  }

  return {
    success_url: `${customerWebUrl}/booking-success?booking=${bookingId}&cid=${encodeURIComponent(cid)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${customerWebUrl}/book`,
    returnBase: customerWebUrl,
  };
}

stripeRouter.post("/stripe/create-booking-payment", async (req, res) => {
  const { cid, bookingId, description, amount, currency, email, successUrl, cancelUrl } = req.body as {
    cid?: string;
    bookingId?: string;
    description?: string;
    amount?: number;
    currency?: string;
    email?: string;
    successUrl?: string;
    cancelUrl?: string;
  };

  if (!cid || !bookingId || !amount || !email) {
    res.status(400).json({ error: "cid, bookingId, amount, and email are required" });
    return;
  }

  const payCtx = await resolveStripePaymentContext(cid);
  if (!payCtx.secretKey) {
    req.log.error({ cid }, "No Stripe secret key for company or STRIPE_SECRET_KEY env");
    res.status(503).json({ error: "Online card payment is not configured yet. Please pay your driver on arrival." });
    return;
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(payCtx.secretKey, { apiVersion: "2026-04-22.dahlia" });

    const returns = resolveStripeReturnUrls(req, { successUrl, cancelUrl }, bookingId, cid);
    if ("error" in returns) {
      req.log.error({ cid, err: returns.error }, "No usable Stripe return URLs");
      res.status(503).json({ error: returns.error });
      return;
    }

    const amountCents = Math.round(amount * 100);
    const sessionParams: Parameters<typeof stripe.checkout.sessions.create>[0] = {
      mode: "payment",
      currency: currency ?? "nzd",
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: currency ?? "nzd",
            unit_amount: amountCents,
            product_data: {
              name: description ?? `Booking ${bookingId}`,
              description: `BookaWaka booking — ref ${bookingId}`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        bookingId,
        companyId: cid,
        type: "booking_payment",
        stripeMode: payCtx.mode ?? "direct",
      },
      success_url: returns.success_url,
      cancel_url: returns.cancel_url,
    };

    if (payCtx.mode === "connect" && payCtx.connectAccountId) {
      const db = getDatabase();
      const commissionPct = await resolveTaxiCommissionPct(db, cid);
      const split = calcConnectPaymentSplit(amountCents, commissionPct);
      sessionParams.payment_intent_data = {
        transfer_data: {
          destination: payCtx.connectAccountId,
        },
        ...(split.applicationFeeCents > 0
          ? { application_fee_amount: split.applicationFeeCents }
          : {}),
      };
      sessionParams.metadata = {
        ...sessionParams.metadata,
        commissionPct: String(split.commissionPct),
        applicationFeeCents: String(split.applicationFeeCents),
        companyNetCents: String(split.companyNetCents),
      };
      req.log.info(
        {
          bookingId,
          cid,
          commissionPct: split.commissionPct,
          applicationFeeCents: split.applicationFeeCents,
          companyNetCents: split.companyNetCents,
        },
        "Connect checkout: platform commission applied"
      );
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    req.log.info(
      { bookingId, cid, sessionId: session.id, returnBase: returns.returnBase },
      "Stripe Checkout session created",
    );
    res.json({
      ok: true,
      url: session.url,
      sessionId: session.id,
      // Non-secret diagnostic so clients/ops can verify return host is the live app.
      returnBase: returns.returnBase,
    });
  } catch (err: any) {
    req.log.error({ err }, "POST /stripe/create-booking-payment error");
    res.status(500).json({ error: err.message ?? "Could not create payment session" });
  }
});

// Called by the frontend when the user lands on /payment-success.
// Verifies the Stripe session directly (no webhook needed) and triggers dispatch
// if the booking hasn't been dispatched yet. Safe to call multiple times.
stripeRouter.post("/stripe/verify-and-dispatch", async (req, res) => {
  const { sessionId, bookingId, companyId } = req.body as {
    sessionId?: string;
    bookingId?: string;
    companyId?: string;
  };

  if (!sessionId || !bookingId || !companyId) {
    res.status(400).json({ error: "sessionId, bookingId, companyId are required" });
    return;
  }

  const payCtx = await resolveStripePaymentContext(companyId);
  if (!payCtx.secretKey) {
    req.log.error({ companyId }, "No Stripe secret key for company or STRIPE_SECRET_KEY env");
    res.status(503).json({ error: "Stripe not configured" });
    return;
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(payCtx.secretKey, { apiVersion: "2026-04-22.dahlia" });

    // Verify the session with Stripe directly
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      res.status(402).json({ error: "Payment not completed", payment_status: session.payment_status });
      return;
    }

    // Verify metadata matches — guard against session ID spoofing
    const meta = session.metadata ?? {};
    if (meta.bookingId !== bookingId || meta.companyId !== companyId || meta.type !== "booking_payment") {
      req.log.warn({ sessionId, bookingId, companyId }, "verify-and-dispatch: metadata mismatch");
      res.status(403).json({ error: "Session metadata does not match booking" });
      return;
    }

    const db = getDatabase();
    const bookingSnap = await db.ref(`allbookings/${companyId}/${bookingId}`).once("value");
    const existing = bookingSnap.val() as Record<string, any> | null;

    if (!existing) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }

    const existingSt = String(existing.Status ?? existing.status ?? "").toLowerCase();
    if (
      existingSt === "cancelled" ||
      existingSt === "canceled" ||
      existingSt === "completed" ||
      existingSt === "closed"
    ) {
      req.log.info(
        { bookingId, companyId, existingSt },
        "verify-and-dispatch: booking already terminal — not rewriting to Pending",
      );
      res.json({ ok: true, alreadyDispatched: true, terminal: existingSt });
      return;
    }

    // Idempotent — if already dispatched (paymentStatus === "paid") just return success
    if (existing.paymentStatus === "paid") {
      req.log.info({ bookingId, companyId }, "verify-and-dispatch: already dispatched, skipping");
      res.json({ ok: true, alreadyDispatched: true });
      return;
    }

    const paidAt = new Date().toISOString();
    const commissionFields = commissionFieldsFromMetadata(meta as Record<string, string>);
    const walletFields = await applyPendingWalletDebit(db, existing, bookingId, companyId, req.log);

    // Scheduled card bookings stay Scheduled until the dispatcher release window —
    // do not force Pending + pendingjobs (My Rides "Looking for driver" bug).
    const scheduledMs = Number(existing.ScheduledForMs ?? existing.ScheduledFor ?? 0);
    const isScheduled = Number.isFinite(scheduledMs) && scheduledMs > Date.now() + 60_000;
    const postPayStatus = isScheduled ? "Scheduled" : "Pending";

    // Card + quote = already paid fixed fare (website bookings stamp this at create;
    // passenger-app jobs historically omitted it → driver ran Tariff 1 meter).
    const fareNum = Number(
      existing.CustomeRate ??
        existing.EstimatedFare ??
        existing.estimatedFare ??
        existing.Fare ??
        existing.fare ??
        0,
    );
    const fixedFareFields =
      Number.isFinite(fareNum) && fareNum > 0
        ? {
            TarriffId: "-1",
            TariffId: "-1",
            tariffId: "-1",
            TarriffType: "Fixed",
            TariffType: "Fixed",
            TariffName: "Fixed",
            tariffName: "Fixed",
            CustomeRate: fareNum,
            Fare: String(fareNum),
            EstimatedFare: fareNum,
            estimatedFare: fareNum,
            isFixedPrice: true,
            isPrePaid: true,
          }
        : { isPrePaid: true };

    const paidBooking = {
      ...existing,
      ...walletFields,
      ...commissionFields,
      ...fixedFareFields,
      Status: postPayStatus,
      BookingStatus: postPayStatus,
      paymentMethod: "card",
      PaymentMethod: "card",
      paymentType: "card",
      PaymentType: "card",
      paymentStatus: "paid",
      PaymentStatus: "paid",
      stripeSessionId: session.id,
      paidAt,
    };

    const paidFields = {
      ...walletFields,
      ...commissionFields,
      ...fixedFareFields,
      Status: postPayStatus,
      BookingStatus: postPayStatus,
      paymentMethod: "card",
      PaymentMethod: "card",
      paymentType: "card",
      PaymentType: "card",
      paymentStatus: "paid",
      PaymentStatus: "paid",
      stripeSessionId: session.id,
      paidAt,
    };

    // Look up passenger key so we can update Passengerjobs (the source My Rides reads from)
    let passengerKey: string | null = null;
    const rawPhone: string | null = existing.PassengerPhone ?? existing.passengerPhone ?? null;
    if (rawPhone) {
      const normalizedPhone = rawPhone.replace(/[^0-9]/g, "");
      const pkSnap = await db.ref(`passengerIndex/phone/${normalizedPhone}`).once("value");
      passengerKey = pkSnap.val()?.key ?? null;
    }

    const writes: Promise<any>[] = [
      db.ref(`allbookings/${companyId}/${bookingId}`).update(paidFields),
    ];
    if (!isScheduled) {
      writes.push(db.ref(`pendingjobs/${companyId}/${bookingId}`).set(paidBooking));
    } else {
      // Ensure a stale pendingjobs row from an earlier bug is cleared for scheduled.
      writes.push(db.ref(`pendingjobs/${companyId}/${bookingId}`).remove());
    }

    // Keep Passengerjobs in sync so My Rides shows the correct status
    if (passengerKey) {
      writes.push(db.ref(`Passengerjobs/${passengerKey}/${bookingId}`).update(paidFields));
    }

    await Promise.all(writes);

    // Confirmation emails only after real Stripe payment (not at booking create).
    sendCardPaidBookingEmails({
      db,
      booking: paidBooking,
      companyId,
      bookingId,
      isScheduled,
      log: req.log,
    }).catch((e) => req.log.error({ e, bookingId }, "card paid email send failed"));

    if (isScheduled) {
      const leadMins =
        Number(
          existing.NotifyDispatchBeforeMinutes ??
            existing.DispatchTimebefore ??
            existing.NotifyDispatchBefore ??
            30,
        ) || 30;
      const notifyAtMs = scheduledMs - leadMins * 60 * 1000;
      registerScheduledDispatch({
        companyId,
        bookingId,
        notifyAt: new Date(notifyAtMs).toISOString(),
      });
      req.log.info(
        { bookingId, companyId, sessionId, postPayStatus },
        "verify-and-dispatch: card paid — kept Scheduled (not pendingjobs)",
      );
    } else {
      req.log.info({ bookingId, companyId, sessionId }, "verify-and-dispatch: dispatched to pendingjobs");
    }
    res.json({ ok: true, alreadyDispatched: false, status: postPayStatus });
  } catch (err: any) {
    req.log.error({ err }, "POST /stripe/verify-and-dispatch error");
    res.status(500).json({ error: err.message ?? "Verification failed" });
  }
});

stripeRouter.post("/stripe/webhook", async (req, res) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const payCtx = await resolveStripePaymentContext();

  if (!payCtx.secretKey || !webhookSecret) {
    res.status(503).json({ error: "Stripe not configured" });
    return;
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(payCtx.secretKey, { apiVersion: "2026-04-22.dahlia" });
    const sig = req.headers["stripe-signature"];
    if (!sig) {
      res.status(400).json({ error: "Missing stripe-signature" });
      return;
    }

    const event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      Array.isArray(sig) ? sig[0] : sig,
      webhookSecret
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as any;
      const { bookingId, companyId, type } = session.metadata ?? {};

      if (type === "booking_payment" && bookingId && companyId) {
        const db = getDatabase();

        // Read the full booking so we can write it to the dispatch queue
        const bookingSnap = await db.ref(`allbookings/${companyId}/${bookingId}`).once("value");
        const existingBooking = bookingSnap.val() as Record<string, any> | null;

        if (existingBooking) {
          const existingSt = String(
            existingBooking.Status ?? existingBooking.status ?? "",
          ).toLowerCase();
          if (
            existingSt === "cancelled" ||
            existingSt === "canceled" ||
            existingSt === "completed" ||
            existingSt === "closed"
          ) {
            req.log.info(
              { bookingId, companyId, existingSt },
              "Stripe webhook: booking already terminal — skip Pending rewrite",
            );
          } else if (existingBooking.paymentStatus === "paid") {
            req.log.info({ bookingId, companyId }, "Stripe webhook: already paid — skip");
          } else {
            const meta = (session.metadata ?? {}) as Record<string, string>;
            const commissionFields = commissionFieldsFromMetadata(meta);
            const walletFields = await applyPendingWalletDebit(
              db,
              existingBooking,
              bookingId,
              companyId,
              req.log
            );
            const paidAt = new Date().toISOString();
            const scheduledMs = Number(
              existingBooking.ScheduledForMs ?? existingBooking.ScheduledFor ?? 0,
            );
            const isScheduled =
              Number.isFinite(scheduledMs) && scheduledMs > Date.now() + 60_000;
            const postPayStatus = isScheduled ? "Scheduled" : "Pending";
            const paidBooking = {
              ...existingBooking,
              ...walletFields,
              ...commissionFields,
              Status: postPayStatus,
              BookingStatus: postPayStatus,
              paymentStatus: "paid",
              paymentMethod: "card",
              stripeSessionId: session.id,
              paidAt,
            };

            const writes: Promise<any>[] = [
              db.ref(`allbookings/${companyId}/${bookingId}`).update({
                ...walletFields,
                ...commissionFields,
                Status: postPayStatus,
                BookingStatus: postPayStatus,
                paymentMethod: "card",
                paymentStatus: "paid",
                stripeSessionId: session.id,
                paidAt,
              }),
            ];
            if (!isScheduled) {
              writes.push(db.ref(`pendingjobs/${companyId}/${bookingId}`).set(paidBooking));
            } else {
              writes.push(db.ref(`pendingjobs/${companyId}/${bookingId}`).remove());
              const leadMins =
                Number(
                  existingBooking.NotifyDispatchBeforeMinutes ??
                    existingBooking.DispatchTimebefore ??
                    30,
                ) || 30;
              registerScheduledDispatch({
                companyId,
                bookingId,
                notifyAt: new Date(scheduledMs - leadMins * 60 * 1000).toISOString(),
              });
            }
            await Promise.all(writes);

            sendCardPaidBookingEmails({
              db,
              booking: paidBooking,
              companyId,
              bookingId,
              isScheduled,
              log: req.log,
            }).catch((e) =>
              req.log.error({ e, bookingId }, "webhook card paid email send failed"),
            );

            req.log.info(
              { bookingId, companyId, sessionId: session.id, postPayStatus },
              isScheduled
                ? "Booking paid — kept Scheduled"
                : "Booking paid — dispatched to pendingjobs",
            );
          }
        } else {
          req.log.warn({ bookingId, companyId }, "Stripe webhook: booking not found in allbookings");
        }
      }
    }

    res.json({ received: true });
  } catch (err: any) {
    req.log.error({ err }, "Stripe webhook error");
    res.status(400).json({ error: err.message });
  }
});

export default stripeRouter;
