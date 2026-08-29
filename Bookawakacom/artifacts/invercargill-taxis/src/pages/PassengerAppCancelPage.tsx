import { XCircle, Navigation, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

/** HTTPS cancel landing for native passenger-app Stripe Checkout. */
export default function PassengerAppCancelPage() {
  const params = new URLSearchParams(window.location.search);
  const bookingId = params.get("booking") ?? "";
  const cid = params.get("cid") ?? "";
  const deepLink = `passenger-app://stripe-return?booking=${encodeURIComponent(bookingId)}&cid=${encodeURIComponent(cid)}&kind=cancel`;

  if (typeof window !== "undefined" && bookingId) {
    try {
      window.location.href = deepLink;
    } catch {
      /* keep button */
    }
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
            <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto mb-6">
              <XCircle className="w-10 h-10 text-muted-foreground" />
            </div>
            <h1 className="text-3xl font-display font-black text-foreground mb-3">
              Payment cancelled
            </h1>
            <p className="text-muted-foreground font-medium mb-6 leading-relaxed">
              No charge was taken. Return to the passenger app to try again.
            </p>
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
