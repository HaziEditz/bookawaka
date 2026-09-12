import { getDatabase } from "./firebase";
import { collectPassengerJobKeys, toCanonicalPhone } from "./passengerKey";
import { isLiveAsapStatus, jobLooksAsap, serviceTypesMatch } from "./asap-guard";

export function normalizePhoneKey(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

/** Skip allbookings round-trip when Passengerjobs already shows a non-live status. */
export function paxRowNeedsLiveConfirm(status: unknown): boolean {
  const raw = String(status ?? "").trim();
  if (!raw) return true;
  return isLiveAsapStatus(raw);
}

function jobCreatedAtMs(job: Record<string, unknown> | null | undefined): number {
  if (!job) return 0;
  const n = Number(job.createdAt);
  if (Number.isFinite(n) && n > 0) return n;
  const parsed = Date.parse(String(job.CreatedAt ?? job.createdAt ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

const ACTIVE_CHECK_TIMEOUT_MS = 8_000;

export interface ActiveBookingMatch {
  existingBookingId: string;
  existingStatus: string;
  serviceType: string;
}

export async function findActiveBooking(
  passengerPhone: string,
  serviceType: string,
  excludeJobId?: string
): Promise<ActiveBookingMatch | null> {
  const work = findActiveBookingUncapped(passengerPhone, serviceType, excludeJobId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ACTIVE_CHECK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function findActiveBookingUncapped(
  passengerPhone: string,
  serviceType: string,
  excludeJobId?: string
): Promise<ActiveBookingMatch | null> {
  const canonical = toCanonicalPhone(passengerPhone);
  const normalizedServiceType = serviceType.toLowerCase().trim();
  if (!canonical || !normalizedServiceType) return null;

  const db = getDatabase();
  const treeKeys = await collectPassengerJobKeys(db, { phone: passengerPhone });
  if (!treeKeys.length) return null;

  for (const existingKey of treeKeys) {
    const jobsSnap = await db.ref(`Passengerjobs/${existingKey}`).once("value");
    const jobs: Record<string, any> = jobsSnap.val() ?? {};
    const rows = Object.entries(jobs).sort((a, b) => jobCreatedAtMs(b[1]) - jobCreatedAtMs(a[1]));

    for (const [existingId, job] of rows) {
      if (excludeJobId && existingId === excludeJobId) continue;
      if (!serviceTypesMatch(job?.ServiceType ?? job?.serviceType, normalizedServiceType)) continue;
      if (!jobLooksAsap(job)) continue;

      const paxStatus = job?.Status ?? job?.status ?? "";
      if (!paxRowNeedsLiveConfirm(paxStatus)) continue;

      const jobCid = job?.CompanyId ?? job?.companyId;
      let liveStatus: string = (paxStatus ?? "").toString();
      if (jobCid) {
        try {
          const liveSnap = await db.ref(`allbookings/${jobCid}/${existingId}`).once("value");
          const live = liveSnap.val();
          if (live) {
            liveStatus = (live.Status ?? live.status ?? liveStatus).toString();
          }
        } catch {
          // best-effort
        }
      }

      if (!isLiveAsapStatus(liveStatus)) continue;

      return {
        existingBookingId: existingId,
        existingStatus: liveStatus,
        serviceType,
      };
    }
  }

  return null;
}
