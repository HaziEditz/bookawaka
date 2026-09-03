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

/**
 * Produce ONE canonical phone key for passengerIndex/phone/{digits}.
 * Default NZ (+64): strip leading 0, ensure starts with country code.
 * e.g. "0211234567" → "64211234567", "211234567" → "64211234567",
 *      "64211234567" → "64211234567".
 *
 * If the number already starts with a known non-NZ country code (61, 1, 44…),
 * leave it as-is (already international).
 */
const KNOWN_CC = ["64", "61", "1", "44", "65", "91", "86", "81", "82", "33", "49", "39", "34", "7", "55", "52", "27", "66", "62", "63", "84", "60"];

export function toCanonicalPhone(phone: string): string {
  let d = normalizePhoneKey(phone);
  if (!d) return "";
  // Strip a single leading trunk-zero (NZ/AU style) before prepending CC
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  // Already starts with a known country code → leave as-is
  if (KNOWN_CC.some((cc) => d.startsWith(cc) && d.length > cc.length + 5)) return d;
  // Default: NZ +64
  return `64${d}`;
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

/**
 * Lookup candidates for passengerIndex/phone/{digits}.
 * Canonical form is ALWAYS first. Legacy variants are included only so
 * existing multi-format rows still resolve during the migration window.
 * New writes use toCanonicalPhone() exclusively — never these variants.
 */
export function phoneIndexCandidates(digits: string): string[] {
  const out: string[] = [];
  const d = normalizePhoneKey(digits);
  if (!d) return [];
  const canonical = toCanonicalPhone(d);
  out.push(canonical);
  if (d !== canonical) out.push(d);
  // Legacy local / trunk-zero / bare-national forms (read-only fallback)
  if (d.startsWith("0")) {
    const bare = d.slice(1);
    if (bare && !out.includes(bare)) out.push(bare);
    if (!out.includes(`64${bare}`)) out.push(`64${bare}`);
  } else if (!d.startsWith("64") && d.length >= 8) {
    if (!out.includes(`0${d}`)) out.push(`0${d}`);
  }
  if (d.startsWith("64") && d.length > 2) {
    const bare = d.slice(2);
    if (bare && !out.includes(bare)) out.push(bare);
    if (!out.includes(`0${bare}`)) out.push(`0${bare}`);
  }
  return [...new Set(out)];
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
  candidates.add(toCanonicalPhone(digits));
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
    if (recordPhone && (candidates.has(recordPhone) || candidates.has(toCanonicalPhone(recordPhone)))) {
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
 * Upsert ONE canonical phone-index row.
 * No longer writes the 0 / bare / 64 variant triples — just the single
 * canonical key produced by toCanonicalPhone().
 * Also removes matching legacy variant rows for the same uid.
 */
export async function upsertPhoneIndex(
  db: FirebaseDatabase,
  phone: string,
  uid: string,
  email?: string,
): Promise<void> {
  const canonical = toCanonicalPhone(phone);
  if (!canonical || canonical.length < 7 || !uid || uid.startsWith("web_") || uid === "guest") return;

  const resolvedEmail = await resolvePassengerEmail(db, uid, { email, phone: canonical });
  // Always require a real email so we never leave/write key-only poison rows.
  if (!resolvedEmail.includes("@")) return;

  const phonePayload: Record<string, string | number> = {
    key: uid,
    uid,
    email: resolvedEmail,
    updatedAt: Date.now(),
  };

  const updates: Record<string, Record<string, string | number> | null> = {};
  // Write the single canonical row
  updates[`passengerIndex/phone/${canonical}`] = phonePayload;

  // Clean up legacy variant rows so the index converges to one key per number.
  // Only remove variants that point at the SAME uid (don't clobber another account).
  const legacy = phoneIndexCandidates(canonical).filter((c) => c !== canonical);
  for (const c of legacy) {
    try {
      const snap = await db.ref(`passengerIndex/phone/${c}`).once("value");
      const row = snap.val() as Record<string, unknown> | null;
      if (!row) continue;
      const rowUid = String(row.uid || row.key || "");
      if (rowUid === uid || !rowUid || rowUid.startsWith("web_")) {
        updates[`passengerIndex/phone/${c}`] = null; // delete
      }
    } catch {
      /* best-effort cleanup */
    }
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
