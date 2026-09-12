import { getDatabase } from "./firebase";
import { collectPassengerJobKeys, toCanonicalPhone } from "./passengerKey";
import { isLiveAsapStatus, jobLooksAsap, serviceTypesMatch } from "./asap-guard";

export function normalizePhoneKey(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

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
  const canonical = toCanonicalPhone(passengerPhone);
  const normalizedServiceType = serviceType.toLowerCase().trim();
  if (!canonical || !normalizedServiceType) return null;

  const db = getDatabase();
  const treeKeys = await collectPassengerJobKeys(db, { phone: passengerPhone });
  if (!treeKeys.length) return null;

  for (const existingKey of treeKeys) {
    const jobsSnap = await db.ref(`Passengerjobs/${existingKey}`).once("value");
    const jobs: Record<string, any> = jobsSnap.val() ?? {};

    for (const [existingId, job] of Object.entries(jobs)) {
      if (excludeJobId && existingId === excludeJobId) continue;
      if (!serviceTypesMatch(job?.ServiceType ?? job?.serviceType, normalizedServiceType)) continue;
      if (!jobLooksAsap(job)) continue;

      const jobCid = job?.CompanyId ?? job?.companyId;
      let liveStatus: string = (job?.Status ?? job?.status ?? "").toString();
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
