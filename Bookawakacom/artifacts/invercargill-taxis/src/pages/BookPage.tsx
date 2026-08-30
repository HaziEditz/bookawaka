import { useState, useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import AddressInput from "@/components/AddressInput";
import BookingMapPanel from "@/components/BookingMapPanel";
import { NzDateTimeInput } from "@/components/NzDateTimeInput";
import { getOrCreatePassengerKey } from "@/lib/passengerKey";
import { fromNZDatetimeLocal, toNZDatetimeLocal } from "@/lib/nzDatetimeLocal";
import {
  Car,
  Utensils,
  Package,
  MapPin,
  Navigation,
  ChevronRight,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  CreditCard,
  DollarSign,
  CalendarClock,
  Zap,
  Globe,
  AlertTriangle,
  Store,
  Wallet,
  Shield,
  Ticket,
  Gift,
  XCircle,
  Pencil,
} from "lucide-react";

// Vite breaks Leaflet's default marker image paths — patch before map mounts.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

interface Company {
  id: string;
  name: string;
  services: string[];
  description?: string;
  city?: string;
  country?: string;
  email?: string;
  /** Free-text hours from companySettings when configured (often empty today). */
  operatingHours?: string;
  /** ASAP gate: company dispatch console online (activeDispatchers). */
  dispatchOnline?: boolean;
  /** ASAP allowed when dispatch online + within operating hours. */
  asapBookable?: boolean;
  asapBlockReason?: string;
}

/**
 * Vehicle picker for taxi bookings.
 * "Any" = no hard VehicleType on the booking (open eligibility) — default for 1–4 pax
 * when the passenger has not explicitly chosen a type. Explicit picks are honored.
 */
const VEHICLE_TYPES = ["Any", "Sedan", "SUV", "Van", "Luxury", "Electric", "Wheelchair"] as const;
type VehicleTypeOption = (typeof VEHICLE_TYPES)[number];
const VEHICLE_LABELS: Record<VehicleTypeOption, string> = {
  Any: "Any",
  Sedan: "Sedan",
  SUV: "SUV",
  Van: "Van",
  Luxury: "Luxury",
  Electric: "Electric",
  Wheelchair: "Accessible / WAV",
};

function normalizeServices(services: unknown): string[] {
  if (Array.isArray(services)) {
    return services.map((s) => String(s).trim()).filter(Boolean);
  }
  if (typeof services === "string") {
    return services.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return ["taxi"];
}

function normalizeCompanies(raw: unknown): Company[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => c != null && typeof c === "object")
    .map((c) => ({
      id: String(c.id ?? ""),
      name: String(c.name ?? `Company ${c.id ?? ""}`),
      services: normalizeServices(c.services),
      description: c.description != null ? String(c.description) : undefined,
      city: c.city != null ? String(c.city) : undefined,
      country: c.country != null ? String(c.country) : undefined,
      email: c.email != null ? String(c.email) : undefined,
      operatingHours:
        c.operatingHours != null && String(c.operatingHours).trim()
          ? String(c.operatingHours).trim()
          : undefined,
      dispatchOnline: c.dispatchOnline === true,
      asapBookable: c.asapBookable !== false,
      asapBlockReason: c.asapBlockReason != null ? String(c.asapBlockReason) : undefined,
    }))
    .filter((c) => c.id);
}

interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  available: boolean;
}

interface Restaurant {
  id: string;
  name: string;
  address: string;
  phone: string;
  cuisine: string;
  image: string;
  isOpen: boolean;
  menu: MenuItem[];
}

interface CartItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
}

interface PaymentConfig {
  cashEnabled?: boolean;
  companyCashEnabled?: boolean;
  effectiveCash?: boolean;
  cardEnabled?: boolean;
  stripeConfigured?: boolean;
}

interface ActiveBookingConflict {
  existingBookingId: string;
  existingStatus?: string;
  serviceType?: string;
  message: string;
}

const SERVICE_LABELS: Record<string, { label: string; icon: React.ReactNode; desc: string }> = {
  taxi: {
    label: "Taxi / Ride",
    icon: <Car className="w-6 h-6" />,
    desc: "Door-to-door taxi rides, airport transfers, and more",
  },
  food: {
    label: "Food Delivery",
    icon: <Utensils className="w-6 h-6" />,
    desc: "Hot food delivered from your favourite local restaurants",
  },
  courier: {
    label: "Courier / Parcel",
    icon: <Package className="w-6 h-6" />,
    desc: "Same-day local deliveries and parcel collection",
  },
};

const STEPS = ["Company", "Service", "Details", "Confirm"];

type PaymentMethod = "card" | "account" | "acc" | "tm" | "giftcard" | "cash";
/** Remainder methods after TM subsidy — Cash is always offered (ignores company cash toggle). */
type TmRemainderMethod = Exclude<PaymentMethod, "tm">;

const PAYMENT_METHODS: Array<{
  value: PaymentMethod;
  label: string;
  icon: React.ReactNode;
  placeholder: string;
  help: string;
}> = [
  {
    value: "card",
    label: "Card",
    icon: <CreditCard className="w-4 h-4" />,
    placeholder: "",
    help: "Pay securely by card. The trip price is charged at checkout.",
  },
  {
    value: "cash",
    label: "Cash",
    icon: <DollarSign className="w-4 h-4" />,
    placeholder: "",
    help: "Pay the driver in cash at the end of the trip.",
  },
  {
    value: "account",
    label: "Account",
    icon: <Wallet className="w-4 h-4" />,
    placeholder: "Account number",
    help: "For approved account clients. Enter your account number to verify.",
  },
  {
    value: "acc",
    label: "ACC",
    icon: <Shield className="w-4 h-4" />,
    placeholder: "ACC claim number",
    help: "ACC-funded rides. Enter your claim number to verify eligibility.",
  },
  {
    value: "tm",
    label: "Total Mobility",
    icon: <Ticket className="w-4 h-4" />,
    placeholder: "TM card number",
    help: "Total Mobility scheme. Enter your TM card number, confirm name/expiry, then choose how to pay the remainder.",
  },
  {
    value: "giftcard",
    label: "Gift Card",
    icon: <Gift className="w-4 h-4" />,
    placeholder: "Gift card code",
    help: "Enter your gift card code to verify the available balance.",
  },
];

export default function BookPage() {
  const [step, setStep] = useState(0);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);

  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [selectedService, setSelectedService] = useState<string>("");
  const [bookingType, setBookingType] = useState<"now" | "scheduled">("now");
  const [passengerKey, setPassengerKey] = useState<string>("");
  const [form, setForm] = useState({
    passengerName: "",
    passengerPhone: "",
    passengerEmail: "",
    pickAddress: "",
    dropAddress: "",
    scheduledFor: "",
    notes: "",
    amount: "",
  });

  const [submitting, setSubmitting] = useState(false);
  const [submittingCard, setSubmittingCard] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [wasScheduled, setWasScheduled] = useState(false);
  const [paidByCard, setPaidByCard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [vehicleType, setVehicleType] = useState<VehicleTypeOption>("Any");
  const [passengers, setPassengers] = useState(1);
  const [paymentRef, setPaymentRef] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const verifyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // TM card details + remainder (Cash always available for TM remainder)
  const [tmPassengerName, setTmPassengerName] = useState("");
  const [tmExpiryDate, setTmExpiryDate] = useState("");
  const [tmRemainder, setTmRemainder] = useState<TmRemainderMethod>("cash");
  const [tmRemainderRef, setTmRemainderRef] = useState("");
  const [tmRemainderVerified, setTmRemainderVerified] = useState(false);
  const [tmRemainderVerifying, setTmRemainderVerifying] = useState(false);
  const [tmRemainderError, setTmRemainderError] = useState<string | null>(null);
  const tmRemainderDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pickCoords, setPickCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dropCoords, setDropCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [stops, setStops] = useState<Array<{ id: string; address: string; lat: number; lng: number }>>([]);
  const [addingStop, setAddingStop] = useState(false);
  const [stopDraft, setStopDraft] = useState("");
  const stopDraftRef = useRef("");
  const [stopAddressActive, setStopAddressActive] = useState(false);
  const [pickAddressActive, setPickAddressActive] = useState(false);
  const [dropAddressActive, setDropAddressActive] = useState(false);
  const mapPointerEventsDisabled = pickAddressActive || stopAddressActive;
  const [fareEstimate, setFareEstimate] = useState<{ estimate: number; distanceKm: number } | null>(null);
  const [fareLoading, setFareLoading] = useState(false);

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loadingRestaurants, setLoadingRestaurants] = useState(false);
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletLoading, setWalletLoading] = useState(false);
  const [useWalletCredit, setUseWalletCredit] = useState(false);
  const [paidWithWallet, setPaidWithWallet] = useState(false);
  const [walletAppliedAtBooking, setWalletAppliedAtBooking] = useState(0);
  const [activeBooking, setActiveBooking] = useState<ActiveBookingConflict | null>(null);
  const [isEditingSuccessBooking, setIsEditingSuccessBooking] = useState(false);
  const [confirmCancelSuccess, setConfirmCancelSuccess] = useState(false);
  const [isCancellingSuccess, setIsCancellingSuccess] = useState(false);
  const [isSavingSuccessEdit, setIsSavingSuccessEdit] = useState(false);
  const [successEditError, setSuccessEditError] = useState<string | null>(null);
  const [successCancelError, setSuccessCancelError] = useState<string | null>(null);
  const [successCancelled, setSuccessCancelled] = useState(false);
  const [lastEditChanges, setLastEditChanges] = useState<string[] | null>(null);
  const [successEditForm, setSuccessEditForm] = useState({
    pickAddress: "",
    dropAddress: "",
    scheduledFor: "",
    notes: "",
  });

  useEffect(() => {
    setPassengerKey(getOrCreatePassengerKey());
  }, []);

  const fetchWallet = async (key: string) => {
    if (!key) return;
    setWalletLoading(true);
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/wallet?key=${encodeURIComponent(key)}`,
        { cache: "no-store" }
      );
      const d = await res.json();
      if (res.ok) {
        const bal = typeof d.balance === "number" ? d.balance : 0;
        setWalletBalance(bal);
        // Do NOT auto-enable wallet spend. Auto-on previously stuck true across
        // Account/TM/Cash reviews and showed a fake "Wallet credit / Card due"
        // without ever debiting (wallet is card-checkout only).
      }
    } catch {
      // wallet display is non-critical
    } finally {
      setWalletLoading(false);
    }
  };

  useEffect(() => {
    if (passengerKey) fetchWallet(passengerKey);
  }, [passengerKey]);

  useEffect(() => {
    if ((step === 2 || step === 3) && passengerKey) fetchWallet(passengerKey);
  }, [step, passengerKey]);

  useEffect(() => {
    let cancelled = false;

    const applyCompanies = (list: Company[]) => {
      if (cancelled) return;
      setCompanies(list);
      // Keep selectedCompany in sync — a one-shot snapshot froze
      // asapBookable:false after a brief heartbeat gap (Website bug vs live Pax).
      setSelectedCompany((prev) => {
        if (!prev) return prev;
        const fresh = list.find((c) => c.id === prev.id);
        return fresh ?? prev;
      });
    };

    const loadCompanies = (opts?: { initial?: boolean }) => {
      const initial = !!opts?.initial;
      return fetch(`${import.meta.env.BASE_URL}api/companies`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`companies HTTP ${r.status}`);
          return r.json();
        })
        .then((d) => {
          const list = normalizeCompanies(d.companies);
          applyCompanies(list);
          if (!initial) return;

          // Pre-fill from ?cid=&service=&pickup=&drop= (set by "Book again" from My Rides)
          const params = new URLSearchParams(window.location.search);
          const cidParam = params.get("cid");
          const serviceParam = params.get("service");
          const pickupParam = params.get("pickup");
          const dropParam = params.get("drop");
          if (cidParam) {
            const company = list.find((c) => c.id === cidParam);
            if (company) {
              setSelectedCompany(company);
              // Only accept the service param if the company actually offers it
              const validService =
                serviceParam && company.services.includes(serviceParam)
                  ? serviceParam
                  : null;
              const prefillAddresses = (svc: string) => {
                setForm((prev) => ({
                  ...prev,
                  // Food pickup is the restaurant address — don't pre-fill it from the URL
                  pickAddress: svc === "food" ? prev.pickAddress : (pickupParam ?? prev.pickAddress),
                  dropAddress: dropParam ?? prev.dropAddress,
                }));
              };
              if (validService) {
                setSelectedService(validService);
                prefillAddresses(validService);
                // Food needs restaurant selection (step 1.5) before the details form
                setStep(validService === "food" ? 1.5 : 2);
              } else if (company.services.length === 1) {
                const svc = company.services[0];
                setSelectedService(svc);
                prefillAddresses(svc);
                setStep(svc === "food" ? 1.5 : 2);
              } else {
                // Multiple services, none valid in URL — let user pick
                prefillAddresses("");
                setStep(1);
              }
            }
          } else if (list.length === 1) {
            // No URL params but only one company — auto-select and skip the company screen
            const c = list[0];
            setSelectedCompany(c);
            if (c.services.length === 1) {
              const svc = c.services[0];
              setSelectedService(svc);
              setStep(svc === "food" ? 1.5 : 2);
            } else {
              setStep(1);
            }
          }
        })
        .catch(() => {
          // Do not invent asapBookable:false on network failure — leave prior state.
          if (initial) setCompanies([]);
        })
        .finally(() => {
          if (initial && !cancelled) setLoadingCompanies(false);
        });
    };

    void loadCompanies({ initial: true });

    // Refresh ASAP gate while the book page is open (parity with Passenger live RTDB).
    const pollMs = 30_000;
    const pollId = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void loadCompanies({ initial: false });
    }, pollMs);
    const onFocus = () => {
      void loadCompanies({ initial: false });
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  useEffect(() => {
    if (!selectedCompany) {
      setPaymentConfig(null);
      return;
    }
    fetch(`${import.meta.env.BASE_URL}api/payment-config?cid=${selectedCompany.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPaymentConfig(d))
      .catch(() => setPaymentConfig(null));
  }, [selectedCompany]);

  // Proactively warn if passenger already has an active ASAP booking for this service
  useEffect(() => {
    if (bookingType === "scheduled" || !selectedService || step >= 4) {
      setActiveBooking(null);
      return;
    }
    const phone = form.passengerPhone.trim();
    if (phone.replace(/\D/g, "").length < 7) {
      setActiveBooking(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ phone, serviceType: selectedService });
        const res = await fetch(`${import.meta.env.BASE_URL}api/bookings/active-check?${params}`);
        const d = await res.json();
        if (d.hasActive && d.existingBookingId) {
          setActiveBooking({
            existingBookingId: d.existingBookingId,
            existingStatus: d.existingStatus,
            serviceType: d.serviceType,
            message: d.message ?? "You already have an active booking.",
          });
        } else {
          setActiveBooking(null);
        }
      } catch {
        setActiveBooking(null);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [form.passengerPhone, selectedService, bookingType, step]);

  useEffect(() => {
    if (!selectedCompany || selectedService !== "food") return;
    setLoadingRestaurants(true);
    fetch(`${import.meta.env.BASE_URL}api/restaurants?cid=${selectedCompany.id}`)
      .then((r) => r.json())
      .then((d) => setRestaurants(d.restaurants ?? []))
      .catch(() => setRestaurants([]))
      .finally(() => setLoadingRestaurants(false));
  }, [selectedCompany, selectedService]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
  };

  const handleAddressChange = (field: "pickAddress" | "dropAddress") => (val: string) => {
    setForm((p) => ({ ...p, [field]: val }));
  };

  const handleCoordChange = (field: "pick" | "drop") => (lat: number, lng: number) => {
    const coords = lat && lng ? { lat, lng } : null;
    if (field === "pick") setPickCoords(coords);
    else setDropCoords(coords);
  };

  // Auto-verify payment reference for methods that need a reference (not card/cash)
  useEffect(() => {
    if (paymentMethod === "card" || paymentMethod === "cash" || !selectedCompany) {
      setVerified(paymentMethod === "cash" || paymentMethod === "card");
      setVerifyError(null);
      if (verifyDebounceRef.current) clearTimeout(verifyDebounceRef.current);
      setVerifying(false);
      return;
    }
    const ref = paymentRef.trim();
    setVerified(false);
    setVerifyError(null);
    if (verifyDebounceRef.current) clearTimeout(verifyDebounceRef.current);
    if (!ref) {
      setVerifying(false);
      return;
    }
    setVerifying(true);
    verifyDebounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          cid: selectedCompany.id,
          method: paymentMethod,
          reference: ref,
          ...(fareEstimate ? { estimatedFare: String(fareEstimate.estimate) } : {}),
        });
        const res = await fetch(`${import.meta.env.BASE_URL}api/verify-payment?${params}`);
        const d = await res.json();
        setVerified(!!d.valid);
        setVerifyError(d.valid ? null : (d.message ?? "Verification failed."));
        if (paymentMethod === "tm" && d.valid) {
          if (d.passengerName && !tmPassengerName.trim()) {
            setTmPassengerName(String(d.passengerName));
          }
          if (d.expiryDate && !tmExpiryDate.trim()) {
            setTmExpiryDate(String(d.expiryDate).slice(0, 10));
          }
        }
      } catch {
        setVerified(false);
        setVerifyError("Could not verify. Please check your connection.");
      } finally {
        setVerifying(false);
      }
    }, 600);
  }, [paymentRef, paymentMethod, selectedCompany, fareEstimate]);

  // TM remainder reference verify (Account / ACC / Gift Card)
  useEffect(() => {
    if (paymentMethod !== "tm" || !selectedCompany) {
      setTmRemainderVerified(false);
      setTmRemainderError(null);
      if (tmRemainderDebounceRef.current) clearTimeout(tmRemainderDebounceRef.current);
      setTmRemainderVerifying(false);
      return;
    }
    if (tmRemainder === "cash" || tmRemainder === "card") {
      setTmRemainderVerified(true);
      setTmRemainderError(null);
      setTmRemainderVerifying(false);
      if (tmRemainderDebounceRef.current) clearTimeout(tmRemainderDebounceRef.current);
      return;
    }
    const ref = tmRemainderRef.trim();
    setTmRemainderVerified(false);
    setTmRemainderError(null);
    if (tmRemainderDebounceRef.current) clearTimeout(tmRemainderDebounceRef.current);
    if (!ref) {
      setTmRemainderVerifying(false);
      return;
    }
    setTmRemainderVerifying(true);
    tmRemainderDebounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          cid: selectedCompany.id,
          method: tmRemainder,
          reference: ref,
          ...(fareEstimate ? { estimatedFare: String(fareEstimate.estimate) } : {}),
        });
        const res = await fetch(`${import.meta.env.BASE_URL}api/verify-payment?${params}`);
        const d = await res.json();
        setTmRemainderVerified(!!d.valid);
        setTmRemainderError(d.valid ? null : (d.message ?? "Verification failed."));
      } catch {
        setTmRemainderVerified(false);
        setTmRemainderError("Could not verify. Please check your connection.");
      } finally {
        setTmRemainderVerifying(false);
      }
    }, 600);
  }, [paymentMethod, tmRemainder, tmRemainderRef, selectedCompany, fareEstimate]);

  const availablePaymentMethods = PAYMENT_METHODS.filter((pm) => {
    if (pm.value === "card") {
      return paymentConfig?.cardEnabled === true || paymentConfig == null;
    }
    if (pm.value === "cash") {
      return paymentConfig?.effectiveCash === true;
    }
    return true;
  });

  /** TM remainder chips — Cash always included regardless of company cash toggle. */
  const tmRemainderMethods = PAYMENT_METHODS.filter((pm) => {
    if (pm.value === "tm") return false;
    if (pm.value === "cash") return true;
    if (pm.value === "card") {
      return paymentConfig?.cardEnabled === true || paymentConfig == null;
    }
    return true;
  });

  const tmPaymentReady =
    paymentMethod !== "tm" ||
    (verified &&
      !!tmPassengerName.trim() &&
      !!tmExpiryDate.trim() &&
      (tmRemainder === "cash" ||
        tmRemainder === "card" ||
        (tmRemainderRef.trim().length > 0 && tmRemainderVerified)));

  const effectiveCheckoutMethod: PaymentMethod =
    paymentMethod === "tm" ? tmRemainder : paymentMethod;

  useEffect(() => {
    if (paymentConfig?.cardEnabled === false && paymentMethod === "card") {
      const fallback = PAYMENT_METHODS.find(
        (pm) => pm.value !== "card" && (pm.value !== "cash" || paymentConfig?.effectiveCash === true),
      );
      if (fallback) setPaymentMethod(fallback.value);
    }
    if (paymentConfig && paymentConfig.effectiveCash !== true && paymentMethod === "cash") {
      setPaymentMethod(paymentConfig.cardEnabled === false ? "account" : "card");
    }
  }, [paymentConfig, paymentMethod]);

  // 5+ passengers require Van tariff + van vehicle.
  useEffect(() => {
    if (passengers >= 5 && vehicleType !== "Van") {
      setVehicleType("Van");
    }
  }, [passengers, vehicleType]);

  // Auto-fetch fare estimate. Works in two modes:
  //   1. Coords already resolved (user picked from autocomplete suggestions) → fire immediately
  //   2. Addresses typed manually or pre-filled from URL params → geocode both first, then estimate
  // Debounced so it doesn't hit the geocoder on every keystroke.
  useEffect(() => {
    if (!selectedCompany || selectedService !== "taxi") {
      setFareEstimate(null);
      return;
    }

    const pickReady = !!pickCoords?.lat;
    const dropReady = !!dropCoords?.lat;
    const pickAddr = form.pickAddress?.trim() ?? "";
    const dropAddr = form.dropAddress?.trim() ?? "";

    // Need at least both addresses entered (length 5+) to bother geocoding
    if ((!pickReady && pickAddr.length < 5) || (!dropReady && dropAddr.length < 5)) {
      setFareEstimate(null);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setFareLoading(true);
      try {
        // Resolve coords for whichever side is missing
        let pLat = pickCoords?.lat;
        let pLng = pickCoords?.lng;
        let dLat = dropCoords?.lat;
        let dLng = dropCoords?.lng;

        if (!pickReady) {
          const r = await fetch(`${import.meta.env.BASE_URL}api/geocode?q=${encodeURIComponent(pickAddr)}`);
          const data = (await r.json()) as Array<{ lat: string; lon: string }>;
          if (data?.[0]) {
            pLat = parseFloat(data[0].lat);
            pLng = parseFloat(data[0].lon);
            if (!cancelled && pLat && pLng) setPickCoords({ lat: pLat, lng: pLng });
          }
        }
        if (!dropReady) {
          const r = await fetch(`${import.meta.env.BASE_URL}api/geocode?q=${encodeURIComponent(dropAddr)}`);
          const data = (await r.json()) as Array<{ lat: string; lon: string }>;
          if (data?.[0]) {
            dLat = parseFloat(data[0].lat);
            dLng = parseFloat(data[0].lon);
            if (!cancelled && dLat && dLng) setDropCoords({ lat: dLat, lng: dLng });
          }
        }

        if (cancelled) return;
        if (!pLat || !pLng || !dLat || !dLng) {
          setFareEstimate(null);
          return;
        }

        const purpose =
          paymentMethod === "tm"
            ? "Total Mobility"
            : passengers >= 5 || vehicleType === "Van" || vehicleType === "Wheelchair"
              ? "Van"
              : "Standard";
        const atParam =
          bookingType === "scheduled" && form.scheduledFor
            ? `&at=${encodeURIComponent(new Date(form.scheduledFor).toISOString())}`
            : "";
        const r = await fetch(
          `${import.meta.env.BASE_URL}api/fare-estimate?cid=${selectedCompany.id}&fromLat=${pLat}&fromLng=${pLng}&toLat=${dLat}&toLng=${dLng}&purpose=${encodeURIComponent(purpose)}&passengers=${passengers}&vehicleType=${encodeURIComponent(vehicleType)}${atParam}`,
        );
        const d = await r.json();
        if (cancelled) return;
        if (d.estimatedFare != null) {
          setFareEstimate({ estimate: d.estimatedFare, distanceKm: d.distanceKm ?? 0 });
          setForm((prev) => ({ ...prev, amount: d.estimatedFare.toFixed(2) }));
        } else {
          setFareEstimate(null);
        }
      } catch {
        if (!cancelled) setFareEstimate(null);
      } finally {
        if (!cancelled) setFareLoading(false);
      }
    };

    // No debounce when coords are already locked in; debounce when geocoding from typed text
    const delay = pickReady && dropReady ? 0 : 700;
    const t = setTimeout(run, delay);
    return () => { cancelled = true; clearTimeout(t); };
  }, [pickCoords, dropCoords, form.pickAddress, form.dropAddress, form.scheduledFor, selectedCompany, selectedService, passengers, vehicleType, paymentMethod, bookingType]);

  const reserveJobId = async (): Promise<string> => {
    const res = await fetch(`${import.meta.env.BASE_URL}api/job/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: selectedCompany!.id,
        source: selectedService === "food" ? "food" : selectedService === "courier" ? "freight" : "web",
        passenger: { name: form.passengerName, phone: form.passengerPhone },
        pickup: { address: form.pickAddress, lat: pickCoords?.lat ?? 0, lng: pickCoords?.lng ?? 0 },
        dropoff: { address: form.dropAddress, lat: dropCoords?.lat ?? 0, lng: dropCoords?.lng ?? 0 },
        notes: form.notes,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not reserve a job ID");
    return data.jobId as string;
  };

  const createBooking = async (
    jobId: string,
    method: PaymentMethod,
    options?: { useWallet?: boolean }
  ) => {
    const bookingIsTM = paymentMethod === "tm";
    const payMethod: PaymentMethod = bookingIsTM ? tmRemainder : method;
    const accountOrAccRef = bookingIsTM ? tmRemainderRef : paymentRef;
    const giftRef = bookingIsTM ? tmRemainderRef : paymentRef;

    const refFields: Record<string, string | boolean> = {};
    if (payMethod === "account" || payMethod === "acc") {
      refFields.accountNumber = accountOrAccRef.trim();
    }
    if (payMethod === "giftcard") {
      refFields.giftCardCode = giftRef.trim().toUpperCase();
    }
    if (bookingIsTM) {
      refFields.isTM = true;
      refFields.tmCardNumber = paymentRef.trim();
      if (tmPassengerName.trim()) refFields.tmCardName = tmPassengerName.trim();
      if (tmExpiryDate.trim()) refFields.tmCardExpiry = tmExpiryDate.trim();
    }

    const res = await fetch(`${import.meta.env.BASE_URL}api/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        passengerKey,
        companyId: selectedCompany!.id,
        companyName: selectedCompany!.name,
        companyEmail: (selectedCompany as any).email ?? "",
        serviceType: selectedService,
        passengerName: form.passengerName,
        passengerPhone: form.passengerPhone,
        passengerEmail: form.passengerEmail,
        pickAddress: form.pickAddress,
        dropAddress: form.dropAddress,
        scheduledFor:
          bookingType === "scheduled" && form.scheduledFor
            ? new Date(form.scheduledFor).toISOString()
            : undefined,
        notes: form.notes,
        amount: form.amount ? parseFloat(form.amount) : undefined,
        paymentMethod: payMethod,
        // 5+ → Van. Explicit type → stamp it. "Any" / no pick → omit VehicleType (open eligibility).
        vehicleType:
          selectedService === "taxi"
            ? passengers >= 5
              ? "Van"
              : vehicleType === "Any"
                ? undefined
                : vehicleType
            : undefined,
        passengers: selectedService === "taxi" ? passengers : undefined,
        pickLat: pickCoords?.lat ?? 0,
        pickLng: pickCoords?.lng ?? 0,
        dropLat: dropCoords?.lat ?? 0,
        dropLng: dropCoords?.lng ?? 0,
        stops: stops.length
          ? stops.map((s) => ({ address: s.address, lat: s.lat, lng: s.lng }))
          : undefined,
        restaurantId: selectedService === "food" ? selectedRestaurant?.id : undefined,
        restaurantName: selectedService === "food" ? selectedRestaurant?.name : undefined,
        orderItems: selectedService === "food" && cartItems.length > 0 ? cartItems : undefined,
        useWallet: options?.useWallet ?? false,
        ...refFields,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error ?? "Something went wrong") as Error & {
        code?: string;
        existingBookingId?: string;
        existingStatus?: string;
      };
      err.code = data.code;
      err.existingBookingId = data.existingBookingId;
      err.existingStatus = data.existingStatus;
      throw err;
    }
    return data.bookingId as string;
  };

  const handleBookingError = (err: any) => {
    if (err?.code === "DUPLICATE_ACTIVE_BOOKING" && err.existingBookingId) {
      setActiveBooking({
        existingBookingId: err.existingBookingId,
        existingStatus: err.existingStatus,
        serviceType: selectedService,
        message: err.message ?? "You already have an active booking.",
      });
    }
    setError(err.message ?? "Something went wrong");
  };

  const openSuccessEdit = () => {
    setSuccessEditForm({
      pickAddress: form.pickAddress,
      dropAddress: form.dropAddress,
      scheduledFor: wasScheduled ? toNZDatetimeLocal(form.scheduledFor) : "",
      notes: form.notes,
    });
    setSuccessEditError(null);
    setIsEditingSuccessBooking(true);
  };

  const handleSaveSuccessEdit = async () => {
    if (!passengerKey || !bookingId || !selectedCompany) return;
    setIsSavingSuccessEdit(true);
    setSuccessEditError(null);
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/my-rides/${bookingId}/update`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: passengerKey,
            companyId: selectedCompany.id,
            ...(wasScheduled && successEditForm.scheduledFor
              ? { scheduledFor: fromNZDatetimeLocal(successEditForm.scheduledFor) }
              : {}),
            notes: successEditForm.notes,
            pickAddress: successEditForm.pickAddress || undefined,
            dropAddress: successEditForm.dropAddress || undefined,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not save changes");
      setForm((prev) => ({
        ...prev,
        pickAddress: successEditForm.pickAddress,
        dropAddress: successEditForm.dropAddress,
        notes: successEditForm.notes,
        ...(wasScheduled && successEditForm.scheduledFor
          ? { scheduledFor: fromNZDatetimeLocal(successEditForm.scheduledFor) }
          : {}),
      }));
      const apiChanges: string[] = Array.isArray(data.changes) ? data.changes : [];
      if (apiChanges.length) {
        setLastEditChanges(apiChanges);
      } else {
        // Fallback summary from the form so confirmation always shows notes/fields.
        const summary: string[] = [];
        if (successEditForm.pickAddress) summary.push(`Pickup → ${successEditForm.pickAddress}`);
        if (successEditForm.dropAddress) summary.push(`Drop-off → ${successEditForm.dropAddress}`);
        if (wasScheduled && successEditForm.scheduledFor) {
          summary.push(
            `Pickup time → ${new Date(fromNZDatetimeLocal(successEditForm.scheduledFor)).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`,
          );
        }
        if (successEditForm.notes?.trim()) summary.push(`Notes → ${successEditForm.notes.trim()}`);
        setLastEditChanges(summary);
      }
      setIsEditingSuccessBooking(false);
    } catch (err: any) {
      setSuccessEditError(err.message ?? "Could not save changes");
    } finally {
      setIsSavingSuccessEdit(false);
    }
  };

  const handleCancelSuccessBooking = async () => {
    if (!passengerKey || !bookingId || !selectedCompany) return;
    setIsCancellingSuccess(true);
    setSuccessCancelError(null);
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/my-rides/${bookingId}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: passengerKey, companyId: selectedCompany.id }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not cancel booking");
      setConfirmCancelSuccess(false);
      setSuccessCancelled(true);
    } catch (err: any) {
      setSuccessCancelError(err.message ?? "Could not cancel booking");
    } finally {
      setIsCancellingSuccess(false);
    }
  };

  const assertAsapAllowed = (): boolean => {
    if (bookingType === "scheduled") return true;
    if (!selectedCompany) {
      setError("Please select a company.");
      return false;
    }
    if (selectedCompany.asapBookable === false) {
      setError(
        selectedCompany.asapBlockReason === "outside_hours" ||
          selectedCompany.dispatchOnline === true
          ? "This company is outside its operating hours. Please schedule for a later time."
          : "This company's dispatch is offline. Please schedule for a later time, or try again when dispatch is open.",
      );
      return false;
    }
    return true;
  };

  const handlePayWithWallet = async () => {
    if (!form.passengerEmail.trim()) {
      setError("An email address is required to receive your booking confirmation");
      return;
    }
    if (!hasAmount) {
      setError("Please enter the fare amount to use wallet credit.");
      return;
    }
    if (!assertAsapAllowed()) return;
    setSubmitting(true);
    setError(null);
    try {
      const jobId = await reserveJobId();
      await createBooking(jobId, "card", { useWallet: true });
      setBookingId(jobId);
      setWasScheduled(bookingType === "scheduled");
      setPaidByCard(false);
      setPaidWithWallet(true);
      setWalletAppliedAtBooking(fareTotal);
      setWalletBalance((prev) => Math.max(0, +(prev - fareTotal).toFixed(2)));
      setStep(4);
    } catch (err: any) {
      handleBookingError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmBooking = async () => {
    if (!form.passengerEmail.trim()) {
      setError("An email address is required to receive your booking confirmation");
      return;
    }
    if (paymentMethod === "tm" && !tmPaymentReady) {
      setError("Please complete Total Mobility card and remainder payment details.");
      return;
    }
    if (!assertAsapAllowed()) return;
    setSubmitting(true);
    setError(null);
    try {
      const jobId = await reserveJobId();
      await createBooking(jobId, effectiveCheckoutMethod);
      setBookingId(jobId);
      setWasScheduled(bookingType === "scheduled");
      setPaidByCard(false);
      setStep(4);
    } catch (err: any) {
      handleBookingError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePayByCard = async () => {
    if (!form.passengerEmail.trim()) {
      setError("An email address is required to receive your booking confirmation");
      return;
    }
    if (paymentMethod === "tm" && !tmPaymentReady) {
      setError("Please complete Total Mobility card and remainder payment details.");
      return;
    }
    if (!assertAsapAllowed()) return;
    const chargeAmount = walletActive ? cardAmountDue : parseFloat(form.amount);
    if (!chargeAmount || chargeAmount <= 0) {
      setError("Please enter the agreed amount to pay by card.");
      return;
    }
    setSubmittingCard(true);
    setError(null);
    try {
      const jobId = await reserveJobId();
      await createBooking(jobId, "card", { useWallet: walletActive });
      if (walletActive) setWalletAppliedAtBooking(walletApplied);
      const serviceLabel = SERVICE_LABELS[selectedService]?.label ?? selectedService;
      const description = walletActive
        ? `${serviceLabel} — ${form.pickAddress} to ${form.dropAddress} (card portion after wallet)`
        : `${serviceLabel} — ${form.pickAddress} to ${form.dropAddress}`;

      const stripeRes = await fetch(`${import.meta.env.BASE_URL}api/stripe/create-booking-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cid: selectedCompany!.id,
          bookingId: jobId,
          description,
          amount: chargeAmount,
          currency: "nzd",
          email: form.passengerEmail,
        }),
      });
      let stripeData: { error?: string; url?: string; returnBase?: string } = {};
      try {
        stripeData = await stripeRes.json();
      } catch {
        throw new Error(
          "Card payment server returned a non-JSON response. If you opened www.bookawaka.com, switch to https://bookawaka-production.up.railway.app/book — www currently points at a dead Railway service (Application not found).",
        );
      }
      if (!stripeRes.ok) throw new Error(stripeData.error ?? "Could not start card payment");
      if (!stripeData.url || !/^https:\/\/checkout\.stripe\.com\//i.test(stripeData.url)) {
        throw new Error("Card checkout did not return a Stripe payment URL. Please try again or use another payment method.");
      }
      (window.top ?? window).location.href = stripeData.url;
    } catch (err: any) {
      handleBookingError(err);
    } finally {
      setSubmittingCard(false);
    }
  };

  const hasAmount = !!form.amount && parseFloat(form.amount) > 0;
  const fareTotal = hasAmount ? parseFloat(form.amount) : 0;
  // Wallet spend is Card-checkout only (incl. TM remainder = Card). Never Account/Cash/ACC/Gift/TM-cash.
  const walletEligible = effectiveCheckoutMethod === "card";
  const walletApplied =
    walletEligible && useWalletCredit && walletBalance > 0 && hasAmount
      ? Math.min(walletBalance, fareTotal)
      : 0;
  const cardAmountDue = hasAmount ? +(fareTotal - walletApplied).toFixed(2) : 0;
  const walletCoversFull = walletEligible && walletApplied > 0 && cardAmountDue <= 0;
  const walletActive = walletEligible && useWalletCredit && walletApplied > 0;
  const availableServices = selectedCompany?.services ?? [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/30 flex flex-col">
      {/* Header */}
      <header className="bg-foreground text-white px-6 py-4 flex items-center justify-between shadow-xl">
        <a href="/" className="flex items-center gap-2 group">
          <div className="bg-primary text-primary-foreground p-2 rounded-xl rotate-3 group-hover:rotate-0 transition-transform">
            <Navigation className="w-5 h-5" />
          </div>
          <span className="font-display font-extrabold text-xl tracking-tight">BookaWaka</span>
        </a>
        {step < 4 && (
          <div className="hidden sm:flex items-center gap-2">
            {/* Map step 1.5 (restaurant selection) → 2 so "Details" lights up */}
            {(() => {
              const displayStep = step === 1.5 ? 2 : step;
              return STEPS.map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold transition-all ${
                      i < displayStep
                        ? "bg-accent text-accent-foreground"
                        : i === displayStep
                        ? "bg-primary text-white"
                        : "bg-white/10 text-white/40"
                    }`}
                  >
                    {i < displayStep ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                  </div>
                  <span className={`text-xs font-bold ${i === displayStep ? "text-white" : "text-white/40"}`}>{s}</span>
                  {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-white/20" />}
                </div>
              ));
            })()}
          </div>
        )}
      </header>

      <main className="flex-1 flex items-start justify-center px-4 py-12">
        <div className={`w-full ${step === 2 ? "max-w-6xl" : "max-w-2xl"}`}>

          {/* Step 0: Choose Company */}
          {step === 0 && (
            <div>
              <a href="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6 font-medium">
                <ArrowLeft className="w-4 h-4" /> Back
              </a>
              <h1 className="text-3xl md:text-4xl font-display font-black text-foreground mb-2">Choose a company</h1>
              <p className="text-muted-foreground font-medium mb-8">Select which company you'd like to book with.</p>

              {loadingCompanies ? (
                <div className="flex items-center gap-3 text-muted-foreground py-12 justify-center">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="font-medium">Loading available companies…</span>
                </div>
              ) : (Array.isArray(companies) ? companies : []).length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p className="font-medium">No companies are available right now. Please try again later.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {(Array.isArray(companies) ? companies : []).map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setSelectedCompany(c);
                        if (c.services.length === 1) {
                          const svc = c.services[0];
                          setSelectedService(svc);
                          if (svc === "food") setStep(1.5);
                          else setStep(2);
                        } else {
                          setStep(1);
                        }
                      }}
                      className="w-full text-left bg-card border border-border rounded-2xl p-5 hover:border-primary hover:shadow-lg transition-all group"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-display font-bold text-lg text-foreground group-hover:text-primary transition-colors">{c.name}</div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                            {c.city && (
                              <div className="text-sm text-muted-foreground flex items-center gap-1">
                                <MapPin className="w-3 h-3 flex-shrink-0" />{c.city}
                              </div>
                            )}
                            {c.operatingHours && (
                              <div className="text-sm text-muted-foreground flex items-center gap-1">
                                Hours: {c.operatingHours}
                              </div>
                            )}
                            {c.country && (
                              <div className="text-sm text-muted-foreground flex items-center gap-1">
                                <Globe className="w-3 h-3 flex-shrink-0" />{c.country}
                              </div>
                            )}
                          </div>
                          {c.description && <div className="text-sm text-muted-foreground mt-1">{c.description}</div>}
                          <div className="flex gap-2 mt-2 flex-wrap">
                            {c.services.map((s) => (
                              <span key={s} className="text-xs font-bold bg-primary/10 text-primary px-2 py-1 rounded-full capitalize">{s}</span>
                            ))}
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 1: Choose Service */}
          {step === 1 && (
            <div>
              <button onClick={() => setStep(0)} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6 font-medium">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <h1 className="text-3xl md:text-4xl font-display font-black text-foreground mb-2">Choose a service</h1>
              <p className="text-muted-foreground font-medium mb-8">
                What can <span className="font-bold text-foreground">{selectedCompany?.name}</span> help you with today?
              </p>
              <div className="space-y-3">
                {availableServices.map((svc) => {
                  const meta = SERVICE_LABELS[svc] ?? { label: svc, icon: <Car className="w-6 h-6" />, desc: "" };
                  return (
                    <button
                      key={svc}
                      onClick={() => { setSelectedService(svc); if (svc === "food") setStep(1.5); else setStep(2); }}
                      className="w-full text-left bg-card border border-border rounded-2xl p-5 hover:border-primary hover:shadow-lg transition-all group flex items-center gap-4"
                    >
                      <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all flex-shrink-0">
                        {meta.icon}
                      </div>
                      <div className="flex-1">
                        <div className="font-display font-bold text-lg text-foreground group-hover:text-primary transition-colors">{meta.label}</div>
                        <div className="text-sm text-muted-foreground">{meta.desc}</div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 1.5: Restaurant Selection (food only) */}
          {step === 1.5 && (
            <div>
              <button
                onClick={() => setStep((selectedCompany?.services ?? []).length === 1 ? 0 : 1)}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6 font-medium"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <h1 className="text-3xl md:text-4xl font-display font-black text-foreground mb-2">Choose a restaurant</h1>
              <p className="text-muted-foreground font-medium mb-8">
                Order food delivery from <span className="font-bold text-foreground">{selectedCompany?.name}</span>
              </p>

              {loadingRestaurants ? (
                <div className="flex items-center gap-3 text-muted-foreground py-12 justify-center">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="font-medium">Loading restaurants…</span>
                </div>
              ) : restaurants.filter((r) => r.isOpen).length === 0 ? (
                <div className="text-center py-16 bg-card border border-border rounded-2xl">
                  <Utensils className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
                  <p className="font-bold text-foreground mb-2">No restaurants available yet</p>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto px-6">
                    We're currently on-boarding food delivery partners in this area. Check back soon, or call the company directly to place an order.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {restaurants.filter((r) => r.isOpen).map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        setSelectedRestaurant(r);
                        setForm((prev) => ({ ...prev, pickAddress: r.address }));
                        setPickCoords(null);
                        setCartItems([]);
                        setStep(2);
                      }}
                      className="w-full text-left bg-card border border-border rounded-2xl p-5 hover:border-primary hover:shadow-lg transition-all group"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-11 h-11 bg-primary/10 rounded-xl flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all flex-shrink-0">
                            <Store className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-display font-bold text-base text-foreground group-hover:text-primary transition-colors">{r.name}</div>
                            {r.cuisine && <div className="text-sm text-muted-foreground">{r.cuisine}</div>}
                            {r.address && (
                              <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                <MapPin className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{r.address}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Booking Details */}
          {step === 2 && (
            <div>
              <button
                onClick={() => {
                  if (selectedService === "food") setStep(1.5);
                  else setStep((selectedCompany?.services ?? []).length === 1 ? 0 : 1);
                }}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6 font-medium"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2">Trip details</h1>
              <p className="text-muted-foreground mb-8">
                <span className="font-semibold text-foreground">{selectedCompany?.name}</span>
                <span className="mx-2 text-border">·</span>
                <span>{SERVICE_LABELS[selectedService]?.label ?? selectedService}</span>
                {selectedService === "food" && selectedRestaurant && (
                  <>
                    <span className="mx-2 text-border">·</span>
                    <span className="font-semibold text-foreground">{selectedRestaurant.name}</span>
                  </>
                )}
              </p>

              {activeBooking && bookingType === "now" && (
                <ActiveBookingAlert conflict={activeBooking} />
              )}

              <div className="flex flex-col lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start overflow-visible">
                <div
                  className="min-w-0 order-1 overflow-visible"
                  style={{ position: "relative", zIndex: 10 }}
                >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (paymentMethod === "tm") {
                    if (!paymentRef.trim()) {
                      setError("Please enter your TM card number.");
                      return;
                    }
                    if (!verified) {
                      setError("Please wait for TM card verification to complete.");
                      return;
                    }
                    if (!tmPassengerName.trim() || !tmExpiryDate.trim()) {
                      setError("Please enter the TM cardholder name and expiry date.");
                      return;
                    }
                    if (!tmPaymentReady) {
                      setError("Please complete and verify the remainder payment option.");
                      return;
                    }
                  } else if (paymentMethod !== "card" && paymentMethod !== "cash") {
                    if (!paymentRef.trim()) {
                      setError(`Please enter your ${PAYMENT_METHODS.find((m) => m.value === paymentMethod)?.placeholder?.toLowerCase() ?? "payment reference"}.`);
                      return;
                    }
                    if (!verified) {
                      setError("Please wait for payment verification to complete.");
                      return;
                    }
                  }
                  if (selectedService === "taxi" && !fareEstimate && !hasAmount) {
                    setError("Please confirm pickup and drop-off so we can calculate your trip price.");
                    return;
                  }
                  setError(null);
                  setStep(3);
                }}
                className="space-y-6 bg-card border border-border/80 rounded-2xl p-6 md:p-8 shadow-sm overflow-visible"
              >
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="passengerName" className="font-semibold text-sm">Name <span className="text-destructive">*</span></Label>
                    <Input id="passengerName" name="passengerName" value={form.passengerName} onChange={handleChange} placeholder="e.g. Jane Smith" required className="rounded-xl h-11" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="passengerPhone" className="font-semibold text-sm">Phone <span className="text-destructive">*</span></Label>
                    <Input id="passengerPhone" name="passengerPhone" value={form.passengerPhone} onChange={handleChange} placeholder="e.g. 021 123 4567" required className="rounded-xl h-11" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="passengerEmail" className="font-semibold text-sm">
                    Email <span className="text-destructive">*</span>
                  </Label>
                  <Input id="passengerEmail" name="passengerEmail" type="email" value={form.passengerEmail} onChange={handleChange} placeholder="you@example.com" required className="rounded-xl h-11" />
                </div>

                <div
                  className={`space-y-2 relative ${pickAddressActive ? "z-[60]" : ""}`}
                >
                  <Label htmlFor="pickAddress" className="font-semibold text-sm">
                    {selectedService === "food" ? "Restaurant address" : "Pickup"}
                    <span className="text-destructive"> *</span>
                  </Label>
                  {selectedService === "food" && selectedRestaurant ? (
                    <div className="rounded-xl h-11 border border-border bg-muted/40 flex items-center px-3 text-sm text-muted-foreground">
                      <MapPin className="w-3.5 h-3.5 mr-2 text-primary flex-shrink-0" />
                      {form.pickAddress || selectedRestaurant.address}
                    </div>
                  ) : (
                    <>
                      <AddressInput
                        id="pickAddress"
                        name="pickAddress"
                        value={form.pickAddress}
                        onChange={handleAddressChange("pickAddress")}
                        onCoordChange={handleCoordChange("pick")}
                        onActiveChange={setPickAddressActive}
                        placeholder="Start typing your pickup location…"
                        required
                      />
                    </>
                  )}
                </div>

                <div
                  className={`space-y-2 relative ${dropAddressActive ? "z-[70]" : pickAddressActive ? "z-[1]" : ""}`}
                >
                  <Label htmlFor="dropAddress" className="font-semibold text-sm">
                    {selectedService === "food" ? "Delivery address" : "Drop-off"}
                    <span className="text-destructive"> *</span>
                  </Label>
                  <AddressInput
                    id="dropAddress"
                    name="dropAddress"
                    value={form.dropAddress}
                    onChange={handleAddressChange("dropAddress")}
                    onCoordChange={handleCoordChange("drop")}
                    onActiveChange={setDropAddressActive}
                    placeholder={selectedService === "food" ? "Your delivery address…" : "Where are you going?"}
                    required
                  />
                </div>

                {selectedService === "taxi" && (
                  <div className={`space-y-2 relative ${stopAddressActive ? "z-[65]" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <Label className="font-semibold text-sm">Stops (optional)</Label>
                      {!addingStop && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-primary"
                          onClick={() => setAddingStop(true)}
                        >
                          + Add a stop
                        </button>
                      )}
                    </div>
                    {stops.map((s) => (
                      <div
                        key={s.id}
                        className="rounded-xl h-11 border border-border bg-muted/40 flex items-center px-3 text-sm gap-2"
                      >
                        <MapPin className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                        <span className="truncate flex-1">{s.address}</span>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => setStops((prev) => prev.filter((x) => x.id !== s.id))}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    {addingStop && (
                      <AddressInput
                        id="stopAddress"
                        name="stopAddress"
                        value={stopDraft}
                        onChange={(val) => {
                          stopDraftRef.current = val;
                          setStopDraft(val);
                        }}
                        onCoordChange={(lat, lng) => {
                          if (!lat || !lng) return;
                          const address = stopDraftRef.current.trim();
                          if (!address) return;
                          setStops((prev) => [
                            ...prev,
                            { id: `stop-${Date.now()}`, address, lat, lng },
                          ]);
                          stopDraftRef.current = "";
                          setStopDraft("");
                          setAddingStop(false);
                          setStopAddressActive(false);
                        }}
                        onActiveChange={setStopAddressActive}
                        placeholder="Add a stop along the way…"
                      />
                    )}
                  </div>
                )}

                {/* Trip price — single read-only display (no tariff names, not editable) */}
                {selectedService === "taxi" && (fareLoading || fareEstimate) && (
                  <div className="rounded-2xl border border-border bg-muted/30 px-5 py-4">
                    {fareLoading ? (
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                        <span className="text-sm">Calculating trip price…</span>
                      </div>
                    ) : fareEstimate ? (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trip price</p>
                        <p className="text-2xl font-semibold tracking-tight text-foreground mt-0.5">
                          ${fareEstimate.estimate.toFixed(2)}
                          <span className="text-sm font-medium text-muted-foreground ml-1.5">NZD</span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Fixed price{fareEstimate.distanceKm > 0 ? ` · ${fareEstimate.distanceKm} km` : ""} — paid as selected below
                        </p>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* When — Now / Scheduled toggle */}
                <div className="space-y-3">
                  <Label className="font-semibold text-sm text-foreground">When</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setBookingType("now")}
                      className={`flex items-center justify-center gap-2 rounded-xl h-11 font-semibold text-sm border transition-colors ${
                        bookingType === "now"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-foreground/30"
                      }`}
                    >
                      <Zap className="w-4 h-4" /> Now
                    </button>
                    <button
                      type="button"
                      onClick={() => setBookingType("scheduled")}
                      className={`flex items-center justify-center gap-2 rounded-xl h-11 font-semibold text-sm border transition-colors ${
                        bookingType === "scheduled"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-foreground/30"
                      }`}
                    >
                      <CalendarClock className="w-4 h-4" /> Schedule
                    </button>
                  </div>
                  {bookingType === "now" && selectedCompany?.asapBookable === false && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      {selectedCompany.asapBlockReason === "outside_hours" ||
                      selectedCompany.dispatchOnline === true
                        ? "This company is outside its operating hours. Switch to Schedule to book for a later time."
                        : "This company's dispatch is offline. Switch to Schedule, or try again when dispatch is open."}
                    </div>
                  )}
                  {bookingType === "scheduled" && (
                    <div className="space-y-3">
                      <NzDateTimeInput
                        id="scheduledFor"
                        name="scheduledFor"
                        value={form.scheduledFor}
                        onChange={(val) => setForm((p) => ({ ...p, scheduledFor: val }))}
                        required={bookingType === "scheduled"}
                        min={new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16)}
                      />
                      <p className="text-xs text-muted-foreground">At least 5 minutes from now. Tap Done to confirm the time.</p>
                    </div>
                  )}
                </div>

                {selectedService === "taxi" && (
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="passengers" className="font-semibold text-sm">Passengers</Label>
                      <select
                        id="passengers"
                        value={passengers}
                        onChange={(e) => setPassengers(parseInt(e.target.value, 10) || 1)}
                        className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                          <option key={n} value={n}>
                            {n} {n === 1 ? "passenger" : "passengers"}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-muted-foreground">
                        {passengers >= 5 ? "5+ passengers require a van." : "Any vehicle type for 1–4 passengers."}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="vehicleType" className="font-semibold text-sm">Vehicle</Label>
                      <select
                        id="vehicleType"
                        value={passengers >= 5 ? "Van" : vehicleType}
                        disabled={passengers >= 5}
                        onChange={(e) => setVehicleType(e.target.value as VehicleTypeOption)}
                        className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
                      >
                        {VEHICLE_TYPES.map((vt) => (
                          <option
                            key={vt}
                            value={vt}
                            disabled={passengers >= 5 && vt !== "Van"}
                          >
                            {VEHICLE_LABELS[vt]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="notes" className="font-semibold text-sm">Pickup notes</Label>
                  <Textarea
                    id="notes"
                    name="notes"
                    value={form.notes}
                    onChange={handleChange}
                    placeholder="Gate code, entrance, landmark…"
                    rows={2}
                    className="rounded-xl resize-none"
                  />
                </div>

                {/* Payment method */}
                <div className="space-y-3 pt-2 border-t border-border/80">
                  <h2 className="text-sm font-semibold text-foreground">Payment</h2>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {availablePaymentMethods.map((pm) => (
                      <button
                        key={pm.value}
                        type="button"
                        onClick={() => {
                          setPaymentMethod(pm.value);
                          setPaymentRef("");
                          setVerified(pm.value === "cash" || pm.value === "card");
                          setVerifyError(null);
                          setError(null);
                          setTmPassengerName("");
                          setTmExpiryDate("");
                          setTmRemainder("cash");
                          setTmRemainderRef("");
                          setTmRemainderVerified(pm.value === "tm");
                          setTmRemainderError(null);
                          // Wallet only applies on card checkout — clear when leaving card.
                          setUseWalletCredit(pm.value === "card");
                        }}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border font-medium text-sm transition-colors ${
                          paymentMethod === pm.value
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground border-border hover:border-foreground/30"
                        }`}
                      >
                        {pm.icon}
                        <span className="leading-tight">{pm.label}</span>
                      </button>
                    ))}
                  </div>

                  {paymentMethod === "cash" && (
                    <p className="text-xs text-muted-foreground">{PAYMENT_METHODS.find((m) => m.value === "cash")?.help}</p>
                  )}

                  {paymentMethod === "card" && (
                    <>
                      <p className="text-xs text-muted-foreground">{PAYMENT_METHODS[0].help}</p>
                      <div className="rounded-xl border border-sky-200/80 bg-sky-50/80 p-3 text-xs text-sky-950 flex items-start gap-2">
                        <CreditCard className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>
                          Selected. On the next step you&apos;ll confirm the fare and be redirected to Stripe checkout to enter your card details.
                        </span>
                      </div>
                      <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 p-3 text-xs text-amber-950 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>
                          Cancel before a driver is assigned and the fare goes to your BookaWaka wallet (phone-linked credit), not back to your card. No credit after a driver is assigned.
                        </span>
                      </div>
                    </>
                  )}

                  {paymentMethod === "tm" && (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">{PAYMENT_METHODS.find((m) => m.value === "tm")?.help}</p>
                      <div className="relative">
                        <Input
                          value={paymentRef}
                          onChange={(e) => setPaymentRef(e.target.value)}
                          placeholder="TM card number"
                          className="rounded-xl h-11 pr-10"
                          autoComplete="off"
                          inputMode="numeric"
                        />
                        {verifying && (
                          <Loader2 className="absolute right-3 top-3 w-5 h-5 animate-spin text-muted-foreground pointer-events-none" />
                        )}
                        {!verifying && verified && (
                          <CheckCircle2 className="absolute right-3 top-3 w-5 h-5 text-emerald-600 pointer-events-none" />
                        )}
                      </div>
                      {!verifying && verifyError && (
                        <p className="text-sm text-destructive flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 shrink-0" /> {verifyError}
                        </p>
                      )}
                      {!verifying && verified && (
                        <>
                          <p className="text-sm text-emerald-700 font-medium flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 shrink-0" /> TM card verified
                          </p>
                          <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs font-semibold">Cardholder name</Label>
                              <Input
                                value={tmPassengerName}
                                onChange={(e) => setTmPassengerName(e.target.value)}
                                placeholder="Name on card"
                                className="rounded-xl h-11"
                                autoComplete="off"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs font-semibold">Expiry date</Label>
                              <Input
                                type="date"
                                value={tmExpiryDate}
                                onChange={(e) => setTmExpiryDate(e.target.value)}
                                className="rounded-xl h-11"
                              />
                            </div>
                          </div>
                          <div className="space-y-2 pt-1">
                            <Label className="text-xs font-semibold">Pay remainder with</Label>
                            <p className="text-xs text-muted-foreground">
                              Council covers the TM subsidy — choose how you&apos;ll pay your share. Cash is always available for TM remainder.
                            </p>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                              {tmRemainderMethods.map((pm) => (
                                <button
                                  key={pm.value}
                                  type="button"
                                  onClick={() => {
                                    setTmRemainder(pm.value as TmRemainderMethod);
                                    setTmRemainderRef("");
                                    setTmRemainderError(null);
                                    setTmRemainderVerified(pm.value === "cash" || pm.value === "card");
                                    // Wallet only for Card remainder — never TM Cash/Account/etc.
                                    setUseWalletCredit(pm.value === "card");
                                  }}
                                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border font-medium text-sm transition-colors ${
                                    tmRemainder === pm.value
                                      ? "bg-primary/10 text-foreground border-primary"
                                      : "bg-background text-muted-foreground border-border hover:border-foreground/30"
                                  }`}
                                >
                                  {pm.icon}
                                  <span className="leading-tight">{pm.label}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                          {tmRemainder !== "cash" && tmRemainder !== "card" && (
                            <div className="space-y-2">
                              <div className="relative">
                                <Input
                                  value={tmRemainderRef}
                                  onChange={(e) => setTmRemainderRef(e.target.value)}
                                  placeholder={
                                    PAYMENT_METHODS.find((m) => m.value === tmRemainder)?.placeholder ??
                                    "Reference"
                                  }
                                  className="rounded-xl h-11 pr-10"
                                  autoComplete="off"
                                />
                                {tmRemainderVerifying && (
                                  <Loader2 className="absolute right-3 top-3 w-5 h-5 animate-spin text-muted-foreground pointer-events-none" />
                                )}
                                {!tmRemainderVerifying && tmRemainderVerified && (
                                  <CheckCircle2 className="absolute right-3 top-3 w-5 h-5 text-emerald-600 pointer-events-none" />
                                )}
                              </div>
                              {!tmRemainderVerifying && tmRemainderError && (
                                <p className="text-sm text-destructive flex items-center gap-1.5">
                                  <AlertTriangle className="w-4 h-4 shrink-0" /> {tmRemainderError}
                                </p>
                              )}
                            </div>
                          )}
                          {tmRemainder === "cash" && (
                            <p className="text-xs text-muted-foreground">
                              Pay your TM co-payment in cash to the driver at the end of the trip.
                            </p>
                          )}
                          {tmRemainder === "card" && (
                            <p className="text-xs text-muted-foreground">
                              Your TM co-payment will be charged by card at checkout on the next step.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {paymentMethod !== "card" && paymentMethod !== "cash" && paymentMethod !== "tm" && (() => {
                    const pm = availablePaymentMethods.find((m) => m.value === paymentMethod)!;
                    return (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">{pm.help}</p>
                        <div className="relative">
                          <Input
                            value={paymentRef}
                            onChange={(e) => setPaymentRef(e.target.value)}
                            placeholder={pm.placeholder}
                            className="rounded-xl h-11 pr-10"
                            autoComplete="off"
                          />
                          {verifying && (
                            <Loader2 className="absolute right-3 top-3 w-5 h-5 animate-spin text-muted-foreground pointer-events-none" />
                          )}
                          {!verifying && verified && (
                            <CheckCircle2 className="absolute right-3 top-3 w-5 h-5 text-emerald-600 pointer-events-none" />
                          )}
                        </div>
                        {!verifying && verifyError && (
                          <p className="text-sm text-destructive flex items-center gap-1.5">
                            <AlertTriangle className="w-4 h-4 shrink-0" /> {verifyError}
                          </p>
                        )}
                        {!verifying && verified && (
                          <p className="text-sm text-emerald-700 font-medium flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 shrink-0" /> Verified
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {error && (
                  <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm font-medium">
                    {error}
                  </div>
                )}

                <Button type="submit" size="lg" className="w-full bg-primary text-primary-foreground hover:bg-primary/90 rounded-full h-12 font-semibold text-base">
                  Review booking <ChevronRight className="w-5 h-5 ml-2" />
                </Button>
              </form>
                </div>

                <div className="order-2 mt-6 lg:mt-0 lg:sticky lg:top-8 relative z-0">
                  <BookingMapPanel
                    pickup={pickCoords}
                    dropoff={dropCoords}
                    className={mapPointerEventsDisabled ? "pointer-events-none" : undefined}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 3 && (
            <div>
              <button
                type="button"
                onClick={() => { setStep(2); setError(null); }}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6 font-medium"
              >
                <ArrowLeft className="w-4 h-4" /> Back to edit details
              </button>
              <h1 className="text-3xl md:text-4xl font-display font-black text-foreground mb-2">Confirm booking</h1>
              <p className="text-muted-foreground font-medium mb-8">Check everything looks right before sending.</p>

              {activeBooking && bookingType === "now" && (
                <ActiveBookingAlert conflict={activeBooking} />
              )}

              <div className="bg-card border border-border/80 rounded-2xl p-6 md:p-8 shadow-sm space-y-4 mb-6">
                <Row label="Company" value={selectedCompany?.name ?? ""} />
                {selectedCompany?.operatingHours && (
                  <Row label="Operating hours" value={selectedCompany.operatingHours} />
                )}
                <Row label="Service" value={SERVICE_LABELS[selectedService]?.label ?? selectedService} />
                {selectedService === "food" && selectedRestaurant && <Row label="Restaurant" value={selectedRestaurant.name} />}
                {selectedService === "taxi" && (
                  <>
                    <Row label="Passengers" value={String(passengers)} />
                    <Row label="Vehicle" value={VEHICLE_LABELS[passengers >= 5 ? "Van" : vehicleType]} />
                  </>
                )}
                <Row label="Passenger" value={form.passengerName} />
                <Row label="Phone" value={form.passengerPhone} />
                {form.passengerEmail && <Row label="Email" value={form.passengerEmail} />}
                <hr className="border-border" />
                <Row label={selectedService === "food" ? "From" : "Pickup"} value={form.pickAddress} />
                <Row label={selectedService === "food" ? "Deliver to" : "Drop-off"} value={form.dropAddress} />
                <Row
                  label="When"
                  value={
                    bookingType === "scheduled" && form.scheduledFor
                      ? new Date(form.scheduledFor).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                      : "Now (as soon as possible)"
                  }
                />
                {form.notes && <Row label="Pickup notes" value={form.notes} />}
                {cartItems.length > 0 && (
                  <>
                    <hr className="border-border" />
                    {cartItems.map((item) => (
                      <Row key={item.menuItemId} label={`× ${item.quantity}`} value={`${item.name} — $${(item.price * item.quantity).toFixed(2)}`} />
                    ))}
                    <Row label="Order total" value={`NZD $${cartItems.reduce((s, i) => s + i.price * i.quantity, 0).toFixed(2)}`} />
                  </>
                )}
                {hasAmount && cartItems.length === 0 && (
                  <>
                    <hr className="border-border" />
                    <Row label="Trip price" value={`NZD $${fareTotal.toFixed(2)}`} />
                    {paymentMethod === "tm" ? (
                      <>
                        {walletActive && walletApplied > 0 ? (
                          <Row label="Wallet applied" value={`- $${walletApplied.toFixed(2)}`} />
                        ) : null}
                        <Row
                          label={`You pay (${
                            PAYMENT_METHODS.find((m) => m.value === tmRemainder)?.label ?? tmRemainder
                          })`}
                          value={
                            walletActive && walletCoversFull
                              ? "Fully covered by wallet"
                              : `NZD ${(walletActive ? cardAmountDue : fareTotal).toFixed(2)}`
                          }
                        />
                        <p className="text-xs text-muted-foreground pt-1">
                          Total Mobility — council subsidy is settled with your approved TM card; the
                          amount above is your remainder via{" "}
                          {PAYMENT_METHODS.find((m) => m.value === tmRemainder)?.label ?? tmRemainder}.
                        </p>
                      </>
                    ) : (
                      walletActive && (
                        <>
                          <Row label="Wallet credit" value={`- $${walletApplied.toFixed(2)}`} />
                          <Row
                            label={walletCoversFull ? "Due" : "Card due"}
                            value={
                              walletCoversFull
                                ? "Fully covered by wallet"
                                : `NZD $${cardAmountDue.toFixed(2)}`
                            }
                          />
                        </>
                      )
                    )}
                  </>
                )}
                <hr className="border-border" />
                <Row
                  label="Payment"
                  value={
                    walletCoversFull
                      ? "BookaWaka Wallet"
                      : paymentMethod === "tm"
                      ? `Total Mobility — remainder ${PAYMENT_METHODS.find((m) => m.value === tmRemainder)?.label ?? tmRemainder}${
                          paymentRef ? ` · card ${paymentRef}` : ""
                        }`
                      : effectiveCheckoutMethod === "card"
                      ? "Card (Stripe)"
                      : `${PAYMENT_METHODS.find((m) => m.value === paymentMethod)?.label ?? paymentMethod}${paymentRef ? ` — ${paymentRef}` : ""}`
                  }
                />
              </div>

              {error && (
                <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm font-medium">
                  {error}
                </div>
              )}

              {/* Wallet + confirm actions — payment method locked from previous step */}
              <div className="space-y-4">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={() => { setStep(2); setError(null); }}
                  className="w-full rounded-full h-12 font-bold"
                >
                  <ArrowLeft className="w-5 h-5 mr-2" /> Back to edit details
                </Button>

                {/* Wallet apply UI is Card-checkout only (incl. TM remainder = Card). */}
                {(walletLoading || walletBalance > 0) && walletEligible && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                          <Wallet className="w-5 h-5 text-emerald-700" />
                        </div>
                        <div>
                          <div className="text-xs font-bold uppercase tracking-widest text-emerald-700/80">
                            BookaWaka wallet
                          </div>
                          {walletLoading ? (
                            <div className="flex items-center gap-2 text-sm text-emerald-800 mt-1">
                              <Loader2 className="w-4 h-4 animate-spin" /> Loading balance…
                            </div>
                          ) : (
                            <div className="text-2xl font-extrabold text-emerald-800">
                              ${walletBalance.toFixed(2)} <span className="text-sm font-bold">NZD</span>
                            </div>
                          )}
                          {!walletLoading && hasAmount && walletActive && (
                            <p className="text-xs text-emerald-700 mt-1">
                              {walletCoversFull
                                ? "Your wallet covers the full fare — no card needed."
                                : `$${walletApplied.toFixed(2)} from wallet · $${cardAmountDue.toFixed(2)} remaining on card`}
                            </p>
                          )}
                        </div>
                      </div>
                      {!walletLoading && walletBalance > 0 && hasAmount && effectiveCheckoutMethod === "card" && (
                        <div className="flex items-center gap-2 shrink-0">
                          <Label htmlFor="use-wallet-credit" className="text-xs font-bold text-emerald-800 cursor-pointer">
                            Use wallet credit
                          </Label>
                          <Switch
                            id="use-wallet-credit"
                            checked={useWalletCredit}
                            onCheckedChange={setUseWalletCredit}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                {walletCoversFull ? (
                  <>
                    <Button
                      onClick={handlePayWithWallet}
                      disabled={submitting || !hasAmount}
                      size="lg"
                      className="w-full bg-emerald-600 text-white hover:bg-emerald-700 rounded-full h-14 font-extrabold text-base shadow-lg"
                    >
                      {submitting ? (
                        <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Confirming…</>
                      ) : (
                        <><Wallet className="w-5 h-5 mr-2" /> Book with wallet — ${fareTotal.toFixed(2)} NZD</>
                      )}
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      No card required — fare will be deducted from your BookaWaka wallet.
                    </p>
                  </>
                ) : effectiveCheckoutMethod === "card" ? (
                  hasAmount ? (
                    <>
                      <Button
                        onClick={handlePayByCard}
                        disabled={submittingCard || (paymentMethod === "tm" && !tmPaymentReady)}
                        size="lg"
                        className="w-full bg-accent text-accent-foreground hover:bg-accent/90 rounded-full h-14 font-extrabold text-base shadow-lg"
                      >
                        {submittingCard ? (
                          <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Preparing payment…</>
                        ) : walletActive ? (
                          <><CreditCard className="w-5 h-5 mr-2" /> Pay NZD ${cardAmountDue.toFixed(2)} by Card</>
                        ) : (
                          <><CreditCard className="w-5 h-5 mr-2" /> Pay NZD ${fareTotal.toFixed(2)} by Card</>
                        )}
                      </Button>
                      {walletActive && (
                        <p className="text-center text-xs text-emerald-700 font-medium">
                          ${walletApplied.toFixed(2)} will be taken from your wallet · ${cardAmountDue.toFixed(2)} charged to card
                        </p>
                      )}
                      <p className="text-center text-xs text-muted-foreground">
                        Secured by Stripe — you'll be redirected to complete payment.
                      </p>
                    </>
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex items-start gap-3">
                      <CreditCard className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>Please enter the agreed fare amount above to continue with card payment.</span>
                    </div>
                  )
                ) : (
                  <Button
                    onClick={handleConfirmBooking}
                    disabled={!verified || submitting || (paymentMethod === "tm" && !tmPaymentReady)}
                    size="lg"
                    className="w-full bg-accent text-accent-foreground hover:bg-accent/90 rounded-full h-14 font-extrabold text-base shadow-lg disabled:opacity-50"
                  >
                    {submitting ? (
                      <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Sending booking…</>
                    ) : (
                      <><CheckCircle2 className="w-5 h-5 mr-2" /> Confirm Booking</>
                    )}
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Step 4: Success */}
          {step === 4 && (
            <div className="text-center py-8">
              {successCancelled ? (
                <>
                  <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 bg-destructive/10 text-destructive">
                    <XCircle className="w-10 h-10" />
                  </div>
                  <h1 className="text-3xl md:text-4xl font-display font-black text-foreground mb-3">Booking cancelled</h1>
                  <p className="text-muted-foreground font-medium mb-6 max-w-sm mx-auto">
                    Booking <span className="font-mono font-bold">{bookingId}</span> has been cancelled.
                  </p>
                  <a href="/my-rides">
                    <Button size="lg" className="rounded-full font-bold px-8">
                      View My Rides
                    </Button>
                  </a>
                </>
              ) : isEditingSuccessBooking ? (
                <div className="text-left max-w-lg mx-auto">
                  <h1 className="text-2xl font-display font-black text-foreground mb-2">Edit booking</h1>
                  <p className="text-sm text-muted-foreground mb-6">
                    Update pickup, drop-off{wasScheduled ? ", or scheduled time" : ""} before a driver is assigned.
                  </p>
                  <div className="space-y-4 bg-card border border-border rounded-2xl p-6 shadow-xl">
                    <div className="space-y-2">
                      <Label className="font-bold text-sm">Pickup</Label>
                      <AddressInput
                        id="successPick"
                        name="successPick"
                        value={successEditForm.pickAddress}
                        onChange={(val) => setSuccessEditForm((p) => ({ ...p, pickAddress: val }))}
                        placeholder="Pickup address"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-bold text-sm">Drop-off</Label>
                      <AddressInput
                        id="successDrop"
                        name="successDrop"
                        value={successEditForm.dropAddress}
                        onChange={(val) => setSuccessEditForm((p) => ({ ...p, dropAddress: val }))}
                        placeholder="Drop-off address"
                      />
                    </div>
                    {wasScheduled && (
                      <div className="space-y-2">
                        <Label className="font-bold text-sm">Scheduled time</Label>
                        <NzDateTimeInput
                          value={successEditForm.scheduledFor}
                          onChange={(val) => setSuccessEditForm((p) => ({ ...p, scheduledFor: val }))}
                          inputClassName="h-12"
                        />
                        <p className="text-xs text-muted-foreground">Tap Done to confirm the time.</p>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label className="font-bold text-sm">Notes</Label>
                      <Textarea
                        value={successEditForm.notes}
                        onChange={(e) => setSuccessEditForm((p) => ({ ...p, notes: e.target.value }))}
                        rows={3}
                        className="rounded-xl resize-none"
                      />
                    </div>
                    {successEditError && (
                      <p className="text-sm text-destructive">{successEditError}</p>
                    )}
                    <div className="flex gap-3 pt-2">
                      <Button
                        onClick={handleSaveSuccessEdit}
                        disabled={isSavingSuccessEdit}
                        className="flex-1 rounded-full font-bold"
                      >
                        {isSavingSuccessEdit ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
                        ) : (
                          "Save changes"
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setIsEditingSuccessBooking(false)}
                        disabled={isSavingSuccessEdit}
                        className="rounded-full font-bold"
                      >
                        Back
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
              <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${wasScheduled ? "bg-primary/10 text-primary" : selectedService === "food" ? "bg-orange-50 text-orange-600" : "bg-accent/20 text-accent-foreground"}`}>
                {wasScheduled ? <CalendarClock className="w-10 h-10" /> : selectedService === "food" ? <Utensils className="w-10 h-10" /> : <CheckCircle2 className="w-10 h-10" />}
              </div>
              <h1 className="text-3xl md:text-4xl font-display font-black text-foreground mb-3">
                {lastEditChanges?.length
                  ? "Booking updated"
                  : wasScheduled
                    ? "Ride scheduled!"
                    : selectedService === "food"
                      ? "Order placed!"
                      : "Booking sent!"}
              </h1>
              <p className="text-muted-foreground font-medium mb-2 max-w-sm mx-auto">
                {lastEditChanges?.length
                  ? <>Your changes to booking <strong className="font-mono">{bookingId}</strong> with <strong>{selectedCompany?.name}</strong> have been saved.</>
                  : wasScheduled
                  ? <>Your ride with <strong>{selectedCompany?.name}</strong> has been scheduled for <strong>{new Date(form.scheduledFor).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</strong>. Dispatch will be notified automatically before pickup.</>
                  : selectedService === "food"
                  ? <>Your order from <strong>{selectedRestaurant?.name}</strong> has been sent to <strong>{selectedCompany?.name}</strong>'s dispatch system.</>
                  : <>Your booking has been sent directly to <strong>{selectedCompany?.name}</strong>'s dispatch system.</>}
              </p>
              <p className="text-sm text-muted-foreground mb-2">Booking ID: <span className="font-mono font-bold text-foreground">{bookingId}</span></p>
              {(lastEditChanges?.length || form.notes?.trim() || form.pickAddress || form.dropAddress) && (
                <div className="max-w-sm mx-auto mb-6 text-left bg-muted/50 border border-border rounded-2xl px-5 py-4 space-y-2">
                  {lastEditChanges?.length ? (
                    <>
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">What changed</p>
                      <ul className="text-sm text-foreground space-y-1.5 list-disc pl-4">
                        {lastEditChanges.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  <div className="text-sm text-muted-foreground space-y-1 pt-1">
                    {form.pickAddress ? <p><span className="font-semibold text-foreground">Pickup:</span> {form.pickAddress}</p> : null}
                    {form.dropAddress ? <p><span className="font-semibold text-foreground">Drop-off:</span> {form.dropAddress}</p> : null}
                    {wasScheduled && form.scheduledFor ? (
                      <p>
                        <span className="font-semibold text-foreground">Time:</span>{" "}
                        {new Date(form.scheduledFor).toLocaleString("en-NZ", {
                          timeZone: "Pacific/Auckland",
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    ) : null}
                    {form.notes?.trim() ? (
                      <p><span className="font-semibold text-foreground">Notes:</span> {form.notes.trim()}</p>
                    ) : null}
                  </div>
                </div>
              )}
              {form.passengerEmail && (
                <p className="text-sm text-muted-foreground mb-6">A confirmation has been sent to <strong>{form.passengerEmail}</strong>.</p>
              )}
              {paidWithWallet && walletAppliedAtBooking > 0 && (
                <div className="inline-flex bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3 mb-6 text-sm text-emerald-800 items-center gap-2 max-w-sm mx-auto">
                  <Wallet className="w-4 h-4 shrink-0" />
                  Paid with wallet — ${walletAppliedAtBooking.toFixed(2)} NZD deducted
                </div>
              )}
              {selectedService !== "food" && paymentMethod !== "card" && !paidWithWallet && (
                <div className="inline-flex bg-muted/60 border border-border rounded-xl px-5 py-3 mb-6 text-sm text-muted-foreground items-center gap-2 max-w-sm mx-auto">
                  {paymentMethod === "account" && <><Wallet className="w-4 h-4 shrink-0" /> Account: {paymentRef}</>}
                  {paymentMethod === "acc" && <><Shield className="w-4 h-4 shrink-0" /> ACC claim: {paymentRef}</>}
                  {paymentMethod === "tm" && <><Ticket className="w-4 h-4 shrink-0" /> Total Mobility voucher: {paymentRef}</>}
                  {paymentMethod === "giftcard" && <><Gift className="w-4 h-4 shrink-0" /> Gift card: {paymentRef}</>}
                </div>
              )}

              {confirmCancelSuccess && (
                <div className="max-w-sm mx-auto mb-6 p-5 bg-destructive/5 border border-destructive/20 rounded-2xl text-left">
                  <p className="text-sm font-bold text-destructive mb-2">Cancel this booking?</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    This will cancel booking #{bookingId}. You can edit pickup or time instead if you only need to change details.
                  </p>
                  {successCancelError && (
                    <p className="text-sm text-destructive mb-3">{successCancelError}</p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleCancelSuccessBooking}
                      disabled={isCancellingSuccess}
                      className="rounded-full font-bold"
                    >
                      {isCancellingSuccess ? (
                        <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Cancelling…</>
                      ) : (
                        "Yes, cancel"
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setConfirmCancelSuccess(false); setSuccessCancelError(null); }}
                      disabled={isCancellingSuccess}
                      className="rounded-full font-bold"
                    >
                      Keep booking
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 justify-center mt-4">
                <Button
                  onClick={openSuccessEdit}
                  variant="outline"
                  size="lg"
                  className="rounded-full font-bold px-8"
                >
                  <Pencil className="w-5 h-5 mr-2" /> Edit booking
                </Button>
                <Button
                  onClick={() => { setConfirmCancelSuccess(true); setSuccessCancelError(null); }}
                  variant="outline"
                  size="lg"
                  className="rounded-full font-bold px-8 border-destructive/30 text-destructive hover:bg-destructive/5"
                >
                  <XCircle className="w-5 h-5 mr-2" /> Cancel booking
                </Button>
                <a href="/my-rides">
                  <Button size="lg" className="w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary/90 rounded-full font-bold px-8">
                    <CalendarClock className="w-5 h-5 mr-2" /> {wasScheduled ? "View My Scheduled Rides" : "My Rides"}
                  </Button>
                </a>
                <Button
                  onClick={() => {
                    setStep(0);
                    setSelectedCompany(null);
                    setSelectedService("");
                    setBookingType("now");
                    setForm({ passengerName: "", passengerPhone: "", passengerEmail: "", pickAddress: "", dropAddress: "", scheduledFor: "", notes: "", amount: "" });
                    setPassengers(1);
                    setVehicleType("Any");
                    setBookingId(null);
                    setWasScheduled(false);
                    setPaidByCard(false);
                    setPaidWithWallet(false);
                    setWalletAppliedAtBooking(0);
                    setUseWalletCredit(false);
                    setActiveBooking(null);
                    setIsEditingSuccessBooking(false);
                    setConfirmCancelSuccess(false);
                    setSuccessCancelled(false);
                    if (passengerKey) fetchWallet(passengerKey);
                    setError(null);
                    setSelectedRestaurant(null);
                    setCartItems([]);
                    setPickCoords(null);
                    setDropCoords(null);
                    setFareEstimate(null);
                    setPaymentMethod("card");
                    setPaymentRef("");
                    setVerified(false);
                    setVerifyError(null);
                  }}
                  variant="outline"
                  size="lg"
                  className="rounded-full font-bold px-8"
                >
                  Make another booking
                </Button>
                {!wasScheduled && (
                  <a href="/">
                    <Button size="lg" className="w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary/90 rounded-full font-bold px-8">
                      Back to BookaWaka
                    </Button>
                  </a>
                )}
              </div>
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4">
      <span className="text-sm font-bold text-muted-foreground w-24 flex-shrink-0">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function ActiveBookingAlert({ conflict }: { conflict: ActiveBookingConflict }) {
  return (
    <div className="mb-6 p-5 bg-amber-50 border border-amber-200 rounded-2xl text-left">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-amber-900">You already have an active booking</p>
          <p className="text-sm text-amber-800 mt-1">
            {conflict.message}
            {conflict.existingStatus && (
              <> · Status: <strong>{conflict.existingStatus}</strong></>
            )}
          </p>
          <a href="/my-rides" className="inline-block mt-3">
            <Button size="sm" className="rounded-full font-bold bg-amber-700 hover:bg-amber-800 text-white">
              View my booking
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}
