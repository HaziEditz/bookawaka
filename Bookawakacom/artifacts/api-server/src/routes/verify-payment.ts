import { Router } from "express";
import { getDatabase } from "../lib/firebase";

const verifyPaymentRouter = Router();

function isActiveStatus(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  if (data.active === false) return false;
  const status = String(data.status ?? data.Status ?? "active").toLowerCase();
  return status === "active" || status === "";
}

function normRef(s: string): string {
  return String(s || "").trim();
}

function digitsOnly(s: string): string {
  return String(s || "").replace(/\D/g, "");
}

/**
 * Find a business account under businessAccounts/{cid} by accountCode or accountNumber
 * (passenger/driver world). Falls back to legacy accountClients/{cid}/{ref} exact key.
 */
async function findBusinessAccount(cid: string, ref: string) {
  const db = getDatabase();
  const needle = normRef(ref).toUpperCase();
  const needleDigits = digitsOnly(ref);

  const baSnap = await db.ref(`businessAccounts/${cid}`).once("value");
  const ba = baSnap.val();
  if (ba && typeof ba === "object") {
    for (const [id, raw] of Object.entries(ba as Record<string, any>)) {
      if (!raw || typeof raw !== "object") continue;
      const code = String(raw.accountCode ?? raw.AccountCode ?? "").trim().toUpperCase();
      const num = String(raw.accountNumber ?? raw.AccountNumber ?? "").trim().toUpperCase();
      const idMatch = String(id).trim().toUpperCase() === needle;
      const codeMatch = code && (code === needle || (needleDigits && digitsOnly(code) === needleDigits));
      const numMatch = num && (num === needle || (needleDigits && digitsOnly(num) === needleDigits));
      if (idMatch || codeMatch || numMatch) {
        return { id, data: raw as Record<string, unknown>, source: "businessAccounts" as const };
      }
    }
  }

  // Legacy path used by the original website brief
  const legacySnap = await db.ref(`accountClients/${cid}/${ref}`).once("value");
  const legacy = legacySnap.val();
  if (legacy) {
    return { id: ref, data: legacy as Record<string, unknown>, source: "accountClients" as const };
  }
  return null;
}

/**
 * ACC: passenger app searches accClients/{cid} by claimNumber field.
 * Also accept exact key match for older seeds.
 */
async function findAccClient(cid: string, ref: string) {
  const db = getDatabase();
  const needle = normRef(ref).toUpperCase();

  const snap = await db.ref(`accClients/${cid}`).once("value");
  const clients = snap.val();
  if (clients && typeof clients === "object") {
    if (clients[ref] && typeof clients[ref] === "object") {
      return { id: ref, data: clients[ref] as Record<string, unknown> };
    }
    for (const [id, raw] of Object.entries(clients as Record<string, any>)) {
      if (!raw || typeof raw !== "object") continue;
      const claim = String(raw.claimNumber ?? raw.ClaimNumber ?? "").trim().toUpperCase();
      if (claim && claim === needle) {
        return { id, data: raw as Record<string, unknown> };
      }
    }
  }
  return null;
}

verifyPaymentRouter.get("/verify-payment", async (req, res) => {
  const { cid, method, reference, estimatedFare } = req.query as {
    cid?: string;
    method?: string;
    reference?: string;
    estimatedFare?: string;
  };

  if (!cid || !method) {
    res.status(400).json({ valid: false, message: "cid and method are required" });
    return;
  }

  // Cash / card need no reference lookup.
  if (method === "cash") {
    res.json({ valid: true, message: "Cash payment — pay the driver at the end of the trip." });
    return;
  }
  if (method === "card") {
    res.json({ valid: true, message: "Card payment is collected at checkout." });
    return;
  }

  const ref = normRef(reference ?? "");
  if (!ref) {
    res.json({ valid: false, message: "Reference number cannot be empty." });
    return;
  }

  try {
    const db = getDatabase();

    if (method === "account") {
      const hit = await findBusinessAccount(cid, ref);
      if (!hit) {
        res.json({ valid: false, message: "Account number not found. Please check and try again." });
        return;
      }
      if (!isActiveStatus(hit.data)) {
        res.json({
          valid: false,
          message: `Account is ${String(hit.data.status ?? hit.data.Status ?? "not active")}. Please contact the company.`,
        });
        return;
      }
      const name = String(hit.data.name ?? hit.data.Name ?? "");
      res.json({
        valid: true,
        message: `Account verified${name ? `: ${name}` : ""}.`,
        accountId: hit.id,
        accountName: name || undefined,
        source: hit.source,
      });
      return;
    }

    if (method === "acc") {
      const hit = await findAccClient(cid, ref);
      if (!hit) {
        res.json({ valid: false, message: "ACC claim number not found. Please check and try again." });
        return;
      }
      if (!isActiveStatus(hit.data)) {
        res.json({
          valid: false,
          message: `ACC claim is ${String(hit.data.status ?? hit.data.Status ?? "not active")}.`,
        });
        return;
      }
      const remaining = hit.data.remainingAllocation;
      if (typeof remaining === "number" && remaining <= 0) {
        res.json({ valid: false, message: "ACC allocation is exhausted for this claim." });
        return;
      }
      const claimantName = String(
        hit.data.claimantName ?? hit.data.name ?? hit.data.Name ?? "",
      );
      res.json({
        valid: true,
        message: `ACC claim verified${claimantName ? `: ${claimantName}` : ""}.`,
        clientId: hit.id,
        claimantName: claimantName || undefined,
      });
      return;
    }

    if (method === "tm") {
      // Canonical registry is global tmCards/{cardNumber} (passenger app + driver).
      const cardKey = digitsOnly(ref) || ref;
      const snap = await db.ref(`tmCards/${cardKey}`).once("value");
      let data = snap.val() as Record<string, unknown> | null;

      // Legacy fallback
      if (!data) {
        const legacy = await db.ref(`tmClients/${cid}/${ref}`).once("value");
        data = legacy.val();
      }

      if (!data) {
        res.json({ valid: false, message: "Total Mobility card not found. Please check and try again." });
        return;
      }
      if (data.active === false) {
        res.json({ valid: false, message: "Total Mobility card is not active." });
        return;
      }
      const status = String(data.status ?? "").toLowerCase();
      if (status && status !== "active") {
        res.json({ valid: false, message: `Total Mobility card is ${status}.` });
        return;
      }
      const passengerName = String(data.passengerName ?? data.name ?? data.Name ?? "");
      const expiryDate = String(data.expiryDate ?? data.ExpiryDate ?? "");
      res.json({
        valid: true,
        message: "Total Mobility card verified.",
        cardNumber: cardKey,
        passengerName: passengerName || undefined,
        expiryDate: expiryDate || undefined,
        councilId: data.councilId ?? data.CouncilId ?? undefined,
      });
      return;
    }

    if (method === "giftcard") {
      // Passenger app uppercases the code before lookup.
      const code = ref.toUpperCase();
      const snap = await db.ref(`giftCards/${cid}/${code}`).once("value");
      let data = snap.val() as Record<string, unknown> | null;
      if (!data && code !== ref) {
        const rawSnap = await db.ref(`giftCards/${cid}/${ref}`).once("value");
        data = rawSnap.val();
      }
      if (!data) {
        res.json({ valid: false, message: "Gift card code not found. Please check and try again." });
        return;
      }
      if (data.status && String(data.status) !== "active") {
        res.json({ valid: false, message: `Gift card is ${String(data.status)}.` });
        return;
      }
      const balance: number | null = typeof data.balance === "number" ? data.balance : null;
      const fare: number | null = estimatedFare ? parseFloat(estimatedFare as string) : null;
      if (balance !== null && fare !== null && balance < fare) {
        res.json({
          valid: false,
          message: `Gift card balance ($${balance.toFixed(2)}) is below the estimated fare ($${fare.toFixed(2)}).`,
          balance,
        });
        return;
      }
      res.json({
        valid: true,
        message: `Gift card verified${balance !== null ? ` — balance: $${balance.toFixed(2)}` : ""}.`,
        balance,
        code,
      });
      return;
    }

    res.status(400).json({ valid: false, message: `Unknown payment method: ${method}` });
  } catch (err: any) {
    req.log.error({ err }, "GET /verify-payment error");
    res.status(500).json({ valid: false, message: "Verification failed. Please try again." });
  }
});

export default verifyPaymentRouter;
