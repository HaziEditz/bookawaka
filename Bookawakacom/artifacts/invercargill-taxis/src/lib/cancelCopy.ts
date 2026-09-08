export const SUPPORT_EMAIL = "info@bookawaka.com";

const ARRIVED_LOCKED = new Set([
  "arrived", "active", "ontrip", "on trip", "onboard", "started", "in_progress",
  "no show", "noshow", "no_show",
]);

export function selfServeCancelAllowed(status: string | null | undefined): boolean {
  const s = String(status || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!s) return true;
  if (ARRIVED_LOCKED.has(s) || s.replace(/\s/g, "") === "ontrip") return false;
  return true;
}

export function bookingTimeCancelRules(kind: string, isTM = false): string {
  const k = String(kind || "").toLowerCase();
  if (isTM) {
    return "Cancel any time until the driver arrives. The council subsidy is never charged on cancel. Your remainder follows Card rules if you pay by card (wallet credit before assignment; 50% then 100% after assignment), Account/ACC rules if that, or no charge if cash. Missing GPS is not treated as a free cancel.";
  }
  if (k === "cash") {
    return "Cash bookings can be cancelled at no charge until the driver arrives. Repeated cash cancellations may require card payment in future.";
  }
  if (k === "card" || k === "wallet" || k === "giftcard" || k === "gift_card") {
    return `Cancel any time until the driver arrives. Before a driver is assigned, the fare is credited to your BookaWaka wallet (not back to your card). After assignment: 50% if the driver is still early; 100% if they are 60% or more of the way to you, have arrived, or if you no-show. Missing GPS is not treated as free. For a real card refund, email ${SUPPORT_EMAIL}.`;
  }
  if (k === "account" || k === "acc" || k === "business_account") {
    return "Cancel any time until the driver arrives. No charge before a driver is assigned. After assignment (any later stage, including arrived or no-show), the full fare is billed to your monthly account.";
  }
  return "Cancel any time until the driver arrives. Charges depend on payment method and how far the driver has come.";
}
