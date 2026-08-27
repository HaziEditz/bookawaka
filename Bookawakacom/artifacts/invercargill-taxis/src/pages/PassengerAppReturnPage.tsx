import { CheckCircle2, Navigation, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * HTTPS landing for native passenger-app Stripe Checkout.
 *
 * AuthSession / Custom Tabs complete on this HTTPS URL — that is the real
 * handoff back into the app. Do NOT auto-navigate to passenger-app:// here:
 * Chrome still briefly shows "Page can't be found" / site-unreachable when a
 * Custom Tab tries to load an unknown custom scheme. Keep a manual button only.
 */
export default function PassengerAppReturnPage() {
  const params = new URLSearchParams(window.location.search);
  const bookingId = params.get("booking") ?? "";
  const cid = params.get("cid") ?? "";
  const sessionId = params.get("session_id") ?? "";

  const deepLink = `passenger-app://stripe-return?booking=${encodeURIComponent(bookingId)}&cid=${encodeURIComponent(cid)}&session_id=${encodeURIComponent(sessionId)}`;

  // AuthSession / Custom Tabs complete when this HTTPS URL loads — try close as a
  // best-effort nudge on browsers that leave the tab open after the redirect match.
  if (typeof window !== "undefined") {
    window.setTimeout(() => {
      try {
        window.close();
      } catch {
        /* ignore */
      }
    }, 400);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/30 flex flex-col">
      <header className="bg-foreground text-white px-6 py-4 flex items-center gap-3 shadow-xl">
        <div className="flex items-center gap-2">
          <div className="bg-primary text-primary-foreground p-2 rounded-xl">
            <Navigation className="w-5 h-5" />
          </div>
          <span className="font-display font-extrabold text-xl tracking-tight">BookaWaka</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="bg-card border border-border rounded-[2rem] p-8 md:p-10 shadow-xl">
            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-primary" />
            </div>
            <h1 className="text-3xl font-display font-black text-foreground mb-3">
              Payment confirmed
            </h1>
            <p className="text-muted-foreground font-medium mb-6 leading-relaxed">
              You can close this window — returning you to the BookaWaka passenger app.
              If the app does not open automatically, tap the button below.
            </p>
            {bookingId && (
              <div className="bg-muted/60 border border-border rounded-xl px-5 py-3 mb-6 text-sm text-muted-foreground">
                Booking ID:{" "}
                <span className="font-mono font-bold text-foreground">{bookingId}</span>
              </div>
            )}
            <a href={deepLink}>
              <Button size="lg" className="rounded-full font-bold px-8">
                <ExternalLink className="w-5 h-5 mr-2" /> Open passenger app
              </Button>
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
