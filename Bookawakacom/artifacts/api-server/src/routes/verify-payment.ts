import { Router } from "express";
import { getDatabase } from "../lib/firebase";

const verifyPaymentRouter = Router();

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

  const ref = (reference as string | undefined)?.trim() ?? "";
  if (!ref) {
    res.json({ valid: false, message: "Reference number cannot be empty." });
    return;
  }

  try {
    const db = getDatabase();

    if (method === "account") {
      const snap = await db.ref(`accountClients/${cid}/${ref}`).once("value");
      const data = snap.val();
      if (!data) {
        res.json({ valid: false, message: "Account number not found. Please check and try again." });
        return;
      }
      if (data.status !== "active") {
        res.json({ valid: false, message: `Account is ${data.status ?? "not active"}. Please contact the company.` });
        return;
      }
      res.json({ valid: true, message: `Account verified${data.name ? `: ${data.name}` : ""}.` });

    } else if (method === "acc") {
      const snap = await db.ref(`accClients/${cid}/${ref}`).once("value");
      const data = snap.val();
      if (!data) {
        res.json({ valid: false, message: "ACC claim number not found. Please check and try again." });
        return;
      }
      if (data.status !== "active") {
        res.json({ valid: false, message: `ACC claim is ${data.status ?? "not active"}.` });
        return;
      }
      if (typeof data.remainingAllocation === "number" && data.remainingAllocation <= 0) {
        res.json({ valid: false, message: "ACC allocation is exhausted for this claim." });
        return;
      }
      res.json({ valid: true, message: `ACC claim verified${data.claimantName ? `: ${data.claimantName}` : ""}.` });

    } else if (method === "tm") {
      const snap = await db.ref(`tmClients/${cid}/${ref}`).once("value");
      const data = snap.val();
      if (!data) {
        res.json({ valid: false, message: "Total Mobility card not found. Please check and try again." });
        return;
      }
      if (data.status !== "active") {
        res.json({ valid: false, message: `Total Mobility card is ${data.status ?? "not active"}.` });
        return;
      }
      res.json({ valid: true, message: "Total Mobility card verified." });

    } else if (method === "giftcard") {
      const snap = await db.ref(`giftCards/${cid}/${ref}`).once("value");
      const data = snap.val();
      if (!data) {
        res.json({ valid: false, message: "Gift card code not found. Please check and try again." });
        return;
      }
      if (data.status && data.status !== "active") {
        res.json({ valid: false, message: `Gift card is ${data.status}.` });
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
      });

    } else {
      res.status(400).json({ valid: false, message: `Unknown payment method: ${method}` });
    }
  } catch (err: any) {
    req.log.error({ err }, "GET /verify-payment error");
    res.status(500).json({ valid: false, message: "Verification failed. Please try again." });
  }
});

export default verifyPaymentRouter;
