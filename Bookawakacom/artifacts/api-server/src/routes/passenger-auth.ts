import { Router, type Request, type Response } from "express";
import type { DataSnapshot } from "firebase-admin/database";
import { FIREBASE_CONFIG, getAuth, getDatabase } from "../lib/firebase";
import { normalizeEmailKey, phoneIndexCandidates, toCanonicalPhone, upsertPhoneIndex } from "../lib/passengerKey";

const passengerAuthRouter = Router();

const API_KEY = FIREBASE_CONFIG.apiKey;

function normalisePhone(raw: string): string {
  return String(raw || "").replace(/\D/g, "");
}

function phoneAuthEmail(digits: string): string {
  return `p${digits}@phone.bookawaka.users`;
}

function looksLikeEmail(raw: string): boolean {
  return String(raw || "").includes("@");
}

function isPoisonPassengerKey(key: string): boolean {
  return !key || key === "guest" || key.startsWith("web_");
}

async function resolveLoginEmail(identifier: string): Promise<string> {
  const trimmed = String(identifier || "").trim();
  if (looksLikeEmail(trimmed)) return trimmed.toLowerCase();

  const digits = normalisePhone(trimmed);
  if (!digits || digits.length < 7) {
    const err = new Error("Enter a valid email or phone number.");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }

  const db = getDatabase();
  let indexedUid = "";
  // Canonical first; phoneIndexCandidates also includes legacy variants for migration.
  for (const c of phoneIndexCandidates(toCanonicalPhone(digits) || digits)) {
    const snap = await db.ref(`passengerIndex/phone/${c}`).once("value");
    const row = snap.val() as Record<string, unknown> | null;
    if (!row) continue;
    const key = String(row.key || row.uid || "").trim();
    const email = String(row.email || "").trim();
    // Skip web_* / guest poison rows that have no usable email.
    if (isPoisonPassengerKey(key) && !email.includes("@")) continue;
    if (email.includes("@")) {
      const uid = String(row.uid || row.key || "").trim();
      // Promote legacy 0… / bare keys to the single canonical 64… row.
      if (uid && !isPoisonPassengerKey(uid)) {
        void upsertPhoneIndex(db, digits, uid, email).catch(() => undefined);
      }
      return email.toLowerCase();
    }
    const uid = String(row.uid || row.key || "").trim();
    if (uid && !isPoisonPassengerKey(uid) && !indexedUid) indexedUid = uid;
  }

  if (indexedUid) {
    try {
      const userSnap = await db.ref(`users/${indexedUid}`).once("value");
      const userEmail = String(userSnap.val()?.email || "").trim();
      if (userEmail.includes("@")) return userEmail.toLowerCase();
    } catch {
      /* continue */
    }
    try {
      const authUser = await getAuth().getUser(indexedUid);
      if (authUser.email) return authUser.email.toLowerCase();
    } catch {
      /* continue */
    }
  }

  // Scan users by phone when index is missing or poisoned.
  try {
    const candidateSet = new Set(phoneIndexCandidates(digits));
    for (const c of phoneIndexCandidates(toCanonicalPhone(digits) || digits)) {
      candidateSet.add(c);
    }
    const usersSnap = await db.ref("users").once("value");
    if (usersSnap.exists()) {
      let foundEmail = "";
      usersSnap.forEach((child: DataSnapshot) => {
        if (foundEmail || !child.key || isPoisonPassengerKey(child.key)) return;
        const u = child.val() as Record<string, unknown> | null;
        if (!u || typeof u !== "object") return;
        const phone = normalisePhone(String(u.phone ?? u.Phone ?? u.PhoneNo ?? ""));
        if (!phone) return;
        if (!candidateSet.has(phone) && !candidateSet.has(toCanonicalPhone(phone))) return;
        const email = String(u.email ?? "").trim();
        if (email.includes("@")) foundEmail = email.toLowerCase();
      });
      if (foundEmail) return foundEmail;
    }
  } catch {
    /* continue */
  }

  return phoneAuthEmail(toCanonicalPhone(digits) || digits);
}

async function identityToolkit(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/${path}?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

passengerAuthRouter.post("/passenger-auth/register", async (req: Request, res: Response) => {
  try {
    const name = String(req.body?.name || "").trim();
    const emailRaw = String(req.body?.email || "").trim().toLowerCase();
    const phone = String(req.body?.phone || "").trim();
    const password = String(req.body?.password || "");
    // UI sends already-canonical digits (e.g. "6421123567"); still run through
    // toCanonicalPhone so free-text / legacy callers stay consistent.
    const phoneDigits = toCanonicalPhone(phone);

    if (!name || !emailRaw || password.length < 6) {
      return res.status(400).json({ error: "Name, email, and a password of at least 6 characters are required." });
    }
    if (!phoneDigits || phoneDigits.length < 7) {
      return res.status(400).json({ error: "A valid phone number is required." });
    }

    const authEmail = emailRaw;
    const created = await identityToolkit("accounts:signUp", {
      email: authEmail,
      password,
      displayName: name,
      returnSecureToken: true,
    });
    if (!created.ok) {
      const msg = String((created.json.error as { message?: string } | undefined)?.message || "Register failed");
      const status = /EMAIL_EXISTS/i.test(msg) ? 409 : 400;
      return res.status(status).json({
        error: /EMAIL_EXISTS/i.test(msg)
          ? "This email is already registered. Try signing in."
          : msg,
      });
    }

    const uid = String(created.json.localId || "");
    const idToken = String(created.json.idToken || "");
    const refreshToken = String(created.json.refreshToken || "");

    const db = getDatabase();
    await db.ref(`users/${uid}`).set({
      name,
      email: authEmail,
      phone: phoneDigits,
      walletBalance: 0,
      createdAt: Date.now(),
      source: "website",
    });
    await upsertPhoneIndex(db, phoneDigits, uid, authEmail);
    if (emailRaw) {
      await db.ref(`passengerIndex/email/${normalizeEmailKey(emailRaw)}`).set({
        key: uid,
        uid,
        email: authEmail,
      }).catch(() => undefined);
    }
    await db.ref(`passengerIndex/key/${uid}`).update({
      key: uid,
      uid,
      email: authEmail,
      createdAt: new Date().toISOString(),
    }).catch(() => undefined);

    try {
      await getAuth().updateUser(uid, { displayName: name });
    } catch {
      /* best-effort */
    }

    return res.json({
      ok: true,
      uid,
      email: authEmail,
      name,
      phone: phoneDigits,
      idToken,
      refreshToken,
    });
  } catch (err: unknown) {
    const e = err as Error & { status?: number };
    return res.status(e.status || 500).json({ error: e.message || "Register failed" });
  }
});

passengerAuthRouter.post("/passenger-auth/login", async (req: Request, res: Response) => {
  try {
    const identifier = String(req.body?.identifier || req.body?.email || "").trim();
    const password = String(req.body?.password || "");
    if (!identifier || !password) {
      return res.status(400).json({ error: "Email/phone and password are required." });
    }
    const email = await resolveLoginEmail(identifier);
    const signed = await identityToolkit("accounts:signInWithPassword", {
      email,
      password,
      returnSecureToken: true,
    });
    if (!signed.ok) {
      return res.status(401).json({ error: "Incorrect email/phone or password." });
    }
    const uid = String(signed.json.localId || "");
    const db = getDatabase();
    const profileSnap = await db.ref(`users/${uid}`).once("value");
    const profile = (profileSnap.val() || {}) as Record<string, unknown>;
    const resolvedEmail = String(profile.email || email || "").trim().toLowerCase();
    const profilePhone = String(profile.phone || "").trim();
    // Rebuild canonical passengerIndex/phone on every successful login so
    // legacy 0… rows converge to 64… without requiring re-registration.
    const phoneForIndex =
      profilePhone ||
      (!looksLikeEmail(identifier) ? String(identifier) : "");
    if (phoneForIndex && resolvedEmail.includes("@")) {
      void upsertPhoneIndex(db, phoneForIndex, uid, resolvedEmail).catch(() => undefined);
    }
    return res.json({
      ok: true,
      uid,
      email: resolvedEmail,
      name: String(profile.name || signed.json.displayName || ""),
      phone: profilePhone,
      idToken: String(signed.json.idToken || ""),
      refreshToken: String(signed.json.refreshToken || ""),
    });
  } catch (err: unknown) {
    const e = err as Error & { status?: number };
    return res.status(e.status || 500).json({ error: e.message || "Login failed" });
  }
});

passengerAuthRouter.post("/passenger-auth/forgot", async (req: Request, res: Response) => {
  try {
    const identifier = String(req.body?.identifier || req.body?.email || "").trim();
    if (!identifier) {
      return res.status(400).json({ error: "Enter your email or phone number." });
    }
    const email = await resolveLoginEmail(identifier);
    const reset = await identityToolkit("accounts:sendOobCode", {
      requestType: "PASSWORD_RESET",
      email,
    });
    if (!reset.ok) {
      const msg = String((reset.json.error as { message?: string } | undefined)?.message || "Reset failed");
      return res.status(400).json({
        error: /EMAIL_NOT_FOUND/i.test(msg)
          ? "No account found with that email or phone."
          : msg,
      });
    }
    return res.json({ ok: true, email });
  } catch (err: unknown) {
    const e = err as Error & { status?: number };
    return res.status(e.status || 500).json({ error: e.message || "Reset failed" });
  }
});

passengerAuthRouter.get("/passenger-auth/session", async (req: Request, res: Response) => {
  try {
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : String(req.query.idToken || "").trim();
    if (!token) return res.status(401).json({ error: "Not signed in" });
    const decoded = await getAuth().verifyIdToken(token);
    const db = getDatabase();
    const snap = await db.ref(`users/${decoded.uid}`).once("value");
    const profile = (snap.val() || {}) as Record<string, unknown>;
    return res.json({
      ok: true,
      uid: decoded.uid,
      email: String(profile.email || decoded.email || ""),
      name: String(profile.name || ""),
      phone: String(profile.phone || ""),
    });
  } catch {
    return res.status(401).json({ error: "Session expired — please sign in again." });
  }
});

/**
 * Admin-only: promote legacy phone-index rows to the single canonical 64… key.
 * Body: { phones: string[] } e.g. ["0275683723","021304322"]
 */
passengerAuthRouter.post("/passenger-auth/heal-phone-index", async (req: Request, res: Response) => {
  try {
    const expected = process.env["BW_ADMIN_KEY"];
    const provided = req.header("X-Admin-Key");
    if (!expected || !provided || provided !== expected) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const phones = Array.isArray(req.body?.phones)
      ? (req.body.phones as unknown[]).map((p) => String(p || "").trim()).filter(Boolean)
      : [];
    if (!phones.length) {
      return res.status(400).json({ error: "phones: string[] required" });
    }
    const db = getDatabase();
    const results: Array<Record<string, unknown>> = [];
    for (const phone of phones) {
      const canonical = toCanonicalPhone(phone);
      let email = "";
      let uid = "";
      for (const c of phoneIndexCandidates(canonical || phone)) {
        const snap = await db.ref(`passengerIndex/phone/${c}`).once("value");
        const row = snap.val() as Record<string, unknown> | null;
        if (!row) continue;
        const rowEmail = String(row.email || "").trim();
        const rowUid = String(row.uid || row.key || "").trim();
        if (rowEmail.includes("@")) email = rowEmail.toLowerCase();
        if (rowUid && !isPoisonPassengerKey(rowUid)) uid = rowUid;
        if (email && uid) break;
      }
      if ((!email || !uid) && canonical) {
        // Fall back: scan users for matching phone
        const usersSnap = await db.ref("users").once("value");
        const want = new Set(phoneIndexCandidates(canonical));
        usersSnap.forEach((child: DataSnapshot) => {
          if ((email && uid) || !child.key || isPoisonPassengerKey(child.key)) return;
          const u = child.val() as Record<string, unknown> | null;
          if (!u || typeof u !== "object") return;
          const p = normalisePhone(String(u.phone ?? u.Phone ?? u.PhoneNo ?? ""));
          if (!p || (!want.has(p) && !want.has(toCanonicalPhone(p)))) return;
          const e = String(u.email || "").trim();
          if (e.includes("@")) {
            email = e.toLowerCase();
            uid = child.key;
          }
        });
      }
      if (!email || !uid) {
        results.push({ phone, canonical, ok: false, reason: "not_found" });
        continue;
      }
      await upsertPhoneIndex(db, phone, uid, email);
      results.push({ phone, canonical, uid: uid.slice(0, 10), emailDomain: email.split("@")[1], ok: true });
    }
    return res.json({ ok: true, results });
  } catch (err: unknown) {
    const e = err as Error;
    return res.status(500).json({ error: e.message || "Heal failed" });
  }
});

export default passengerAuthRouter;
