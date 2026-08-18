import { Router } from "express";
import { getDatabase } from "../lib/firebase";
import { logger } from "../lib/logger";

const jobRouter = Router();

const VALID_SOURCES = ["dispatch", "hail", "passenger", "web", "food", "freight"] as const;
type JobSource = (typeof VALID_SOURCES)[number];

function todayKey(): string {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

/**
 * Atomically bump jobCounters/{companyId}/{dateKey}.
 * Counter may be a bare number (legacy) or `{ count }` — both supported.
 */
async function nextSequence(companyId: string, dateKey: string): Promise<number> {
  const db = getDatabase();
  const ref = db.ref(`jobCounters/${companyId}/${dateKey}`);
  const result = await ref.transaction((current: unknown) => {
    if (current == null) return 1;
    if (typeof current === "number" && isFinite(current)) return current + 1;
    if (current && typeof current === "object" && isFinite(Number((current as { count?: unknown }).count))) {
      return { ...(current as object), count: Number((current as { count: number }).count) + 1, updatedAt: Date.now() };
    }
    return 1;
  });
  const committed = result.snapshot.val();
  if (typeof committed === "number" && isFinite(committed)) return committed;
  if (committed && typeof committed === "object" && isFinite(Number((committed as { count?: unknown }).count))) {
    return Number((committed as { count: number }).count);
  }
  return 1;
}

/**
 * Seed counter to at least max sequence already present in allbookings for today's
 * prefix — same belt-and-braces as the July 2026 ghost-job fix / SA generateJobId.
 */
async function seedCounterFromAllbookings(companyId: string, dateKey: string, prefix: string): Promise<void> {
  const db = getDatabase();
  let maxSeq = 0;
  try {
    const snap = await db.ref(`allbookings/${companyId}`).get();
    if (!snap.exists()) return;
    const all = snap.val() as Record<string, unknown>;
    for (const id of Object.keys(all || {})) {
      if (id.startsWith(prefix) && id.length > prefix.length) {
        const seqStr = id.slice(prefix.length);
        if (/^\d+$/.test(seqStr)) {
          const n = parseInt(seqStr, 10);
          if (n > maxSeq) maxSeq = n;
        }
      }
    }
  } catch (err) {
    logger.warn({ err, companyId }, "job/create: allbookings seed scan failed");
    return;
  }
  if (maxSeq <= 0) return;

  const ref = db.ref(`jobCounters/${companyId}/${dateKey}`);
  await ref.transaction((current: unknown) => {
    let cur = 0;
    if (typeof current === "number" && isFinite(current)) cur = current;
    else if (current && typeof current === "object") cur = Number((current as { count?: unknown }).count) || 0;
    if (cur >= maxSeq) return; // abort — already ahead (Firebase treats undefined as abort)
    return maxSeq;
  });
}

/**
 * Allocate a job ID that is confirmed absent from allbookings + pendingjobs.
 * Mirrors INVT allocateCompanyJobId: never return a ghost Completed/Cancelled ID.
 */
async function allocateFreeWebJobId(companyId: string): Promise<string> {
  const db = getDatabase();
  const dateKey = todayKey();
  const companySuffix = companyId.slice(-3);
  const prefix = `${companySuffix}${dateKey}`;
  await seedCounterFromAllbookings(companyId, dateKey, prefix);

  const maxAttempts = 500;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const seq = await nextSequence(companyId, dateKey);
    const jobId = `${prefix}${seq}`;

    const [abSnap, pendSnap] = await Promise.all([
      db.ref(`allbookings/${companyId}/${jobId}`).get(),
      db.ref(`pendingjobs/${companyId}/${jobId}`).get(),
    ]);

    if (abSnap.exists() || pendSnap.exists()) {
      logger.info(
        { companyId, jobId, attempt: attempt + 1, inAllbookings: abSnap.exists(), inPending: pendSnap.exists() },
        "job/create: ghost/live ID collision — jumping seq +40"
      );
      // Dense ghost regions: burn ahead so we spend budget finding free IDs.
      for (let j = 0; j < 39; j++) await nextSequence(companyId, dateKey);
      continue;
    }

    if (attempt > 0) {
      logger.info({ companyId, jobId, attempts: attempt + 1 }, "job/create: allocated after collision skips");
    }
    return jobId;
  }

  throw new Error(`exhausted ${maxAttempts} free job ID allocation attempts for company ${companyId}`);
}

jobRouter.post("/job/create", async (req, res) => {
  const {
    companyId,
    source,
    passenger,
    pickup,
    dropoff,
    tariffId,
    notes,
  } = req.body as {
    companyId?: string;
    source?: string;
    passenger?: { name?: string; phone?: string };
    pickup?: { address?: string; lat?: number; lng?: number };
    dropoff?: { address?: string; lat?: number; lng?: number };
    tariffId?: string;
    notes?: string;
  };

  if (!companyId) {
    res.status(400).json({ ok: false, error: "companyId is required" });
    return;
  }

  if (!source || !VALID_SOURCES.includes(source as JobSource)) {
    res.status(400).json({
      ok: false,
      error: `source must be one of: ${VALID_SOURCES.join(" | ")}`,
    });
    return;
  }

  try {
    const jobId = await allocateFreeWebJobId(companyId);
    const createdAt = Math.floor(Date.now() / 1000);

    const db = getDatabase();
    await db.ref(`jobs/${companyId}/${jobId}`).set({
      jobId,
      companyId,
      source,
      createdAt,
      passenger: passenger ?? null,
      pickup: pickup ?? null,
      dropoff: dropoff ?? null,
      tariffId: tariffId ?? null,
      notes: notes ?? "",
      status: "created",
    });

    req.log.info({ jobId, companyId, source }, "Job created");
    res.json({ ok: true, jobId, createdAt });
  } catch (err: any) {
    req.log.error({ err }, "POST /job/create error");
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default jobRouter;
