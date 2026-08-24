import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NzDateTimeInput } from "@/components/NzDateTimeInput";
import {
  Navigation,
  CalendarClock,
  MapPin,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  Car,
  Utensils,
  Package,
  AlertTriangle,
  Search,
  Phone,
  Mail,
  ArrowRight,
  CreditCard,
  Pencil,
  Save,
  X,
  Eraser,
  Wallet,
} from "lucide-react";

const DISMISSED_KEY = "bw_dismissed_rides";

function getDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveDismissedIds(ids: Set<string>) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(ids)));
}

interface Ride {
  BookingId: string;
  CompanyId: string;
  CompanyName: string;
  PassengerName: string;
  PickAddress: string;
  DropAddress: string;
  // ScheduledFor is NUMERIC in Firebase per SA dispatch contract: 0 = ASAP,
  // >0 = scheduled epoch ms. Older records may still carry an ISO string —
  // keep the type union so the page is forward+backward compatible.
  ScheduledFor: string | number;
  ScheduledForMs?: number;
  CreatedAt?: string; // ISO UTC
  createdAt?: number; // numeric epoch ms — sort key
  BookingType?: "ASAP" | "Prebook" | string;
  ServiceType: string;
  Status: string;
  Notes?: string;
  Info?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  Fare?: string;
  DriverId?: string;
}

const SERVICE_ICONS: Record<string, React.ReactNode> = {
  taxi: <Car className="w-4 h-4" />,
  food: <Utensils className="w-4 h-4" />,
  courier: <Package className="w-4 h-4" />,
};

const STATUS_STYLES: Record<string, string> = {
  Scheduled: "bg-primary/10 text-primary border-primary/20",
  Pending: "bg-amber-50 text-amber-700 border-amber-200",
  PendingPayment: "bg-orange-50 text-orange-700 border-orange-200",
  Cancelled: "bg-destructive/10 text-destructive border-destructive/20",
  Completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Assigned: "bg-sky-50 text-sky-700 border-sky-200",
  Accepted: "bg-sky-50 text-sky-700 border-sky-200",
  EnRoute: "bg-blue-50 text-blue-700 border-blue-200",
  Enroute: "bg-blue-50 text-blue-700 border-blue-200",
  OnTrip: "bg-blue-50 text-blue-700 border-blue-200",
  Arrived: "bg-indigo-50 text-indigo-700 border-indigo-200",
  NoShow: "bg-rose-50 text-rose-700 border-rose-200",
  Closed: "bg-muted text-muted-foreground border-border",
  Reassigned: "bg-violet-50 text-violet-700 border-violet-200",
  Declined: "bg-amber-50 text-amber-700 border-amber-200",
  Offered: "bg-amber-50 text-amber-700 border-amber-200",
};

/** Backend-driven status → display label (case-insensitive match).
 *  Canonical enum confirmed by SA Portal dev: Scheduled / Pending / PendingPayment /
 *  Assigned (alias: Accepted) / EnRoute / OnTrip (alias: Started) / Arrived /
 *  Declined / Reassigned / NoShow / Completed / Cancelled (both casings) / Closed.
 */
function statusLabel(status: string | undefined): { text: string; key: string } {
  const s = (status ?? "").toLowerCase();
  if (s === "scheduled") return { text: "Scheduled", key: "Scheduled" };
  if (s === "pending") return { text: "Looking for driver", key: "Pending" };
  // Dispatch has presented the job to a driver; awaiting their accept/decline.
  // Treated as an active state — passenger sees "Finding a driver".
  if (s === "offered" || s === "offer" || s === "offering") return { text: "Finding a driver", key: "Offered" };
  if (s === "pendingpayment" || s === "paymentpending") return { text: "Confirming payment", key: "PendingPayment" };
  if (s === "assigned" || s === "accepted") return { text: "Driver assigned", key: "Assigned" };
  if (s === "enroute" || s === "ontrip" || s === "started") return { text: "Driver on the way", key: "EnRoute" };
  if (s === "arrived") return { text: "Driver arrived", key: "Arrived" };
  // Driver declined the offer — dispatch will reassign; passenger sees "Finding another driver"
  if (s === "declined") return { text: "Finding another driver", key: "Declined" };
  if (s === "noshow" || s === "no_show") return { text: "No show", key: "NoShow" };
  if (s === "reassigned") return { text: "Reassigned", key: "Reassigned" };
  if (s === "cancelled" || s === "canceled") return { text: "Cancelled", key: "Cancelled" };
  if (s === "completed") return { text: "Completed", key: "Completed" };
  if (s === "closed") return { text: "Closed", key: "Closed" };
  return { text: status ?? "Unknown", key: status ?? "" };
}

function getStoredKey(): string | null {
  return localStorage.getItem("bw_passenger_key");
}

function saveKey(key: string) {
  localStorage.setItem("bw_passenger_key", key);
}

/** Convert a UTC ISO string to a datetime-local input value in NZ time */
function toNZDatetimeLocal(isoOrMs: string | number | undefined): string {
  // ASAP bookings have ScheduledFor=0 (per SA dispatch contract); guard
  // against that explicitly because `new Date(0)` would render as 1970.
  if (isoOrMs == null || isoOrMs === "" || isoOrMs === 0) return "";
  const d = new Date(isoOrMs);
  if (isNaN(d.getTime())) return "";
  // en-CA gives "YYYY-MM-DD, HH:MM:SS" format
  const nzStr = d.toLocaleString("en-CA", { timeZone: "Pacific/Auckland", hour12: false });
  return nzStr.replace(", ", "T").slice(0, 16);
}

/** Convert a datetime-local string (entered as NZ local time) back to UTC ISO */
function fromNZDatetimeLocal(localStr: string): string {
  if (!localStr) throw new Error("No scheduled time entered");
  // Get the current NZ→UTC offset by comparing clocks
  const utcNow = new Date();
  const nzNow = new Date(utcNow.toLocaleString("en-US", { timeZone: "Pacific/Auckland" }));
  const offsetMs = utcNow.getTime() - nzNow.getTime();
  const result = new Date(new Date(localStr + "Z").getTime() + offsetMs);
  if (isNaN(result.getTime())) throw new Error("Invalid scheduled time");
  return result.toISOString();
}

export default function MyRidesPage() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [passengerKey, setPassengerKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lookupValue, setLookupValue] = useState("");
  const [lookupType, setLookupType] = useState<"phone" | "email">("phone");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupDone, setLookupDone] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => getDismissedIds());
  const [walletBalance, setWalletBalance] = useState<number>(0);

  const fetchWallet = async (key: string) => {
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/wallet?key=${encodeURIComponent(key)}`,
        { cache: "no-store" }
      );
      const d = await res.json();
      if (res.ok) setWalletBalance(typeof d.balance === "number" ? d.balance : 0);
    } catch {
      // silent — wallet is non-critical UI
    }
  };

  const fetchRides = async (key: string, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/my-rides?key=${encodeURIComponent(key)}`,
        { cache: "no-store" }
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Could not load your rides.");
      const all: Ride[] = (d.rides ?? []) as Ride[];
      setRides(all.sort((a, b) => {
        // Sort by booking creation time (newest first). Sorting by
        // ScheduledFor breaks for ASAP bookings which carry ScheduledFor=0
        // per the SA dispatch contract — they would all collide at epoch 0.
        const ta = a.createdAt ?? (a.CreatedAt ? new Date(a.CreatedAt).getTime() : 0);
        const tb = b.createdAt ?? (b.CreatedAt ? new Date(b.CreatedAt).getTime() : 0);
        return tb - ta;
      }));
      setPassengerKey(key);
      setLoaded(true);
      fetchWallet(key);
    } catch (err: any) {
      if (!silent) setError(err.message ?? "Could not load your rides. Please try again.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    const stored = getStoredKey();
    if (stored) {
      fetchRides(stored);
    }
  }, []);

  // Backend-driven refresh: poll while any ride is in a live state so the user
  // sees driver assignment / EnRoute / dispatcher-cancellation / address updates
  // pushed from backend. Faster cadence while payment is confirming.
  useEffect(() => {
    const key = passengerKey;
    if (!key) return;
    const livePaymentStatuses = new Set(["pendingpayment", "paymentpending"]);
    const liveActiveStatuses = new Set([
      "scheduled", "pending", "assigned", "accepted",
      "enroute", "ontrip", "started", "arrived", "reassigned", "declined",
    ]);
    const hasPendingPayment = rides.some((r) => livePaymentStatuses.has((r.Status ?? "").toLowerCase()));
    const hasLiveActive = rides.some((r) => liveActiveStatuses.has((r.Status ?? "").toLowerCase()));
    if (!hasPendingPayment && !hasLiveActive) return;
    const intervalMs = hasPendingPayment ? 4000 : 10000;
    const interval = setInterval(() => fetchRides(key, true), intervalMs);
    return () => clearInterval(interval);
  }, [rides, passengerKey]);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupLoading(true);
    setLookupError(null);
    try {
      const param = lookupType === "email"
        ? `email=${encodeURIComponent(lookupValue.trim())}`
        : `phone=${encodeURIComponent(lookupValue.trim())}`;
      const res = await fetch(`${import.meta.env.BASE_URL}api/my-rides?${param}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Lookup failed.");

      const foundKey: string | null = d.passengerKey ?? null;
      setLookupDone(true);

      if (foundKey) {
        saveKey(foundKey);
        fetchRides(foundKey);
      } else {
        setRides([]);
        setLoaded(true);
      }
    } catch (err: any) {
      setLookupError(err.message ?? "Something went wrong. Please try again.");
    } finally {
      setLookupLoading(false);
    }
  };

  const handleCancelled = (bookingId: string) => {
    // Move the ride into the Cancelled section instead of removing it
    setRides((prev) =>
      prev.map((r) =>
        r.BookingId === bookingId ? { ...r, Status: "Cancelled" } : r
      )
    );
  };

  const handleUpdate = (bookingId: string, updates: Partial<Ride>) => {
    setRides((prev) =>
      prev.map((r) => (r.BookingId === bookingId ? { ...r, ...updates } : r))
    );
  };

  const clearSection = (ids: string[]) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      saveDismissedIds(next);
      return next;
    });
  };

  const visibleRides = rides.filter((r) => !dismissed.has(r.BookingId));
  const upcomingStatusesLower = new Set([
    "scheduled", "pending",
    "pendingpayment", "paymentpending",
    "offered", "offer", "offering",
    "assigned", "accepted",
    "enroute", "ontrip", "started",
    "arrived", "reassigned", "declined",
  ]);
  const cancelledStatusesLower = new Set(["cancelled", "canceled"]);
  // NoShow is terminal like Completed (driver waited, passenger didn't show).
  // Group with history so the payment-aware no-show notice is reachable.
  const completedStatusesLower = new Set(["completed", "closed", "noshow", "no_show"]);
  const upcomingRides = visibleRides.filter((r) => upcomingStatusesLower.has((r.Status ?? "").toLowerCase()));
  const completedRides = visibleRides.filter((r) => completedStatusesLower.has((r.Status ?? "").toLowerCase()));
  const cancelledRides = visibleRides.filter(
    (r) => cancelledStatusesLower.has((r.Status ?? "").toLowerCase())
      || cancelledStatusesLower.has(((r as any).status ?? "").toLowerCase())
  );
  const hasLocalKey = !!getStoredKey();

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/30 flex flex-col">
      <header className="bg-foreground text-white px-6 py-4 flex items-center justify-between shadow-xl">
        <a href="/" className="flex items-center gap-2 group">
          <div className="bg-primary text-primary-foreground p-2 rounded-xl rotate-3 group-hover:rotate-0 transition-transform">
            <Navigation className="w-5 h-5" />
          </div>
          <span className="font-display font-extrabold text-xl tracking-tight">BookaWaka</span>
        </a>
        <a href="/book">
          <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-full font-bold">
            <Car className="w-4 h-4 mr-1.5" /> Book a Ride
          </Button>
        </a>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 py-12">
        <div className="w-full max-w-2xl">

          <div className="flex items-center gap-4 mb-8">
            <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
              <CalendarClock className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-display font-black">My Rides</h1>
              <p className="text-muted-foreground text-sm font-medium">View and manage your bookings.</p>
            </div>
          </div>

          {walletBalance > 0 && (
            <div className="mb-6 bg-gradient-to-r from-emerald-50 to-emerald-100/50 border border-emerald-200 rounded-2xl p-5 flex items-start gap-4 shadow-sm">
              <div className="w-12 h-12 bg-emerald-500/15 rounded-xl flex items-center justify-center text-emerald-700 shrink-0">
                <Wallet className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold uppercase tracking-widest text-emerald-700/80">BookaWaka wallet</div>
                <div className="text-2xl font-extrabold text-emerald-800">${walletBalance.toFixed(2)} NZD</div>
                <div className="text-xs text-emerald-700/80 mt-0.5">Credit from cancelled bookings — usable on your next trip.</div>
                <div className="text-xs text-emerald-700/70 mt-1.5">
                  Prefer a card refund? Email <a href="mailto:info@bookawaka.com?subject=Refund%20to%20card%20request" className="font-bold underline hover:text-emerald-900">info@bookawaka.com</a> with your booking ID.
                </div>
              </div>
            </div>
          )}

          {/* Cross-device lookup */}
          {!hasLocalKey && !loaded && (
            <div className="bg-card border border-border rounded-[1.5rem] p-6 shadow-xl mb-8">
              <h2 className="font-bold text-base mb-1">Find your bookings</h2>
              <p className="text-sm text-muted-foreground mb-5">
                Enter the phone number or email you used when booking — your rides will appear on any device.
              </p>
              <form onSubmit={handleLookup} className="space-y-4">
                <div className="flex gap-2 mb-1">
                  <button
                    type="button"
                    onClick={() => setLookupType("phone")}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold border transition-colors ${lookupType === "phone" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary"}`}
                  >
                    <Phone className="w-3.5 h-3.5" /> Phone
                  </button>
                  <button
                    type="button"
                    onClick={() => setLookupType("email")}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold border transition-colors ${lookupType === "email" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary"}`}
                  >
                    <Mail className="w-3.5 h-3.5" /> Email
                  </button>
                </div>
                <div className="flex gap-3">
                  <Input
                    value={lookupValue}
                    onChange={(e) => setLookupValue(e.target.value)}
                    placeholder={lookupType === "phone" ? "e.g. 021 123 4567" : "you@example.com"}
                    type={lookupType === "email" ? "email" : "tel"}
                    required
                    className="rounded-xl h-12 flex-1"
                  />
                  <Button
                    type="submit"
                    disabled={lookupLoading || !lookupValue.trim()}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl h-12 px-5 font-bold"
                  >
                    {lookupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </Button>
                </div>
                {lookupError && (
                  <p className="text-sm text-destructive font-medium flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {lookupError}
                  </p>
                )}
              </form>
            </div>
          )}

          {/* Already has a key */}
          {hasLocalKey && loaded && !loading && (
            <div className="mb-6 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Showing bookings from this device.</p>
              <button
                className="text-sm text-primary font-bold hover:underline"
                onClick={() => {
                  localStorage.removeItem("bw_passenger_key");
                  setLoaded(false);
                  setRides([]);
                  setPassengerKey(null);
                  setLookupDone(false);
                  setLookupValue("");
                }}
              >
                Look up a different account
              </button>
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-3 text-muted-foreground py-16 justify-center">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="font-medium">Loading your rides…</span>
            </div>
          )}

          {error && !loading && (
            <div className="p-5 bg-destructive/10 border border-destructive/20 rounded-2xl text-destructive font-medium flex items-center gap-3 mb-6">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              {error}
            </div>
          )}

          {loaded && !loading && visibleRides.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <CalendarClock className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="font-bold text-foreground mb-1">No bookings to show</p>
              <p className="text-sm mb-6">
                {lookupDone
                  ? "We couldn't find any bookings linked to that contact. Check you used the same details when booking."
                  : "No bookings have been made from this browser yet."}
              </p>
            </div>
          )}

          {loaded && !loading && visibleRides.length > 0 && (
            <div className="space-y-8">
              {upcomingRides.length > 0 && (
                <div>
                  <h2 className="text-sm font-extrabold uppercase tracking-widest text-primary mb-4 flex items-center gap-2">
                    <CalendarClock className="w-4 h-4" /> Upcoming
                  </h2>
                  <div className="space-y-3">
                    {upcomingRides.map((ride) => (
                      <RideCard
                        key={ride.BookingId}
                        ride={ride}
                        passengerKey={passengerKey}
                        onCancelled={handleCancelled}
                        onUpdate={handleUpdate}
                      />
                    ))}
                  </div>
                </div>
              )}

              {completedRides.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-extrabold uppercase tracking-widest text-emerald-700 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" /> Completed
                    </h2>
                    <button
                      type="button"
                      onClick={() => clearSection(completedRides.map((r) => r.BookingId))}
                      className="text-xs font-bold text-muted-foreground hover:text-foreground flex items-center gap-1.5"
                    >
                      <Eraser className="w-3.5 h-3.5" /> Clear
                    </button>
                  </div>
                  <div className="space-y-3">
                    {completedRides.map((ride) => (
                      <RideCard
                        key={ride.BookingId}
                        ride={ride}
                        passengerKey={passengerKey}
                        onCancelled={handleCancelled}
                        onUpdate={handleUpdate}
                      />
                    ))}
                  </div>
                </div>
              )}

              {cancelledRides.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-extrabold uppercase tracking-widest text-destructive flex items-center gap-2">
                      <XCircle className="w-4 h-4" /> Cancelled
                    </h2>
                    <button
                      type="button"
                      onClick={() => clearSection(cancelledRides.map((r) => r.BookingId))}
                      className="text-xs font-bold text-muted-foreground hover:text-foreground flex items-center gap-1.5"
                    >
                      <Eraser className="w-3.5 h-3.5" /> Clear
                    </button>
                  </div>
                  <div className="space-y-3">
                    {cancelledRides.map((ride) => (
                      <RideCard
                        key={ride.BookingId}
                        ride={ride}
                        passengerKey={passengerKey}
                        onCancelled={handleCancelled}
                        onUpdate={handleUpdate}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* New booking shortcuts */}
          {!loading && (
            <div className="mt-10 bg-card border border-border rounded-[1.5rem] p-6 shadow-sm">
              <h2 className="font-extrabold text-base mb-1">Book something new</h2>
              <p className="text-sm text-muted-foreground mb-5">Start a fresh booking — choose a service below.</p>
              <div className="grid grid-cols-3 gap-3">
                <a href="/book?service=taxi" className="flex flex-col items-center gap-2 bg-primary/5 hover:bg-primary/10 border border-primary/20 hover:border-primary/40 rounded-2xl p-4 transition-colors group">
                  <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary group-hover:bg-primary/20 transition-colors">
                    <Car className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-bold text-center leading-tight">Taxi / Ride</span>
                </a>
                <a href="/book?service=food" className="flex flex-col items-center gap-2 bg-primary/5 hover:bg-primary/10 border border-primary/20 hover:border-primary/40 rounded-2xl p-4 transition-colors group">
                  <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary group-hover:bg-primary/20 transition-colors">
                    <Utensils className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-bold text-center leading-tight">Food Delivery</span>
                </a>
                <a href="/book?service=courier" className="flex flex-col items-center gap-2 bg-primary/5 hover:bg-primary/10 border border-primary/20 hover:border-primary/40 rounded-2xl p-4 transition-colors group">
                  <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary group-hover:bg-primary/20 transition-colors">
                    <Package className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-bold text-center leading-tight">Courier / Parcel</span>
                </a>
              </div>
            </div>
          )}

        </div>
      </main>

      <footer className="bg-foreground text-white/60 text-sm text-center py-6 px-6">
        <p>&copy; {new Date().getFullYear()} BookaWaka. All rights reserved. &mdash; <a href="/" className="hover:text-white transition-colors">Back to home</a></p>
      </footer>
    </div>
  );
}

function RideCard({
  ride,
  passengerKey,
  onCancelled,
  onUpdate,
}: {
  ride: Ride;
  passengerKey: string | null;
  onCancelled: (bookingId: string) => void;
  onUpdate: (bookingId: string, updates: Partial<Ride>) => void;
}) {
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelResult, setCancelResult] = useState<{ walletCredited: boolean; walletCreditAmount: number | null; driverAssigned: boolean } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedChanges, setLastSavedChanges] = useState<string[] | null>(null);

  // Time display rules:
  // - ASAP bookings store ScheduledFor=0 (SA dispatch contract). Showing
  //   `new Date(0)` would render "Thu 1 Jan 1970" — the bug Safinah hit.
  //   Surface "ASAP" + the creation time instead.
  // - Scheduled bookings render their pickup time as before.
  const rawScheduledMs =
    typeof ride.ScheduledForMs === "number"
      ? ride.ScheduledForMs
      : typeof ride.ScheduledFor === "number"
        ? ride.ScheduledFor
        : ride.ScheduledFor
          ? new Date(ride.ScheduledFor).getTime()
          : 0;
  const isAsap =
    !rawScheduledMs ||
    isNaN(rawScheduledMs) ||
    ride.BookingType === "ASAP";
  const createdAtMs =
    ride.createdAt ?? (ride.CreatedAt ? new Date(ride.CreatedAt).getTime() : 0);
  const formatNz = (ms: number) =>
    ms > 0 && !isNaN(ms)
      ? new Date(ms).toLocaleString("en-NZ", {
          timeZone: "Pacific/Auckland",
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
  const scheduledLabel = isAsap
    ? createdAtMs > 0
      ? `ASAP · booked ${formatNz(createdAtMs)}`
      : "ASAP"
    : formatNz(rawScheduledMs) || "—";

  const [editForm, setEditForm] = useState({
    scheduledFor: toNZDatetimeLocal(ride.ScheduledFor),
    notes: ride.Info ?? ride.Notes ?? "",
    pickAddress: ride.PickAddress,
    dropAddress: ride.DropAddress,
  });

  const statusLower = (ride.Status ?? "").toLowerCase();
  const isPendingPayment = statusLower === "pendingpayment" || statusLower === "paymentpending";
  const isScheduled = statusLower === "scheduled";
  const isPending = statusLower === "pending";
  // Driver-on-the-way states: backend is authoritative on whether cancel is allowed
  // (returns 409 if not). We still surface the button so user can try — backend rejects.
  const isDriverActive = ["assigned", "accepted", "enroute", "ontrip", "started", "arrived"].includes(statusLower);
  // "Offered" = dispatch surfaced the job to a driver but no one has accepted yet.
  // Passenger may still cancel; backend allowlist mirrors this.
  const isOffered = ["offered", "offer", "offering"].includes(statusLower);
  const isCancellable = isScheduled || isPending || isPendingPayment || isOffered || isDriverActive;
  // Edits to address/time are blocked once a driver is involved — backend is source of truth.
  const isEditable = isScheduled || isPending;
  const isCardPaid = ride.paymentMethod === "card" && ride.paymentStatus === "paid";
  // No-show is emitted by the driver app / dispatch; backend never sets it from
  // passenger-initiated paths. We surface a payment-aware notice so passengers
  // know whether they were charged. Aligns with mobile app messaging policy.
  const isNoShow = statusLower === "noshow" || statusLower === "no_show";
  const label = statusLabel(ride.Status);
  const statusStyle = STATUS_STYLES[label.key] ?? STATUS_STYLES[ride.Status] ?? "bg-muted text-muted-foreground border-border";

  const handleSave = async () => {
    if (!passengerKey) {
      setSaveError("Session expired — please refresh the page and try again.");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/my-rides/${ride.BookingId}/update`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: passengerKey,
            companyId: ride.CompanyId,
            // Only send scheduledFor for Scheduled rides
            ...(isScheduled ? { scheduledFor: fromNZDatetimeLocal(editForm.scheduledFor) } : {}),
            notes: editForm.notes,
            pickAddress: editForm.pickAddress || undefined,
            dropAddress: editForm.dropAddress || undefined,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not save changes");
      const apiChanges: string[] = Array.isArray(data.changes) ? data.changes : [];
      onUpdate(ride.BookingId, {
        ...(isScheduled ? {
          ScheduledFor: fromNZDatetimeLocal(editForm.scheduledFor),
          ScheduledForMs: new Date(fromNZDatetimeLocal(editForm.scheduledFor)).getTime(),
        } : {}),
        Info: editForm.notes,
        Notes: editForm.notes,
        PickAddress: editForm.pickAddress || ride.PickAddress,
        DropAddress: editForm.dropAddress || ride.DropAddress,
        ...(data.booking?.BookingDateTime ? { BookingDateTime: data.booking.BookingDateTime } : {}),
        ...(data.booking?.Pickingtime ? { Pickingtime: data.booking.Pickingtime } : {}),
      });
      setLastSavedChanges(
        apiChanges.length
          ? apiChanges
          : [
              ...(editForm.pickAddress ? [`Pickup → ${editForm.pickAddress}`] : []),
              ...(editForm.dropAddress ? [`Drop-off → ${editForm.dropAddress}`] : []),
              ...(editForm.notes?.trim() ? [`Notes → ${editForm.notes.trim()}`] : []),
            ],
      );
      setIsEditing(false);
    } catch (err: any) {
      setSaveError(err.message ?? "Could not save. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelConfirmed = async () => {
    if (!passengerKey) return;
    setIsCancelling(true);
    setCancelError(null);
    setConfirmCancel(false);
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/my-rides/${ride.BookingId}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: passengerKey, companyId: ride.CompanyId }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not cancel");
      setCancelResult({ walletCredited: data.walletCredited, walletCreditAmount: data.walletCreditAmount, driverAssigned: data.driverAssigned });
      // Move the ride into the Cancelled section so the user sees it land there
      onCancelled(ride.BookingId);
    } catch (err: any) {
      setCancelError(err.message ?? "Could not cancel. Please try again.");
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center text-primary">
            {SERVICE_ICONS[ride.ServiceType] ?? <Car className="w-4 h-4" />}
          </div>
          <div>
            <div className="font-bold text-sm text-foreground capitalize">{ride.ServiceType}</div>
            <div className="text-xs text-muted-foreground">{ride.CompanyName}</div>
          </div>
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${statusStyle}`}>
          {label.key === "Scheduled" ? (
            <span className="flex items-center gap-1"><CalendarClock className="w-3 h-3" /> {label.text}</span>
          ) : label.key === "Cancelled" ? (
            <span className="flex items-center gap-1"><XCircle className="w-3 h-3" /> {label.text}</span>
          ) : label.key === "Completed" || label.key === "Closed" ? (
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> {label.text}</span>
          ) : label.key === "PendingPayment" ? (
            <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" /> {label.text}</span>
          ) : label.key === "Assigned" || label.key === "EnRoute" || label.key === "Arrived" || label.key === "Reassigned" ? (
            <span className="flex items-center gap-1"><Car className="w-3 h-3" /> {label.text}</span>
          ) : label.text}
        </span>
      </div>

      {/* View mode */}
      {!isEditing && (
        <div className="space-y-1.5 text-sm mb-4">
          <div className="flex items-start gap-2 text-muted-foreground">
            <Clock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-primary" />
            <span className="font-medium text-foreground">{scheduledLabel}</span>
          </div>
          <div className="flex items-start gap-2 text-muted-foreground">
            <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-emerald-600" />
            <span>{ride.PickAddress}</span>
          </div>
          <div className="flex items-start gap-2 text-muted-foreground">
            <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-destructive" />
            <span>{ride.DropAddress}</span>
          </div>
          {(ride.Info || ride.Notes) && (
            <div className="text-xs text-muted-foreground italic mt-1">{ride.Info || ride.Notes}</div>
          )}
          {lastSavedChanges && lastSavedChanges.length > 0 && (
            <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              <p className="font-bold mb-1">Saved changes</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {lastSavedChanges.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Edit mode */}
      {isEditing && (
        <div className="space-y-3 mb-4 bg-muted/40 rounded-xl p-4 border border-border">
          {/* Scheduled time — only for Scheduled rides, not Pending */}
          {isScheduled && (
            <div>
              <Label className="text-xs font-bold text-muted-foreground mb-1 block">Scheduled time (NZ)</Label>
              <NzDateTimeInput
                value={editForm.scheduledFor}
                onChange={(val) => setEditForm((f) => ({ ...f, scheduledFor: val }))}
                inputClassName="h-10 rounded-lg"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Tap Done to confirm the time.</p>
            </div>
          )}
          <div>
            <Label className="text-xs font-bold text-muted-foreground mb-1 block">Pickup address</Label>
            <Input
              value={editForm.pickAddress}
              onChange={(e) => setEditForm((f) => ({ ...f, pickAddress: e.target.value }))}
              className="rounded-lg h-10"
              placeholder="Pickup address"
            />
          </div>
          <div>
            <Label className="text-xs font-bold text-muted-foreground mb-1 block">Drop-off address</Label>
            <Input
              value={editForm.dropAddress}
              onChange={(e) => setEditForm((f) => ({ ...f, dropAddress: e.target.value }))}
              className="rounded-lg h-10"
              placeholder="Drop-off address"
            />
          </div>
          <div>
            <Label className="text-xs font-bold text-muted-foreground mb-1 block">Notes (optional)</Label>
            <Input
              value={editForm.notes}
              onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
              className="rounded-lg h-10"
              placeholder="Any special instructions…"
            />
          </div>
          {saveError && (
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {saveError}
            </p>
          )}
        </div>
      )}

      {isPendingPayment && (
        <div className="flex items-start gap-2 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 mb-3">
          <CreditCard className="w-3.5 h-3.5 mt-0.5 shrink-0 animate-pulse" />
          <span>Payment is being confirmed — your booking will be dispatched shortly. This will update automatically.</span>
        </div>
      )}

      {/* Payment-aware no-show notice. Mirrors the mobile app's policy:
          cash = no charge, card = fare charged to your card. */}
      {isNoShow && (
        <div className={`flex items-start gap-2 text-xs rounded-xl px-3 py-2 mb-3 ${isCardPaid ? "bg-rose-50 border border-rose-200 text-rose-700" : "bg-muted border border-border text-muted-foreground"}`}>
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {isCardPaid ? (
            <span>
              No show — the driver waited at pickup but you didn't appear, so the fare was charged to your card.
              {" "}If you think this is wrong, email{" "}
              <a href={`mailto:info@bookawaka.com?subject=No-show%20dispute%20-%20${encodeURIComponent(ride.BookingId)}`} className="font-bold underline hover:text-rose-900">info@bookawaka.com</a>
              {" "}with booking ID <span className="font-mono">{ride.BookingId}</span>.
            </span>
          ) : (
            <span>No show — the driver waited at pickup but you didn't appear. No charge was made for this booking.</span>
          )}
        </div>
      )}

      {/* Inline cancel confirmation */}
      {confirmCancel && (
        <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4 mb-3 space-y-3">
          <p className="text-sm font-bold text-destructive">Cancel this booking?</p>
          {isCardPaid ? (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {isDriverActive
                ? <>The driver is already on the way. Cancelling now will <strong>not</strong> add wallet credit and the fare stays charged to your card.</>
                : ride.DriverId
                  ? "A driver has been assigned but isn't on the way yet. Cancelling now will not add wallet credit."
                  : <>No driver assigned yet — the fare will be added to your <strong>BookaWaka wallet</strong> as credit (linked to your phone). Use it on your next booking. <strong>No card refund.</strong></>}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {isDriverActive
                ? "The driver is already on the way. You can still cancel, but please let the driver know if possible. No charge — cash bookings are always free to cancel."
                : ride.DriverId
                  ? "A driver has been assigned but isn't on the way yet. No charge — cash bookings are always free to cancel."
                  : "This booking will be removed from the dispatch queue. No charge — cash bookings are always free to cancel."}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleCancelConfirmed}
              disabled={isCancelling}
              className="rounded-full bg-destructive text-white hover:bg-destructive/90 font-bold"
            >
              {isCancelling ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Cancelling…</> : "Yes, cancel"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmCancel(false)}
              disabled={isCancelling}
              className="rounded-full font-bold"
            >
              Keep booking
            </Button>
          </div>
        </div>
      )}

      {/* Cancel / wallet-credit result */}
      {cancelResult && (
        <div className={`flex items-start gap-2 text-xs rounded-xl px-3 py-2 mb-3 ${cancelResult.walletCredited ? "bg-emerald-50 border border-emerald-200 text-emerald-700" : "bg-muted border border-border text-muted-foreground"}`}>
          <Wallet className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {cancelResult.walletCredited
            ? <span>
                Booking cancelled. <strong>${cancelResult.walletCreditAmount?.toFixed(2)} NZD added to your wallet</strong> — use it on your next booking.
                {" "}Need this refunded to your card instead? Email{" "}
                <a href={`mailto:info@bookawaka.com?subject=Refund%20to%20card%20request%20-%20${encodeURIComponent(ride.BookingId)}`} className="font-bold underline hover:text-emerald-900">info@bookawaka.com</a>
                {" "}with booking ID <span className="font-mono">{ride.BookingId}</span>.
              </span>
            : cancelResult.driverAssigned
              ? <span>Booking cancelled. No wallet credit — a driver had already been assigned.</span>
              : <span>Booking cancelled.</span>}
        </div>
      )}

      {cancelError && (
        <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-3 py-2 mb-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{cancelError}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground font-mono">#{ride.BookingId}</span>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {!isEditing && ride.Status === "Completed" && (
            <a
              href={`/book?cid=${encodeURIComponent(ride.CompanyId)}&service=${encodeURIComponent(ride.ServiceType)}&pickup=${encodeURIComponent(ride.PickAddress)}&drop=${encodeURIComponent(ride.DropAddress)}`}
            >
              <Button variant="outline" size="sm" className="rounded-full font-bold text-primary border-primary/30 hover:bg-primary/10 hover:border-primary">
                <ArrowRight className="w-3.5 h-3.5 mr-1.5" /> Book again
              </Button>
            </a>
          )}

          {/* Edit / Save / Discard — Scheduled and Pending rides */}
          {isEditable && !isEditing && !confirmCancel && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setIsEditing(true); setSaveError(null); }}
              className="rounded-full font-bold text-foreground border-border hover:bg-muted"
            >
              <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
            </Button>
          )}

          {isEditing && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setIsEditing(false); setSaveError(null); }}
                disabled={isSaving}
                className="rounded-full font-bold text-muted-foreground border-border hover:bg-muted"
              >
                <X className="w-3.5 h-3.5 mr-1.5" /> Discard
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-full font-bold bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isSaving ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving…</>
                ) : (
                  <><Save className="w-3.5 h-3.5 mr-1.5" /> Save changes</>
                )}
              </Button>
            </>
          )}

          {isCancellable && !isEditing && !confirmCancel && !cancelResult && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmCancel(true)}
              disabled={isCancelling}
              className="rounded-full text-destructive border-destructive/30 hover:bg-destructive/10 hover:border-destructive font-bold"
            >
              <XCircle className="w-3.5 h-3.5 mr-1.5" /> Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
