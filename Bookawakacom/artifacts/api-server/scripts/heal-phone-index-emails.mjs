/**
 * Heal + consolidate passengerIndex/phone rows:
 * 1. Fix missing email / web_* poison keys
 * 2. Collapse multi-variant rows (0… / bare / 64…) into ONE canonical key
 *
 * Usage:
 *   node scripts/heal-phone-index-emails.mjs           # dry-run
 *   node scripts/heal-phone-index-emails.mjs --apply   # write
 *
 * Loads Admin credentials from FIREBASE_* env / service account.
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");

function loadEnv() {
  const candidates = [
    resolve(__dirname, "../../../.env"),
    resolve(__dirname, "../../.env"),
    resolve(__dirname, "../.env"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[m[1].trim()]) process.env[m[1].trim()] = v.replace(/\\n/g, "\n");
    }
  }
}

loadEnv();

const KNOWN_CC = ["64", "61", "1", "44", "65", "91", "86", "81", "82", "33", "49", "39", "34", "7", "55", "52", "27", "66", "62", "63", "84", "60"];

function toCanonical(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (KNOWN_CC.some((cc) => d.startsWith(cc) && d.length > cc.length + 5)) return d;
  return `64${d}`;
}

function phoneCandidates(digits) {
  const d = String(digits || "").replace(/\D/g, "");
  const out = new Set([d, toCanonical(d)]);
  if (d.startsWith("0")) {
    out.add(d.slice(1));
    out.add(`64${d.slice(1)}`);
  } else if (d.length >= 8) {
    out.add(`0${d}`);
  }
  if (d.startsWith("64") && d.length > 2) {
    out.add(d.slice(2));
    out.add(`0${d.slice(2)}`);
  }
  return [...out].filter(Boolean);
}

function isPoisonKey(key) {
  const k = String(key || "").trim();
  return !k || k === "guest" || k.startsWith("web_");
}

function init() {
  if (getApps().length) return;
  const projectId = process.env.FIREBASE_PROJECT_ID || "bookawaka2026-564e1";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const databaseURL =
    process.env.FIREBASE_DATABASE_URL ||
    `https://${projectId}-default-rtdb.firebaseio.com`;
  if (!clientEmail || !privateKey) {
    throw new Error("FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY required");
  }
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    databaseURL,
  });
}

init();
const db = getDatabase();
const auth = getAuth();

const phoneIdx = (await db.ref("passengerIndex/phone").once("value")).val() || {};
const keys = Object.keys(phoneIdx);
const usersSnap = await db.ref("users").once("value");
const users = usersSnap.val() || {};

/** Build phone → Auth uid map from users/* (skips web_*). */
const phoneToUid = new Map();
for (const [uid, row] of Object.entries(users)) {
  if (isPoisonKey(uid) || !row || typeof row !== "object") continue;
  const phone = String(row.phone || row.Phone || row.PhoneNo || "").replace(/\D/g, "");
  if (!phone) continue;
  for (const c of phoneCandidates(phone)) {
    if (!phoneToUid.has(c)) phoneToUid.set(c, uid);
  }
}

let missing = 0;
let poisoned = 0;
let healed = 0;
let consolidated = 0;
let unresolved = 0;
const samples = [];
const seenCanonical = new Set();

for (const k of keys) {
  const row = phoneIdx[k] || {};
  const email = String(row.email || "").trim();
  const rowKey = String(row.uid || row.key || "").trim();
  const canonical = toCanonical(k);
  if (!canonical) continue;

  // Skip if we already processed this canonical group
  if (seenCanonical.has(canonical)) continue;
  seenCanonical.add(canonical);

  const variants = phoneCandidates(canonical);
  const groupRows = variants
    .filter((c) => phoneIdx[c])
    .map((c) => ({ key: c, row: phoneIdx[c] }));

  // Pick best uid + email from the group
  let uid = "";
  let resolved = "";
  for (const { row: r } of groupRows) {
    const rk = String(r.uid || r.key || "").trim();
    const re = String(r.email || "").trim();
    if (!uid && rk && !isPoisonKey(rk)) uid = rk;
    if (!resolved.includes("@") && re.includes("@")) resolved = re;
  }
  if (!uid) {
    for (const c of variants) {
      if (phoneToUid.has(c)) {
        uid = phoneToUid.get(c);
        break;
      }
    }
  }
  if (uid && !resolved.includes("@")) {
    const userSnap = users[uid];
    resolved = String(userSnap?.email || "").trim();
    if (!resolved.includes("@")) {
      try {
        const au = await auth.getUser(uid);
        resolved = String(au.email || "").trim();
      } catch {
        /* skip */
      }
    }
  }

  const needsHeal = groupRows.some((g) => {
    const e = String(g.row.email || "").trim();
    const rk = String(g.row.uid || g.row.key || "").trim();
    return !e.includes("@") || isPoisonKey(rk);
  });
  const hasVariants = groupRows.length > 1 || (groupRows.length === 1 && groupRows[0].key !== canonical);

  if (needsHeal) {
    if (groupRows.some((g) => !String(g.row.email || "").includes("@"))) missing++;
    if (groupRows.some((g) => isPoisonKey(String(g.row.uid || g.row.key || "")))) poisoned++;
  }

  if (!uid || isPoisonKey(uid) || !resolved.includes("@")) {
    if (needsHeal) {
      unresolved++;
      if (samples.length < 10) {
        samples.push({
          phoneKey: k,
          uid: rowKey.slice(0, 12),
          reason: !uid || isPoisonKey(uid) ? "no_auth_uid" : "no_email",
        });
      }
    }
    continue;
  }

  if (!needsHeal && !hasVariants) continue; // already clean + single canonical

  const payload = {
    key: uid,
    uid,
    email: resolved.toLowerCase(),
    updatedAt: Date.now(),
  };
  const updates = {};
  // Write the ONE canonical row
  updates[`passengerIndex/phone/${canonical}`] = payload;
  // Delete all legacy variants
  for (const c of variants) {
    if (c !== canonical && phoneIdx[c]) {
      updates[`passengerIndex/phone/${c}`] = null;
    }
  }
  updates[`passengerIndex/email/${resolved.toLowerCase().replace(/\./g, ",").replace(/@/g, "__at__")}`] = {
    key: uid,
    uid,
    email: resolved.toLowerCase(),
  };
  updates[`passengerIndex/key/${uid}`] = {
    key: uid,
    uid,
    email: resolved.toLowerCase(),
    updatedAt: new Date().toISOString(),
  };

  if (APPLY) {
    await db.ref().update(updates);
  }
  if (needsHeal) healed++;
  if (hasVariants) consolidated++;
  if (samples.length < 10) {
    samples.push({
      canonical,
      variantsRemoved: variants.filter((c) => c !== canonical && phoneIdx[c]),
      uid: uid.slice(0, 10),
      emailDomain: resolved.split("@")[1],
      healedPoison: needsHeal,
      apply: APPLY,
    });
  }
}

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "APPLY" : "DRY_RUN",
      totalPhoneKeys: keys.length,
      uniqueCanonical: seenCanonical.size,
      missingEmail: missing,
      poisonedWebKey: poisoned,
      healed,
      consolidated,
      unresolved,
      samples,
    },
    null,
    2,
  ),
);
