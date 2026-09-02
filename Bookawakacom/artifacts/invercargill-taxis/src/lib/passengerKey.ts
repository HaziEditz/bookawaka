/** Authenticated passenger session — Firebase Auth uid (no guest web_* keys). */

export type PassengerSession = {
  uid: string;
  email: string;
  name: string;
  phone: string;
  idToken: string;
  refreshToken?: string;
};

const KEY = "bw_passenger_key";
const SESSION_KEY = "bw_passenger_session";

export function getPassengerKey(): string | null {
  try {
    const session = getPassengerSession();
    if (session?.uid) return session.uid;
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** @deprecated Guest keys are no longer created — redirects must use Sign In. */
export function getOrCreatePassengerKey(): string {
  const existing = getPassengerKey();
  if (existing && !existing.startsWith("web_")) return existing;
  throw new Error("Sign in required");
}

export function getPassengerSession(): PassengerSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PassengerSession;
    if (!parsed?.uid || !parsed?.idToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setPassengerSession(session: PassengerSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  localStorage.setItem(KEY, session.uid);
}

export function clearPassengerSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(KEY);
  } catch {
    // non-fatal
  }
}

export function requirePassengerSession(): PassengerSession {
  const s = getPassengerSession();
  if (!s) throw new Error("Sign in required");
  return s;
}
