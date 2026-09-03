import { sendMailerSendEmail } from "./mailersend";
import { resolveCompanyEmail } from "./resolveCompanyEmail";

type LogLike = { warn: (obj: object, msg?: string) => void };

function bookingDetailsHtml(booking: Record<string, any>, scheduledLabel: string, paymentNote: string): string {
  return `
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 0;font-weight:bold;color:#333;width:130px;">Booking ID</td><td style="padding:8px 0;color:#555;">${booking.BookingId}</td></tr>
      <tr><td style="padding:8px 0;font-weight:bold;color:#333;">Service</td><td style="padding:8px 0;color:#555;">${booking.ServiceType ?? "Taxi"}</td></tr>
      ${booking.VehicleType ? `<tr><td style="padding:8px 0;font-weight:bold;color:#333;">Vehicle</td><td style="padding:8px 0;color:#555;">${booking.VehicleType}</td></tr>` : ""}
      <tr><td style="padding:8px 0;font-weight:bold;color:#333;">Passenger</td><td style="padding:8px 0;color:#555;">${booking.PassengerName ?? ""}</td></tr>
      <tr><td style="padding:8px 0;font-weight:bold;color:#333;">Phone</td><td style="padding:8px 0;color:#555;">${booking.PassengerPhone ?? ""}</td></tr>
      ${booking.PassengerEmail ? `<tr><td style="padding:8px 0;font-weight:bold;color:#333;">Email</td><td style="padding:8px 0;color:#555;">${booking.PassengerEmail}</td></tr>` : ""}
      <tr><td style="padding:8px 0;font-weight:bold;color:#333;">Pick Up</td><td style="padding:8px 0;color:#555;">${booking.PickAddress ?? ""}</td></tr>
      ${(() => {
        const stops = Array.isArray(booking.Stops)
          ? booking.Stops
          : Array.isArray(booking.stops)
            ? booking.stops.map((s: unknown) =>
                typeof s === "string" ? s : String((s as { address?: string })?.address || ""),
              )
            : [];
        const labels = stops.map((s: string) => String(s || "").trim()).filter(Boolean);
        if (!labels.length) return "";
        return `<tr><td style="padding:8px 0;font-weight:bold;color:#333;">Stops</td><td style="padding:8px 0;color:#555;">${labels.join(" → ")}</td></tr>`;
      })()}
      <tr><td style="padding:8px 0;font-weight:bold;color:#333;">Drop Off</td><td style="padding:8px 0;color:#555;">${booking.DropAddress ?? ""}</td></tr>
      <tr><td style="padding:8px 0;font-weight:bold;color:#333;">Scheduled</td><td style="padding:8px 0;color:#555;">${scheduledLabel}</td></tr>
      ${paymentNote}
      ${booking.Info || booking.Notes ? `<tr><td style="padding:8px 0;font-weight:bold;color:#333;">Notes</td><td style="padding:8px 0;color:#555;">${booking.Info || booking.Notes}</td></tr>` : ""}
    </table>
  `;
}

function paymentBits(booking: Record<string, any>): { pmLabel: string; fareDisplay: string; paymentNote: string } {
  const paymentMethodLabel: Record<string, string> = {
    cash: "Cash",
    card: "Card (Stripe)",
    business_account: "Business Account",
    account: "Account",
    acc: "ACC",
    tm: "Total Mobility",
    giftcard: "Gift Card",
    wallet: "BookaWaka Wallet",
  };
  const pmLabel = paymentMethodLabel[booking.paymentMethod] ?? booking.paymentMethod ?? "Account";
  const fareDisplay = booking.Fare ? `NZD $${parseFloat(booking.Fare).toFixed(2)}` : "";
  const paymentNote = `<tr><td style="padding:8px 0;font-weight:bold;color:#333;width:130px;">Payment</td><td style="padding:8px 0;color:#555;">${pmLabel}${fareDisplay ? ` — ${fareDisplay}` : ""}</td></tr>`;
  return { pmLabel, fareDisplay, paymentNote };
}

function scheduledLabelFromBooking(booking: Record<string, any>): string {
  const raw = booking.ScheduledForMs ?? booking.ScheduledFor;
  if (raw == null || raw === 0 || raw === "0") return "As soon as possible";
  const ms = typeof raw === "number" ? raw : new Date(raw).getTime();
  if (!ms || Number.isNaN(ms)) return "As soon as possible";
  return new Date(ms).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland" });
}

export async function sendBookingCreatedEmails({
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
  log?: LogLike;
}) {
  const { pmLabel, fareDisplay, paymentNote } = paymentBits(booking);
  const cardPaymentNote = isCardPayment
    ? `<tr><td style="padding:8px 0;font-weight:bold;color:#333;width:130px;">Payment</td><td style="padding:8px 0;color:#e67e00;font-weight:bold;">Awaiting card payment — not yet dispatched</td></tr>`
    : paymentNote;
  const scheduledLabel = scheduledLabelFromBooking(booking);
  const details = bookingDetailsHtml(booking, scheduledLabel, cardPaymentNote);

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
            ${details}
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
            ${details}
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
      ${details}
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
          ${details}
          <p style="color:#666;">Questions? Reply to this email or contact the company directly.</p>
        </div>
      `,
      fromName: "BookaWaka Bookings",
    });
  }
}

/** Notify company + passenger when a real date/time change (or other material edit) is saved. */
export async function sendBookingUpdatedEmails({
  booking,
  companyId,
  companyName,
  companyEmail,
  passengerEmail,
  changeSummary,
  scheduleChanged,
  log,
}: {
  booking: Record<string, any>;
  companyId?: string;
  companyName?: string;
  companyEmail?: string;
  passengerEmail?: string;
  changeSummary: string[];
  scheduleChanged: boolean;
  log?: LogLike;
}) {
  if (!scheduleChanged && changeSummary.length === 0) return;

  const { paymentNote } = paymentBits(booking);
  const scheduledLabel = scheduledLabelFromBooking(booking);
  const details = bookingDetailsHtml(booking, scheduledLabel, paymentNote);
  const changesHtml = changeSummary.length
    ? `<ul style="color:#555;padding-left:18px;">${changeSummary.map((c) => `<li>${c}</li>`).join("")}</ul>`
    : "";

  const resolvedCompanyEmail = await resolveCompanyEmail(companyId, companyEmail);
  if (resolvedCompanyEmail) {
    await sendMailerSendEmail({
      to: [{ email: resolvedCompanyEmail, name: companyName ?? "Operator" }],
      subject: `[Booking updated] #${booking.BookingId} — ${booking.PassengerName ?? "Passenger"}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <h2 style="color:#0a6b6b;margin-bottom:4px;">Booking updated</h2>
          <p style="color:#666;margin-top:0;margin-bottom:16px;">A passenger changed their BookaWaka booking.</p>
          ${changesHtml}
          ${details}
        </div>
      `,
      fromName: "BookaWaka Bookings",
    });
  } else {
    log?.warn({ companyId, bookingId: booking.BookingId }, "Booking update: no company email resolved");
  }

  const paxEmail = passengerEmail || booking.PassengerEmail;
  if (paxEmail) {
    await sendMailerSendEmail({
      to: [{ email: String(paxEmail), name: booking.PassengerName }],
      subject: `Booking updated — ${booking.BookingId}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <h2 style="color:#0a6b6b;">Your booking was updated</h2>
          <p>Hi ${booking.PassengerName || "there"}, here are the updated details for booking <strong>${booking.BookingId}</strong>.</p>
          ${changesHtml}
          ${details}
        </div>
      `,
      fromName: "BookaWaka Bookings",
    });
  }
}

export async function sendBookingCancelledEmails({
  booking,
  companyId,
  companyName,
  companyEmail,
  passengerEmail,
  log,
}: {
  booking: Record<string, any>;
  companyId?: string;
  companyName?: string;
  companyEmail?: string;
  passengerEmail?: string;
  log?: LogLike;
}) {
  const { paymentNote } = paymentBits(booking);
  const scheduledLabel = scheduledLabelFromBooking(booking);
  const details = bookingDetailsHtml(booking, scheduledLabel, paymentNote);

  const resolvedCompanyEmail = await resolveCompanyEmail(companyId, companyEmail);
  if (resolvedCompanyEmail) {
    await sendMailerSendEmail({
      to: [{ email: resolvedCompanyEmail, name: companyName ?? "Operator" }],
      subject: `[Cancelled] #${booking.BookingId} — ${booking.PassengerName ?? "Passenger"}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <h2 style="color:#b91c1c;margin-bottom:4px;">Booking cancelled</h2>
          <p style="color:#666;margin-top:0;margin-bottom:16px;">A passenger cancelled this BookaWaka booking.</p>
          ${details}
        </div>
      `,
      fromName: "BookaWaka Bookings",
    });
  } else {
    log?.warn({ companyId, bookingId: booking.BookingId }, "Booking cancel: no company email resolved");
  }

  const paxEmail = passengerEmail || booking.PassengerEmail;
  if (paxEmail) {
    await sendMailerSendEmail({
      to: [{ email: String(paxEmail), name: booking.PassengerName }],
      subject: `Booking cancelled — ${booking.BookingId}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <h2 style="color:#0a6b6b;">Your booking was cancelled</h2>
          <p>Hi ${booking.PassengerName || "there"}, booking <strong>${booking.BookingId}</strong> has been cancelled.</p>
          ${details}
        </div>
      `,
      fromName: "BookaWaka Bookings",
    });
  }
}
