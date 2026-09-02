/**
 * Heal passengerIndex/phone rows missing email.
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

function phoneCandidates(digits) {
  const d = String(digits || "").replace(/\D/g, "");
  const out = new Set([d]);
  if (d.startsWith("0")) out.add(d.slice(1));
  else if (d.length >= 8) out.add(`0${d}`);
  if (d.startsWith("64") && d.length > 2) out.add(d.slice(2));
  else if (d.length >= 8 && !d.startsWith("64")) out.add(`64${d}`);
  return [...out].filter(Boolean);
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
let missing = 0;
let healed = 0;
let unresolved = 0;
const samples = [];

for (const k of keys) {
  const row = phoneIdx[k] || {};
  const email = String(row.email || "").trim();
  if (email.includes("@")) continue;
  missing++;
  const uid = String(row.uid || row.key || "").trim();
  let resolved = "";
  if (uid) {
    const userSnap = await db.ref(`users/${uid}`).once("value");
    resolved = String(userSnap.val()?.email || "").trim();
    if (!resolved.includes("@")) {
      try {
        const au = await auth.getUser(uid);
        resolved = String(au.email || "").trim();
      } catch {
        /* skip */
      }
    }
  }
  if (!resolved.includes("@")) {
    unresolved++;
    if (samples.length < 8) {
      samples.push({ phoneKey: k, uid: uid.slice(0, 10), reason: "no_email" });
    }
    continue;
  }

  const payload = {
    key: uid,
    uid,
    email: resolved.toLowerCase(),
    updatedAt: Date.now(),
  };
  const updates = {};
  for (const c of phoneCandidates(k)) {
    updates[`passengerIndex/phone/${c}`] = payload;
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
  healed++;
  if (samples.length < 8) {
    samples.push({
      phoneKeyPrefix: k.slice(0, 3),
      uid: uid.slice(0, 10),
      emailDomain: resolved.split("@")[1],
      apply: APPLY,
    });
  }
}

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "APPLY" : "DRY_RUN",
      totalPhoneKeys: keys.length,
      missingEmail: missing,
      healed,
      unresolved,
      samples,
    },
    null,
    2,
  ),
);
