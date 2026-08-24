import { getDatabase } from "./firebase";

/**
 * Resolve the best company notification email for booking alerts.
 * Prefer companyProfiles (what the website list API exposes), then
 * companySettings / superClients — registration historically wrote only
 * superClients.email and left companyProfiles.email empty.
 */
export async function resolveCompanyEmail(
  companyId: string | undefined | null,
  bodyEmail?: string | null,
): Promise<string> {
  const fromBody = String(bodyEmail || "").trim();
  const cid = String(companyId || "").trim();
  if (!cid) return fromBody;

  try {
    const db = getDatabase();
    const [profileSnap, settingsSnap, superSnap] = await Promise.all([
      db.ref(`companyProfiles/${cid}`).once("value"),
      db.ref(`companySettings/${cid}`).once("value"),
      db.ref(`superClients/${cid}`).once("value"),
    ]);
    const profile = profileSnap.val() || {};
    const settings = settingsSnap.val() || {};
    const superClient = superSnap.val() || {};

    const candidates = [
      profile.email,
      profile.supportEmail,
      profile.contactEmail,
      settings.email,
      settings.supportEmail,
      settings.contactEmail,
      superClient.email,
      superClient.contactEmail,
      superClient.supportEmail,
      fromBody,
    ];
    for (const c of candidates) {
      const e = String(c || "").trim();
      if (e && e.includes("@")) return e;
    }
  } catch {
    /* fall through */
  }
  return fromBody;
}
