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
import { getOrCreatePassengerKey } from "@/lib/passengerKey";
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
  Clock,
  User,
  Phone,
  Mail,
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
}

/** Same set as passenger-app booking — used for dispatch VehicleType eligibility. */
const VEHICLE_TYPES = ["Sedan", "SUV", "Van", "Luxury", "Electric", "Wheelchair"] as const;
type VehicleTypeOption = (typeof VEHICLE_TYPES)[number];
const VEHICLE_LABELS: Record<VehicleTypeOption, string> = {
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
    }))
    .filter((c) => c.id);
}

interface Tariff {
  id: string;
  name: string;
  flagFall: number | null;
  ratePerKm: number | null;
  minFare: number | null;
  currency: string;
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

type PaymentMethod = "card" | "account" | "acc" | "tm" | "giftcard";

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
    help: "Secure card payment via Stripe. An estimated fare amount is required.",
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
    placeholder: "TM card / voucher number",
    help: "Total Mobility scheme. Enter your card or voucher number to verify.",
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
    notifyBefore: "30",
  });

  const [submitting, setSubmitting] = useState(false);
  const [submittingCard, setSubmittingCard] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [wasScheduled, setWasScheduled] = useState(false);
  const [paidByCard, setPaidByCard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [vehicleType, setVehicleType] = useState<VehicleTypeOption>("Sedan");
  const [paymentRef, setPaymentRef] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const verifyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [pickCoords, setPickCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dropCoords, setDropCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [pickAddressActive, setPickAddressActive] = useState(false);
  const [dropAddressActive, setDropAddressActive] = useState(false);
  const mapPointerEventsDisabled = pickAddressActive;
  const [fareEstimate, setFareEstimate] = useState<{ estimate: number; tariff: string; distanceKm: number } | null>(null);
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
        if (bal > 0) setUseWalletCredit(true);
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
    fetch(`${import.meta.env.BASE_URL}api/companies`)
      .then((r) => r.json())
      .then((d) => {
        const list = normalizeCompanies(d.companies);
        setCompanies(list);
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
      .catch(() => setCompanies([]))
      .finally(() => setLoadingCompanies(false));
  }, []);

  useEffect(() => {
    if (!selectedCompany) return;
    fetch(`${import.meta.env.BASE_URL}api/tariffs?cid=${selectedCompany.id}`)
      .then((r) => r.json())
      .then((d) => setTariffs(d.tariffs ?? []))
      .catch(() => setTariffs([]));
  }, [selectedCompany]);

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

  // Auto-verify payment reference for non-card methods with debounce
  useEffect(() => {
    if (paymentMethod === "card" || !selectedCompany) {
      setVerified(false);
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
      } catch {
        setVerified(false);
        setVerifyError("Could not verify. Please check your connection.");
      } finally {
        setVerifying(false);
      }
    }, 600);
  }, [paymentRef, paymentMethod, selectedCompany, fareEstimate]);

  const availablePaymentMethods = PAYMENT_METHODS.filter(
    (pm) => pm.value !== "card" || paymentConfig?.cardEnabled === true || paymentConfig == null
  );

  useEffect(() => {
    if (paymentConfig?.cardEnabled === false && paymentMethod === "card") {
      const fallback = PAYMENT_METHODS.find((pm) => pm.value !== "card");
      if (fallback) setPaymentMethod(fallback.value);
    }
  }, [paymentConfig, paymentMethod]);

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

        const r = await fetch(
          `${import.meta.env.BASE_URL}api/fare-estimate?cid=${selectedCompany.id}&fromLat=${pLat}&fromLng=${pLng}&toLat=${dLat}&toLng=${dLng}`
        );
        const d = await r.json();
        if (cancelled) return;
        if (d.estimatedFare != null) {
          setFareEstimate({ estimate: d.estimatedFare, tariff: d.tariffName ?? "", distanceKm: d.distanceKm ?? 0 });
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
  }, [pickCoords, dropCoords, form.pickAddress, form.dropAddress, selectedCompany, selectedService]);

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
    const refFields: Record<string, string> = {};
    if (method === "account" || method === "acc") refFields.accountNumber = paymentRef;
    if (method === "tm") refFields.tmCardNumber = paymentRef;
    if (method === "giftcard") refFields.giftCardCode = paymentRef;

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
        notifyDispatchBeforeMinutes:
          bookingType === "scheduled" && form.notifyBefore
            ? parseInt(form.notifyBefore)
            : undefined,
        notes: form.notes,
        amount: form.amount ? parseFloat(form.amount) : undefined,
        paymentMethod: method,
        vehicleType: selectedService === "taxi" ? vehicleType : undefined,
        pickLat: pickCoords?.lat ?? 0,
        pickLng: pickCoords?.lng ?? 0,
        dropLat: dropCoords?.lat ?? 0,
        dropLng: dropCoords?.lng ?? 0,
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

  const handlePayWithWallet = async () => {
    if (!form.passengerEmail.trim()) {
      setError("An email address is required to receive your booking confirmation");
      return;
    }
    if (!hasAmount) {
      setError("Please enter the fare amount to use wallet credit.");
      return;
    }
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
    setSubmitting(true);
    setError(null);
    try {
      const jobId = await reserveJobId();
      await createBooking(jobId, paymentMethod);
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
      const stripeData = await stripeRes.json();
      if (!stripeRes.ok) throw new Error(stripeData.error ?? "Could not start card payment");
      (window.top ?? window).location.href = stripeData.url;
    } catch (err: any) {
      handleBookingError(err);
    } finally {
      setSubmittingCard(false);
    }
  };

  const hasAmount = !!form.amount && parseFloat(form.amount) > 0;
  const fareTotal = hasAmount ? parseFloat(form.amount) : 0;
  const walletApplied =
    useWalletCredit && walletBalance > 0 && hasAmount
      ? Math.min(walletBalance, fareTotal)
      : 0;
  const cardAmountDue = hasAmount ? +(fareTotal - walletApplied).toFixed(2) : 0;
  const walletCoversFull = walletApplied > 0 && cardAmountDue <= 0;
  const walletActive = useWalletCredit && walletApplied > 0;
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
              <h1 className="text-3xl md:text-4xl font-display font-black text-foreground mb-2">Your details</h1>
              <p className="text-muted-foreground font-medium mb-8">
                <span className="font-bold text-foreground">{selectedCompany?.name}</span> · <span className="capitalize">{SERVICE_LABELS[selectedService]?.label ?? selectedService}</span>
                {selectedService === "food" && selectedRestaurant && (
                  <> · <span className="font-bold text-foreground">{selectedRestaurant.name}</span></>
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
                  if (paymentMethod !== "card") {
                    if (!paymentRef.trim()) {
                      setError(`Please enter your ${PAYMENT_METHODS.find((m) => m.value === paymentMethod)?.placeholder?.toLowerCase() ?? "payment reference"}.`);
                      return;
                    }
                    if (!verified) {
                      setError("Please wait for payment verification to complete.");
                      return;
                    }
                  }
                  setError(null);
                  setStep(3);
                }}
                className="space-y-5 bg-card border border-border rounded-[1.5rem] p-6 md:p-8 shadow-xl overflow-visible"
              >
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="passengerName" className="font-bold text-sm flex items-center gap-2"><User className="w-4 h-4 text-primary" /> Your Name <span className="text-destructive">*</span></Label>
                    <Input id="passengerName" name="passengerName" value={form.passengerName} onChange={handleChange} placeholder="e.g. Jane Smith" required className="rounded-xl h-12" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="passengerPhone" className="font-bold text-sm flex items-center gap-2"><Phone className="w-4 h-4 text-primary" /> Phone Number <span className="text-destructive">*</span></Label>
                    <Input id="passengerPhone" name="passengerPhone" value={form.passengerPhone} onChange={handleChange} placeholder="e.g. 021 123 4567" required className="rounded-xl h-12" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="passengerEmail" className="font-bold text-sm flex items-center gap-2">
                    <Mail className="w-4 h-4 text-primary" /> Email <span className="text-destructive">*</span>
                  </Label>
                  <Input id="passengerEmail" name="passengerEmail" type="email" value={form.passengerEmail} onChange={handleChange} placeholder="you@example.com" required className="rounded-xl h-12" />
                </div>

                <div
                  className={`space-y-2 relative ${pickAddressActive ? "z-[60]" : ""}`}
                >
                  <Label htmlFor="pickAddress" className="font-bold text-sm flex items-center gap-2">
                    {selectedService === "food" ? <Store className="w-4 h-4 text-primary" /> : <MapPin className="w-4 h-4 text-primary" />}
                    {selectedService === "food" ? "Restaurant Address" : "Pickup Address"}
                    <span className="text-destructive">*</span>
                  </Label>
                  {selectedService === "food" && selectedRestaurant ? (
                    <div className="rounded-xl h-12 border border-border bg-muted/40 flex items-center px-3 text-sm text-muted-foreground">
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
                      <p className="text-xs text-muted-foreground">Start typing — address suggestions will appear.</p>
                    </>
                  )}
                </div>

                <div
                  className={`space-y-2 relative ${dropAddressActive ? "z-[70]" : pickAddressActive ? "z-[1]" : ""}`}
                >
                  <Label htmlFor="dropAddress" className="font-bold text-sm flex items-center gap-2">
                    <Navigation className="w-4 h-4 text-primary" />
                    {selectedService === "food" ? "Delivery Address" : "Drop-off Address"}
                    <span className="text-destructive">*</span>
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

                {/* Live fare estimate — appears once both addresses are selected from suggestions */}
                {selectedService === "taxi" && (fareLoading || fareEstimate) && (
                  <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${fareEstimate ? "bg-emerald-50 border-emerald-200" : "bg-muted/40 border-border"}`}>
                    {fareLoading ? (
                      <><Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" /><span className="text-sm text-muted-foreground">Calculating fare estimate…</span></>
                    ) : fareEstimate ? (
                      <>
                        <DollarSign className="w-4 h-4 text-emerald-600 shrink-0" />
                        <div>
                          <span className="text-sm font-bold text-emerald-800">Estimated fare: ~${fareEstimate.estimate.toFixed(2)} NZD</span>
                          <span className="text-xs text-emerald-700 ml-2">({fareEstimate.distanceKm} km · {fareEstimate.tariff})</span>
                          <p className="text-xs text-emerald-700 mt-0.5">Final fare is set by the driver meter.</p>
                        </div>
                      </>
                    ) : null}
                  </div>
                )}

                {/* When — Now / Scheduled toggle */}
                <div className="space-y-3">
                  <Label className="font-bold text-sm flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /> When?</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setBookingType("now")}
                      className={`flex items-center justify-center gap-2 rounded-xl h-12 font-bold text-sm border-2 transition-all ${
                        bookingType === "now"
                          ? "bg-primary text-white border-primary shadow-md"
                          : "bg-card text-muted-foreground border-border hover:border-primary/50"
                      }`}
                    >
                      <Zap className="w-4 h-4" /> Now
                    </button>
                    <button
                      type="button"
                      onClick={() => setBookingType("scheduled")}
                      className={`flex items-center justify-center gap-2 rounded-xl h-12 font-bold text-sm border-2 transition-all ${
                        bookingType === "scheduled"
                          ? "bg-primary text-white border-primary shadow-md"
                          : "bg-card text-muted-foreground border-border hover:border-primary/50"
                      }`}
                    >
                      <CalendarClock className="w-4 h-4" /> Schedule
                    </button>
                  </div>
                  {bookingType === "scheduled" && (
                    <div className="space-y-3">
                      <Input
                        id="scheduledFor"
                        name="scheduledFor"
                        type="datetime-local"
                        value={form.scheduledFor}
                        onChange={handleChange}
                        required={bookingType === "scheduled"}
                        min={new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16)}
                        className="rounded-xl h-12"
                      />
                      <p className="text-xs text-muted-foreground">Choose a date and time at least 5 minutes from now.</p>
                      <div>
                        <p className="text-xs font-bold text-muted-foreground mb-2">Alert dispatch how many minutes before pickup?</p>
                        <div className="flex gap-2 flex-wrap">
                          {["15", "30", "45", "60"].map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setForm((prev) => ({ ...prev, notifyBefore: m }))}
                              className={`px-3 py-1.5 rounded-full text-sm font-bold border-2 transition-all ${form.notifyBefore === m ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}
                            >
                              {m} min
                            </button>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1.5">Dispatch will be notified this many minutes before the scheduled pickup time.</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Fare guide — pulled from tariffs/{cid}, isTM excluded */}
                {tariffs.length > 0 && selectedService === "taxi" && (
                  <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-2">
                    <p className="text-xs font-extrabold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                      <DollarSign className="w-3.5 h-3.5" /> Fare Guide
                    </p>
                    <div className="divide-y divide-border">
                      {tariffs.map((t) => (
                        <div key={t.id} className="py-2 first:pt-0 last:pb-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5">
                          <span className="text-sm font-bold text-foreground">{t.name}</span>
                          <div className="flex gap-3 text-xs text-muted-foreground">
                            {t.flagFall != null && (
                              <span>Flag fall <strong className="text-foreground">${t.flagFall.toFixed(2)}</strong></span>
                            )}
                            {t.ratePerKm != null && (
                              <span><strong className="text-foreground">${t.ratePerKm.toFixed(2)}</strong>/km</span>
                            )}
                            {t.minFare != null && (
                              <span>Min <strong className="text-foreground">${t.minFare.toFixed(2)}</strong></span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">Rates set by the operator. Actual fare depends on distance and time.</p>
                  </div>
                )}

                {/* Amount field — auto-filled from tariff estimate, editable */}
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2">
                  <Label htmlFor="amount" className="font-bold text-sm flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-primary" /> Fare (NZD)
                    {fareEstimate && (
                      <span className="text-emerald-700 font-normal text-xs">auto-calculated from tariff</span>
                    )}
                  </Label>
                  <Input
                    id="amount"
                    name="amount"
                    type="number"
                    min="0.50"
                    step="0.01"
                    value={form.amount}
                    onChange={handleChange}
                    placeholder="e.g. 24.50"
                    className="rounded-xl h-12 bg-white"
                  />
                  <p className="text-xs text-muted-foreground">
                    {fareEstimate
                      ? `Estimated from ${fareEstimate.tariff} tariff (${fareEstimate.distanceKm} km). You can adjust if needed. Required to pay by card.`
                      : "Auto-filled once both addresses are confirmed. Required to pay by card."}
                  </p>
                </div>

                {selectedService === "taxi" && (
                  <div className="space-y-3">
                    <Label className="font-bold text-sm">Vehicle type</Label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {VEHICLE_TYPES.map((vt) => (
                        <button
                          key={vt}
                          type="button"
                          onClick={() => setVehicleType(vt)}
                          className={`px-3 py-3 rounded-xl border-2 font-bold text-sm transition-all ${
                            vehicleType === vt
                              ? "bg-primary text-white border-primary shadow-md"
                              : "bg-card text-muted-foreground border-border hover:border-primary/50"
                          }`}
                        >
                          {VEHICLE_LABELS[vt]}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Accessible / WAV is required for wheelchair hoist trips. Dispatch will match this type when offering drivers.
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="notes" className="font-bold text-sm">Pickup notes for the driver</Label>
                  <Textarea
                    id="notes"
                    name="notes"
                    value={form.notes}
                    onChange={handleChange}
                    placeholder="Gate code, entrance, landmark, or other instructions for the driver…"
                    rows={3}
                    className="rounded-xl resize-none"
                  />
                  <p className="text-xs text-muted-foreground">One-way note — the driver can read this on the job; you cannot change it after a driver is assigned.</p>
                </div>

                {/* Payment method — selected here, locked on confirm step */}
                <div className="space-y-4 pt-2 border-t border-border">
                  <h2 className="text-sm font-extrabold uppercase tracking-widest text-muted-foreground">
                    How would you like to pay?
                  </h2>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {availablePaymentMethods.map((pm) => (
                      <button
                        key={pm.value}
                        type="button"
                        onClick={() => {
                          setPaymentMethod(pm.value);
                          setPaymentRef("");
                          setVerified(false);
                          setVerifyError(null);
                          setError(null);
                        }}
                        className={`flex items-center gap-2 px-3 py-3 rounded-xl border-2 font-bold text-sm transition-all ${
                          paymentMethod === pm.value
                            ? "bg-primary text-white border-primary shadow-md"
                            : "bg-card text-muted-foreground border-border hover:border-primary/50"
                        }`}
                      >
                        {pm.icon}
                        <span className="leading-tight">{pm.label}</span>
                      </button>
                    ))}
                  </div>

                  {paymentMethod !== "card" && (() => {
                    const pm = availablePaymentMethods.find((m) => m.value === paymentMethod)!;
                    return (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">{pm.help}</p>
                        <div className="relative">
                          <Input
                            value={paymentRef}
                            onChange={(e) => setPaymentRef(e.target.value)}
                            placeholder={pm.placeholder}
                            className="rounded-xl h-12 pr-10"
                            autoComplete="off"
                          />
                          {verifying && (
                            <Loader2 className="absolute right-3 top-3.5 w-5 h-5 animate-spin text-muted-foreground pointer-events-none" />
                          )}
                          {!verifying && verified && (
                            <CheckCircle2 className="absolute right-3 top-3.5 w-5 h-5 text-emerald-600 pointer-events-none" />
                          )}
                        </div>
                        {!verifying && verifyError && (
                          <p className="text-sm text-destructive flex items-center gap-1.5">
                            <AlertTriangle className="w-4 h-4 shrink-0" /> {verifyError}
                          </p>
                        )}
                        {!verifying && verified && (
                          <p className="text-sm text-emerald-700 font-medium flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 shrink-0" /> Verified — you're good to book
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {paymentMethod === "card" && (
                    <>
                      <p className="text-xs text-muted-foreground">{PAYMENT_METHODS[0].help}</p>
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>
                          <strong>Cancellation policy:</strong> if you cancel before a driver is assigned,
                          the fare is added to your <strong>BookaWaka wallet</strong> as credit (linked to your phone number)
                          — not refunded to your card. You can spend wallet credit on your next booking.
                          If a driver has already been assigned, no credit is issued.
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {error && (
                  <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm font-medium">
                    {error}
                  </div>
                )}

                <Button type="submit" size="lg" className="w-full bg-primary text-primary-foreground hover:bg-primary/90 rounded-full h-14 font-extrabold text-base shadow-lg">
                  Review Booking <ChevronRight className="w-5 h-5 ml-2" />
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

              <div className="bg-card border border-border rounded-[1.5rem] p-6 md:p-8 shadow-xl space-y-4 mb-6">
                <Row label="Company" value={selectedCompany?.name ?? ""} />
                {selectedCompany?.operatingHours && (
                  <Row label="Operating hours" value={selectedCompany.operatingHours} />
                )}
                <Row label="Service" value={SERVICE_LABELS[selectedService]?.label ?? selectedService} />
                {selectedService === "food" && selectedRestaurant && <Row label="Restaurant" value={selectedRestaurant.name} />}
                {selectedService === "taxi" && (
                  <Row label="Vehicle" value={VEHICLE_LABELS[vehicleType]} />
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
                {bookingType === "scheduled" && form.notifyBefore && (
                  <Row label="Dispatch alert" value={`${form.notifyBefore} minutes before pickup`} />
                )}
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
                    <Row label="Amount" value={`NZD $${fareTotal.toFixed(2)}`} />
                    {walletActive && (
                      <>
                        <Row label="Wallet credit" value={`- $${walletApplied.toFixed(2)}`} />
                        <Row
                          label={walletCoversFull ? "Due" : "Card due"}
                          value={walletCoversFull ? "Fully covered by wallet" : `NZD $${cardAmountDue.toFixed(2)}`}
                        />
                      </>
                    )}
                  </>
                )}
                <hr className="border-border" />
                <Row
                  label="Payment"
                  value={
                    walletCoversFull && useWalletCredit
                      ? "BookaWaka Wallet"
                      : paymentMethod === "card"
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

                {(walletLoading || walletBalance > 0) && (
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
                      {!walletLoading && walletBalance > 0 && hasAmount && paymentMethod === "card" && (
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
                {walletCoversFull && useWalletCredit ? (
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
                ) : paymentMethod === "card" ? (
                  hasAmount ? (
                    <>
                      <Button
                        onClick={handlePayByCard}
                        disabled={submittingCard}
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
                    disabled={!verified || submitting}
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
                        <Input
                          type="datetime-local"
                          value={successEditForm.scheduledFor}
                          onChange={(e) => setSuccessEditForm((p) => ({ ...p, scheduledFor: e.target.value }))}
                          className="rounded-xl h-12"
                        />
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
                {wasScheduled ? "Ride scheduled!" : selectedService === "food" ? "Order placed!" : "Booking sent!"}
              </h1>
              <p className="text-muted-foreground font-medium mb-2 max-w-sm mx-auto">
                {wasScheduled
                  ? <>Your ride with <strong>{selectedCompany?.name}</strong> has been scheduled for <strong>{new Date(form.scheduledFor).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</strong>. Dispatch will be alerted {form.notifyBefore} minutes before pickup.</>
                  : selectedService === "food"
                  ? <>Your order from <strong>{selectedRestaurant?.name}</strong> has been sent to <strong>{selectedCompany?.name}</strong>'s dispatch system.</>
                  : <>Your booking has been sent directly to <strong>{selectedCompany?.name}</strong>'s dispatch system.</>}
              </p>
              <p className="text-sm text-muted-foreground mb-2">Booking ID: <span className="font-mono font-bold text-foreground">{bookingId}</span></p>
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
                    setForm({ passengerName: "", passengerPhone: "", passengerEmail: "", pickAddress: "", dropAddress: "", scheduledFor: "", notes: "", amount: "", notifyBefore: "30" });
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

function toNZDatetimeLocal(isoOrMs: string | number | undefined): string {
  if (isoOrMs == null || isoOrMs === "" || isoOrMs === 0) return "";
  const d = new Date(isoOrMs);
  if (isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

function fromNZDatetimeLocal(localStr: string): string {
  if (!localStr) throw new Error("No scheduled time entered");
  const utcNow = new Date();
  const nzNow = new Date(utcNow.toLocaleString("en-US", { timeZone: "Pacific/Auckland" }));
  const offsetMs = utcNow.getTime() - nzNow.getTime();
  const [datePart, timePart] = localStr.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  const nzAsUtc = Date.UTC(y, m - 1, d, hh, mm);
  return new Date(nzAsUtc + offsetMs).toISOString();
}
