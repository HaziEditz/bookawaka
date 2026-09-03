import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setPassengerSession } from "@/lib/passengerKey";
import { ArrowLeft, ChevronDown, Loader2, Lock, Mail, User } from "lucide-react";

interface CountryCode {
  code: string;
  flag: string;
  name: string;
  label: string;
}

const COUNTRY_CODES: CountryCode[] = [
  { code: "64", flag: "🇳🇿", name: "New Zealand",   label: "+64" },
  { code: "61", flag: "🇦🇺", name: "Australia",     label: "+61" },
  { code: "1",  flag: "🇺🇸", name: "USA / Canada",  label: "+1"  },
  { code: "44", flag: "🇬🇧", name: "United Kingdom", label: "+44" },
  { code: "65", flag: "🇸🇬", name: "Singapore",     label: "+65" },
  { code: "91", flag: "🇮🇳", name: "India",         label: "+91" },
  { code: "86", flag: "🇨🇳", name: "China",         label: "+86" },
  { code: "81", flag: "🇯🇵", name: "Japan",         label: "+81" },
  { code: "82", flag: "🇰🇷", name: "South Korea",   label: "+82" },
  { code: "33", flag: "🇫🇷", name: "France",        label: "+33" },
  { code: "49", flag: "🇩🇪", name: "Germany",       label: "+49" },
  { code: "39", flag: "🇮🇹", name: "Italy",         label: "+39" },
  { code: "34", flag: "🇪🇸", name: "Spain",         label: "+34" },
  { code: "7",  flag: "🇷🇺", name: "Russia",        label: "+7"  },
  { code: "55", flag: "🇧🇷", name: "Brazil",        label: "+55" },
  { code: "52", flag: "🇲🇽", name: "Mexico",        label: "+52" },
  { code: "27", flag: "🇿🇦", name: "South Africa",  label: "+27" },
  { code: "66", flag: "🇹🇭", name: "Thailand",      label: "+66" },
  { code: "62", flag: "🇮🇩", name: "Indonesia",     label: "+62" },
  { code: "63", flag: "🇵🇭", name: "Philippines",   label: "+63" },
  { code: "84", flag: "🇻🇳", name: "Vietnam",       label: "+84" },
  { code: "60", flag: "🇲🇾", name: "Malaysia",      label: "+60" },
];

/** Strip leading zeros that users may type after selecting a country code. */
function stripLeadingZero(local: string): string {
  return local.replace(/^0+/, "");
}

/** Build canonical digits: countryCode + local digits (no leading zero). */
function buildCanonical(countryCode: string, localRaw: string): string {
  const localDigits = localRaw.replace(/\D/g, "");
  const stripped = stripLeadingZero(localDigits);
  return stripped ? countryCode + stripped : "";
}

export default function CreateAccountPage() {
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // country code selector
  const [countryCode, setCountryCode] = useState<CountryCode>(COUNTRY_CODES[0]);
  const [localPhone, setLocalPhone] = useState("");
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canonicalPhone = buildCanonical(countryCode.code, localPhone);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim() || !canonicalPhone || password.length < 6) {
      setError("Name, email, phone, and a password of at least 6 characters are required.");
      return;
    }
    if (canonicalPhone.length < 7) {
      setError("Please enter a valid phone number.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/passenger-auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: canonicalPhone,
          password,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not create account");
      setPassengerSession({
        uid: d.uid,
        email: d.email || "",
        name: d.name || name.trim(),
        phone: d.phone || canonicalPhone,
        idToken: d.idToken,
        refreshToken: d.refreshToken,
      });
      setLocation("/book");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Back to home
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Create account</h1>
          <p className="text-slate-400 mt-2">
            Use email or phone with a password. You must sign in to book — no guest access.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
          <div className="space-y-2">
            <Label htmlFor="name">Full name</Label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input id="name" className="pl-9 bg-slate-950 border-slate-700" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input id="email" type="email" className="pl-9 bg-slate-950 border-slate-700" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Phone number</Label>
            <div className="flex gap-0 rounded-lg overflow-hidden border border-slate-700 bg-slate-950 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0 relative">
              {/* Country code button */}
              <button
                type="button"
                onClick={() => setShowCountryPicker((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-2 border-r border-slate-700 bg-slate-900 text-sm font-medium whitespace-nowrap hover:bg-slate-800 transition-colors"
              >
                <span className="text-base">{countryCode.flag}</span>
                <span>{countryCode.label}</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>
              {/* Local number */}
              <input
                id="phone"
                type="tel"
                value={localPhone}
                onChange={(e) => setLocalPhone(e.target.value.replace(/[^0-9\s\-()]/g, ""))}
                placeholder="21 123 4567"
                className="flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-slate-500"
              />
              {/* Country picker dropdown */}
              {showCountryPicker && (
                <div className="absolute top-full left-0 z-50 mt-1 w-72 max-h-72 overflow-y-auto bg-slate-900 border border-slate-700 rounded-xl shadow-xl">
                  {COUNTRY_CODES.map((c) => (
                    <button
                      key={c.code + c.name}
                      type="button"
                      onClick={() => { setCountryCode(c); setShowCountryPicker(false); }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-800 transition-colors text-left ${countryCode.code === c.code && countryCode.name === c.name ? "bg-slate-800" : ""}`}
                    >
                      <span className="text-base">{c.flag}</span>
                      <span className="flex-1 text-slate-200">{c.name}</span>
                      <span className="text-slate-400">{c.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input id="password" type="password" className="pl-9 bg-slate-950 border-slate-700" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Account"}
          </Button>
          <p className="text-sm text-center text-slate-400">
            Already have an account?{" "}
            <Link href="/sign-in" className="text-sky-400 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
