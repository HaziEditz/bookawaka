import type { DataSnapshot } from "firebase-admin/database";
import { getDatabase } from "./firebase";

type FirebaseDatabase = ReturnType<typeof getDatabase>;

export type PassengerKeyQuery = {
  key?: string;
  phone?: string;
  /** Raw email or passengerIndex/email normalized key */
  email?: string;
};

export function normalizePhoneKey(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

export function normalizeEmailKey(email: string): string {
  return email.toLowerCase().replace(/\./g, ",").replace(/@/g, "__at__");
}

/** Accept raw email or an already-normalized passengerIndex/email key. */
export function emailIndexKey(email: string): string {
  const e = email.trim();
  if (!e) return "";
  return e.includes("@") ? normalizeEmailKey(e) : e;
}

/** NZ phone variants for passengerIndex/phone/{digits} lookups. */
export function phoneIndexCandidates(digits: string): string[] {
  const out = new Set<string>();
  const d = normalizePhoneKey(digits);
  if (!d) return [];
  out.add(d);
  if (d.startsWith("0")) out.add(d.slice(1));
  else if (d.length >= 8) out.add(`0${d}`);
  if (d.startsWith("64") && d.length > 2) out.add(d.slice(2));
  else if (d.length >= 8 && !d.startsWith("64")) out.add(`64${d}`);
  return [...out];
}

async function lookupEmailInIndex(
  db: FirebaseDatabase,
  email: string,
): Promise<string | null> {
  const emailKey = emailIndexKey(email);
  if (!emailKey) return null;
  const snap = await db.ref(`passengerIndex/email/${emailKey}`).once("value");
  const key = snap.val()?.key;
  return key ? String(key) : null;
}

async function lookupPhoneInIndex(
  db: FirebaseDatabase,
  digits: string,
): Promise<string | null> {
  for (const candidate of phoneIndexCandidates(digits)) {
    const snap = await db.ref(`passengerIndex/phone/${candidate}`).once("value");
    const key = snap.val()?.key;
    if (key) return String(key);
  }
  return null;
}

async function walletExists(db: FirebaseDatabase, key: string): Promise<boolean> {
  const snap = await db.ref(`passengerWallet/${key}`).once("value");
  return snap.exists() && snap.val() != null;
}

/**
 * Scan passengerWallet/* for a record whose phone field matches.
 * Used when passengerIndex/phone is missing but wallet lives under web_* keys.
 */
async function scanWalletByPhone(
  db: FirebaseDatabase,
  digits: string,
): Promise<string | null> {
  const candidates = new Set(phoneIndexCandidates(digits));
  const snap = await db.ref("passengerWallet").once("value");
  if (!snap.exists()) return null;

  let found: string | null = null;
  snap.forEach((child: DataSnapshot) => {
    if (found || !child.key) return;
    const w = child.val() as Record<string, unknown> | null;
    if (!w || typeof w !== "object") return;

    const recordPhone = normalizePhoneKey(
      String(w.phone ?? w.passengerPhone ?? w.Phone ?? w.PhoneNo ?? ""),
    );
    if (recordPhone && candidates.has(recordPhone)) {
      found = child.key;
    }
  });
  return found;
}

export type PhoneIndexPayload = {
  key: string;
  uid: string;
  email?: string;
  updatedAt: number;
};

/**
 * Resolve a real Auth email for a passenger uid — prefers opts.email, then
 * users/{uid}.email, then an existing phone-index email. Never invents web_*.
 */
export async function resolvePassengerEmail(
  db: FirebaseDatabase,
  uid: string,
  opts?: { email?: string; phone?: string },
): Promise<string> {
  const fromOpts = String(opts?.email || "").trim().toLowerCase();
  if (fromOpts.includes("@") && !fromOpts.includes("phone.bookawaka.users")) {
    return fromOpts;
  }
  if (fromOpts.includes("@")) return fromOpts;

  try {
    const userSnap = await db.ref(`users/${uid}`).once("value");
    const userEmail = String(userSnap.val()?.email || "").trim().toLowerCase();
    if (userEmail.includes("@")) return userEmail;
  } catch {
    /* continue */
  }

  if (opts?.phone) {
    for (const c of phoneIndexCandidates(opts.phone)) {
      try {
        const snap = await db.ref(`passengerIndex/phone/${c}`).once("value");
        const email = String(snap.val()?.email || "").trim().toLowerCase();
        if (email.includes("@")) return email;
      } catch {
        /* continue */
      }
    }
  }

  return fromOpts;
}

/**
 * Upsert phone index for all NZ digit variants. Always merges via update() so
 * we never wipe an existing email with a key-only write.
 */
export async function upsertPhoneIndex(
  db: FirebaseDatabase,
  phone: string,
  uid: string,
  email?: string,
): Promise<void> {
  const digits = normalizePhoneKey(phone);
  if (!digits || digits.length < 7 || !uid || uid.startsWith("web_") || uid === "guest") return;

  const resolvedEmail = await resolvePassengerEmail(db, uid, { email, phone: digits });
  // Always require a real email so we never leave/write key-only poison rows.
  if (!resolvedEmail.includes("@")) return;

  const phonePayload: Record<string, string | number> = {
    key: uid,
    uid,
    email: resolvedEmail,
    updatedAt: Date.now(),
  };

  // Displace web_* / email-less poison rows: Admin update() replaces the node fields we set.
  const updates: Record<string, Record<string, string | number>> = {};
  for (const candidate of phoneIndexCandidates(digits)) {
    updates[`passengerIndex/phone/${candidate}`] = phonePayload;
  }

  if (resolvedEmail.includes("@")) {
    const emailKey = emailIndexKey(resolvedEmail);
    if (emailKey) {
      updates[`passengerIndex/email/${emailKey}`] = {
        key: uid,
        uid,
        email: resolvedEmail,
        updatedAt: Date.now(),
      };
    }
  }

  updates[`passengerIndex/key/${uid}`] = {
    key: uid,
    uid,
    updatedAt: Date.now(),
    ...(resolvedEmail.includes("@") ? { email: resolvedEmail } : {}),
  };

  await db.ref().update(updates);
}

/**
 * Write passengerIndex/email and passengerIndex/phone rows so future lookups
 * resolve by email (preferred) or phone. Never writes key-only phone rows.
 */
export async function ensurePassengerIndexForWallet(
  db: FirebaseDatabase,
  passengerKey: string,
  opts: { phone?: string; email?: string },
): Promise<void> {
  if (!passengerKey || passengerKey.startsWith("web_")) return;

  if (opts.phone) {
    await upsertPhoneIndex(db, opts.phone, passengerKey, opts.email);
    return;
  }

  if (opts.email) {
    const emailKey = emailIndexKey(opts.email);
    if (!emailKey) return;
    const resolvedEmail = await resolvePassengerEmail(db, passengerKey, { email: opts.email });
    await db.ref().update({
      [`passengerIndex/email/${emailKey}`]: {
        key: passengerKey,
        uid: passengerKey,
        email: resolvedEmail || opts.email.trim().toLowerCase(),
        updatedAt: new Date().toISOString(),
      },
      [`passengerIndex/key/${passengerKey}`]: {
        key: passengerKey,
        uid: passengerKey,
        ...(resolvedEmail.includes("@") ? { email: resolvedEmail } : {}),
        updatedAt: new Date().toISOString(),
      },
    });
  }
}

/**
 * Resolve canonical passengerWallet key.
 * Order: email (passengerIndex/email) → explicit web key → phone index / scan.
 */
export async function resolvePassengerWalletKey(
  db: FirebaseDatabase,
  query: PassengerKeyQuery,
): Promise<string | null> {
  const rawKey = query.key?.trim() ?? "";
  const phoneDigits = query.phone ? normalizePhoneKey(query.phone) : "";
  const emailInput = query.email?.trim() ?? "";

  if (emailInput) {
    const fromEmail = await lookupEmailInIndex(db, emailInput);
    if (fromEmail) return fromEmail;
  }

  if (rawKey) {
    const [hasWallet, keyIdxSnap] = await Promise.all([
      walletExists(db, rawKey),
      db.ref(`passengerIndex/key/${rawKey}`).once("value"),
    ]);
    if (hasWallet || keyIdxSnap.exists()) {
      return rawKey;
    }
  }

  const phoneToLookup =
    phoneDigits ||
    (rawKey && /^\d{8,15}$/.test(normalizePhoneKey(rawKey))
      ? normalizePhoneKey(rawKey)
      : "");

  if (phoneToLookup) {
    const fromIndex = await lookupPhoneInIndex(db, phoneToLookup);
    if (fromIndex) return fromIndex;

    const fromScan = await scanWalletByPhone(db, phoneToLookup);
    if (fromScan) return fromScan;
  }

  if (rawKey && (await walletExists(db, rawKey))) {
    return rawKey;
  }

  return null;
}
