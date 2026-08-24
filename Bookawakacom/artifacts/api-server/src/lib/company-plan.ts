import type { database } from "firebase-admin";

export type SuperPackage = {
  name: string;
  billingType?: string;
  pricePerCar?: number | null;
  monthlyPrice?: number | null;
  flatPrice?: number | null;
  minimumMonthly?: number | null;
  trialDays?: number | null;
  modules?: { taxi?: boolean; food?: boolean; freight?: boolean };
  active?: boolean;
  showOnJoin?: boolean;
  sortOrder?: number;
};

export function planPerCarRate(pkg: SuperPackage | null): number {
  if (!pkg) return 0;
  const bt = pkg.billingType || "per_car_monthly";
  if (bt === "flat_monthly") return +(pkg.flatPrice || 0);
  if (bt === "flat_annual") return +(pkg.flatPrice || 0) / 12;
  return +(pkg.pricePerCar || pkg.monthlyPrice || 0);
}

export function isTrialPackage(pkgId: string, pkg: SuperPackage | null): boolean {
  if (pkgId === "pkg_trial") return true;
  return !!(pkg?.trialDays && pkg.trialDays > 0);
}

export function resolvePlanStatus(pkgId: string, pkg: SuperPackage | null): "trial" | "active" {
  return isTrialPackage(pkgId, pkg) ? "trial" : "active";
}

export function isoDatePlusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function generateUniqueCompanyId(db: database.Database): Promise<string> {
  const existingSnap = await db.ref("superClients").once("value");
  const existing = existingSnap.val() || {};
  for (let i = 0; i < 25; i++) {
    const cid = String(Math.floor(100000 + Math.random() * 900000));
    if (!existing[cid]) return cid;
  }
  throw new Error("Could not allocate a unique company ID");
}

export type ProvisionCompanyInput = {
  companyId: string;
  packageId: string;
  pkg: SuperPackage;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  authUid?: string;
  contractedFleet?: number;
  source?: string;
  refId?: string;
};

export async function provisionCompanyPlan(
  db: database.Database,
  input: ProvisionCompanyInput,
): Promise<{ status: "trial" | "active"; trialEnd: number | null; trialEndDate: string | null }> {
  const {
    companyId: cid,
    packageId: pkgId,
    pkg,
    businessName,
    contactName,
    email,
    phone,
    city,
    country,
    authUid,
    contractedFleet = 0,
    source = "website",
    refId,
  } = input;

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const billingStartDate = todayISO();
  const nextDueDate = isoDatePlusDays(30);
  const monthlyRate = planPerCarRate(pkg);
  const status = resolvePlanStatus(pkgId, pkg);
  const isTrial = status === "trial";
  const trialDays = pkg.trialDays || (pkgId === "pkg_trial" ? 30 : 0);
  const trialEndDate = isTrial && trialDays > 0 ? isoDatePlusDays(trialDays) : null;
  const trialEnd = trialEndDate ? Date.parse(trialEndDate + "T23:59:59.999Z") : null;
  const modules = {
    taxi: !!(pkg.modules && pkg.modules.taxi),
    food: !!(pkg.modules && pkg.modules.food),
    freight: !!(pkg.modules && pkg.modules.freight),
  };
  const features = {
    taxi: modules.taxi,
    food: modules.food,
    freight: modules.freight,
  };
  const minimumMonthly = pkg.minimumMonthly != null ? pkg.minimumMonthly : null;

  const writes: Promise<unknown>[] = [
    db.ref(`companySettings/${cid}/plan`).set(pkg.name),
    db.ref(`companySettings/${cid}/billing`).set({
      packageId: pkgId,
      monthlyRate,
      billingStartDate,
      nextDueDate,
      contractedFleet,
      updatedAt: nowIso,
    }),
    db.ref(`companyBilling/${cid}`).set({
      packageId: pkgId,
      pricePerCarOverride: null,
      contractedFleet,
      minimumMonthly,
    }),
    db.ref(`superBilling/${cid}/info`).set({
      packageId: pkgId,
      packageName: pkg.name,
      monthlyRate,
      status,
      billingStart: billingStartDate,
      startDate: billingStartDate,
      nextDueDate,
      updatedAt: nowMs,
    }),
    db.ref(`companySettings/${cid}/features`).set(features),
  ];

  const superClient: Record<string, unknown> = {
    name: businessName,
    email,
    contactEmail: email,
    phone,
    contactPhone: phone,
    contactName,
    city,
    country,
    plan: pkg.name,
    packageId: pkgId,
    packageName: pkg.name,
    status,
    subscriptionStatus: status,
    modules,
    createdAt: nowMs,
    onboardedBy: source,
    ownerUid: authUid || null,
  };
  if (refId) superClient.onboardedFrom = refId;
  if (isTrial) {
    superClient.trialDays = trialDays;
    superClient.trialStart = nowMs;
    if (trialEnd) superClient.trialEnd = trialEnd;
    if (trialEndDate) superClient.trialEndDate = trialEndDate;
  }

  writes.push(db.ref(`superClients/${cid}`).set(superClient));

  // Website / MailerSend scheduled alerts read companyProfiles.email — keep in sync
  // with the registration contact email (historically only written to superClients).
  const profileEmail = String(email || "").trim();
  if (profileEmail) {
    writes.push(
      db.ref(`companyProfiles/${cid}`).update({
        email: profileEmail,
        name: businessName,
        contactEmail: profileEmail,
        updatedAt: nowMs,
      }),
    );
  }

  if (authUid) {
    writes.push(
      db.ref(`adminAccess/${cid}/${authUid}`).set(true),
      db.ref(`users/${authUid}/companyId`).set(cid),
      db.ref(`users/${authUid}/role`).set("owner"),
    );
  }

  await Promise.all(writes);

  return { status, trialEnd, trialEndDate };
}
