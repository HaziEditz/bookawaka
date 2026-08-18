import { Router } from "express";
import { getDatabase } from "../lib/firebase";

const fareEstimateRouter = Router();

export type TariffPurpose = "Standard" | "Van" | "Total Mobility";

const NZ_PUBLIC_HOLIDAYS = [
  "2025-01-01", "2025-01-02", "2025-02-06", "2025-04-18", "2025-04-21", "2025-04-25", "2025-06-02", "2025-10-27", "2025-12-25", "2025-12-26",
  "2026-01-01", "2026-01-02", "2026-02-06", "2026-04-03", "2026-04-06", "2026-04-25", "2026-06-01", "2026-10-26", "2026-12-25", "2026-12-28",
  "2027-01-01", "2027-01-02", "2027-02-06", "2027-04-02", "2027-04-05", "2027-04-26", "2027-06-07", "2027-10-25", "2027-12-27", "2027-12-28",
];

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** NZ local parts for schedule matching (Pacific/Auckland). */
function nzParts(when: Date): { day: number; hhmm: number; today: string } {
  const fmt = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(when);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday"); // Mon, Tue, ...
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = dayMap[weekday] ?? when.getDay();
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(get("minute"), 10) || 0;
  const today = `${get("year")}-${get("month")}-${get("day")}`;
  return { day, hhmm: hour * 60 + minute, today };
}

function normalizePurpose(raw: unknown): TariffPurpose | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "tm" || s.includes("total mobility") || s === "totalmobility") return "Total Mobility";
  if (s === "van" || s.includes("van")) return "Van";
  if (s === "standard" || s === "car" || s === "taxi") return "Standard";
  return null;
}

function inferPurposeFromTariff(v: Record<string, any>): TariffPurpose {
  const explicit = normalizePurpose(v.Purpose ?? v.purpose ?? v.tariffPurpose);
  if (explicit) return explicit;
  if (v.isTM === true || v.IsTM === true) return "Total Mobility";
  const name = String(v.TariffName ?? v.name ?? "").toLowerCase();
  if (name.includes("van") || name.includes("wav") || name.includes("wheelchair")) return "Van";
  if (name.includes("total mobility") || name.includes("tm ")) return "Total Mobility";
  return "Standard";
}

function tariffMatchesSchedule(t: Record<string, any>, when: Date): boolean {
  const w = String(t.whenActive || (t.scheduleType === "always" ? "always" : t.whenActive) || "always");
  const { day, hhmm, today } = nzParts(when);

  if (w === "holidays") {
    const hol = (t.useNzHolidays ? NZ_PUBLIC_HOLIDAYS : []).concat(t.specificDates || []);
    return hol.indexOf(today) !== -1;
  }
  if ((t.specificDates || []).indexOf(today) !== -1) return true;
  if (t.useNzHolidays && NZ_PUBLIC_HOLIDAYS.indexOf(today) !== -1 && w !== "weekdays" && w !== "weekends") {
    return true;
  }

  if (w === "always") return true;
  if (w === "weekdays") return day >= 1 && day <= 5;
  if (w === "weekends") return day === 0 || day === 6;
  if (w === "nights" || w === "custom") {
    if (w === "custom") {
      const days: number[] = Array.isArray(t.days) ? t.days : [0, 1, 2, 3, 4, 5, 6];
      if (days.indexOf(day) === -1) return false;
    }
    const sp = String(t.startTime || "22:00").split(":");
    const ep = String(t.endTime || "06:00").split(":");
    const sm = parseInt(sp[0], 10) * 60 + parseInt(sp[1] || "0", 10);
    const em = parseInt(ep[0], 10) * 60 + parseInt(ep[1] || "0", 10);
    if (em < sm) return hhmm >= sm || hhmm <= em;
    return hhmm >= sm && hhmm <= em;
  }
  return true;
}

function isDefaultForPurpose(t: Record<string, any>): boolean {
  return t.isDefault === true || t.IsDefault === true || t.defaultForPurpose === true;
}

/**
 * Pick tariff by Purpose + schedule window.
 * Prefer a schedule-matching tariff for the purpose; else that purpose's default
 * (isDefault / always); else first of purpose.
 */
export function selectTariffForFare(
  raw: Record<string, any>,
  opts: { purpose: TariffPurpose; when?: Date },
): { id: string; name: string; flagFall: number; ratePerKm: number; minFare: number; purpose: TariffPurpose; whenActive: string } | null {
  const when = opts.when ?? new Date();
  const entries = Object.entries(raw)
    .filter(([, v]) => v && typeof v === "object")
    .map(([id, v]) => ({
      id,
      v,
      purpose: inferPurposeFromTariff(v),
      name: String(v.TariffName ?? v.name ?? id),
      flagFall: parseFloat(v.FlagFall ?? v.flagFall ?? v.baseFare ?? v.StartFare ?? "0") || 0,
      ratePerKm: parseFloat(v.RatePerKm ?? v.pricePerKm ?? v.PerKm ?? "0") || 0,
      minFare: parseFloat(v.MinFare ?? v.minFare ?? v.minimumFare ?? "0") || 0,
      whenActive: String(v.whenActive || "always"),
    }));

  const byPurpose = entries.filter((e) => e.purpose === opts.purpose);
  const pool = byPurpose.length > 0 ? byPurpose : entries.filter((e) => e.purpose === "Standard");
  if (pool.length === 0) return null;

  const scheduled = pool.filter(
    (e) => e.whenActive !== "always" && tariffMatchesSchedule(e.v, when),
  );
  if (scheduled.length > 0) {
    const pick = scheduled[0];
    return {
      id: pick.id,
      name: pick.name,
      flagFall: pick.flagFall,
      ratePerKm: pick.ratePerKm,
      minFare: pick.minFare,
      purpose: pick.purpose,
      whenActive: pick.whenActive,
    };
  }

  const defaults = pool.filter((e) => isDefaultForPurpose(e.v) || e.whenActive === "always");
  const pick = defaults[0] || pool[0];
  return {
    id: pick.id,
    name: pick.name,
    flagFall: pick.flagFall,
    ratePerKm: pick.ratePerKm,
    minFare: pick.minFare,
    purpose: pick.purpose,
    whenActive: pick.whenActive,
  };
}

function resolvePurposeFromQuery(q: Record<string, string | undefined>): TariffPurpose {
  const explicit = normalizePurpose(q.purpose);
  if (explicit) return explicit;
  const pax = parseInt(q.passengers || q.pax || "0", 10);
  if (pax >= 5) return "Van";
  const vt = String(q.vehicleType || q.vehicle || "").toLowerCase();
  if (vt.includes("van") || vt.includes("wav") || vt.includes("wheelchair")) return "Van";
  if (String(q.paymentMethod || "").toLowerCase() === "tm") return "Total Mobility";
  return "Standard";
}

fareEstimateRouter.get("/fare-estimate", async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const { cid, fromLat, fromLng, toLat, toLng } = q;

  if (!cid || !fromLat || !fromLng || !toLat || !toLng) {
    res.status(400).json({ error: "cid, fromLat, fromLng, toLat, toLng are required" });
    return;
  }

  const lat1 = parseFloat(fromLat);
  const lon1 = parseFloat(fromLng);
  const lat2 = parseFloat(toLat);
  const lon2 = parseFloat(toLng);

  if ([lat1, lon1, lat2, lon2].some(isNaN)) {
    res.status(400).json({ error: "Coordinates must be valid numbers" });
    return;
  }

  const when = q.at || q.scheduledFor ? new Date(String(q.at || q.scheduledFor)) : new Date();
  const whenOk = !isNaN(when.getTime()) ? when : new Date();
  const purpose = resolvePurposeFromQuery(q);

  try {
    const db = getDatabase();
    const snap = await db.ref(`tariffs/${cid}`).once("value");
    const raw = snap.val() as Record<string, any> | null;

    if (!raw) {
      res.status(404).json({ error: "No tariffs found for this company" });
      return;
    }

    const tariff = selectTariffForFare(raw, { purpose, when: whenOk });
    if (!tariff) {
      res.status(404).json({ error: "No applicable tariffs found" });
      return;
    }

    const distanceKm = haversineKm(lat1, lon1, lat2, lon2);
    const raw_estimate = tariff.flagFall + distanceKm * tariff.ratePerKm;
    const estimatedFare = Math.max(raw_estimate, tariff.minFare);

    req.log.info(
      { cid, purpose, distanceKm: distanceKm.toFixed(2), estimatedFare, tariffId: tariff.id },
      "GET /fare-estimate",
    );

    res.json({
      estimatedFare: Math.round(estimatedFare * 100) / 100,
      tariffName: tariff.name,
      tariffId: tariff.id,
      purpose: tariff.purpose,
      whenActive: tariff.whenActive,
      distanceKm: Math.round(distanceKm * 10) / 10,
      currency: "NZD",
      fixedPrice: true,
    });
  } catch (err: any) {
    req.log.error({ err }, "GET /fare-estimate error");
    res.status(500).json({ error: err.message });
  }
});

export default fareEstimateRouter;
