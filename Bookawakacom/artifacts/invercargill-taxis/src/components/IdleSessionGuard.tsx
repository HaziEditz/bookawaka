import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { clearPassengerSession, getPassengerSession } from "@/lib/passengerKey";
import { IDLE_TIMEOUT_MS, isIdleExpired, shouldHoldIdleForLiveTracking } from "@/lib/idleSession";

const LIVE_FLAG = "liveTripTracking";

export default function IdleSessionGuard() {
  const [location, setLocation] = useLocation();
  const lastActivityRef = useRef(Date.now());
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    lastActivityRef.current = Date.now();
  }, [location]);

  useEffect(() => {
    const bump = () => {
      lastActivityRef.current = Date.now();
    };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart", "scroll"];
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    const vis = () => {
      if (document.visibilityState === "visible") bump();
    };
    document.addEventListener("visibilitychange", vis);
    const tick = window.setInterval(() => {
      if (!getPassengerSession()) return;
      const liveTripVisible = document.documentElement.dataset[LIVE_FLAG] === "1";
      const hold = shouldHoldIdleForLiveTracking({
        pathname: locationRef.current,
        liveTripVisible,
      });
      if (isIdleExpired(lastActivityRef.current, Date.now(), hold)) {
        clearPassengerSession();
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        const next = encodeURIComponent(locationRef.current || "/");
        if (typeof setLocation === "function") {
          window.location.href = `${base}/sign-in?next=${next}&idle=1`;
        }
      }
    }, 15000);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, bump));
      document.removeEventListener("visibilitychange", vis);
      window.clearInterval(tick);
    };
  }, [setLocation]);

  return null;
}

export { IDLE_TIMEOUT_MS };
