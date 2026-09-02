import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setPassengerSession } from "@/lib/passengerKey";
import { ArrowLeft, Loader2, Lock, Mail, Phone, User } from "lucide-react";

export default function CreateAccountPage() {
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !phone.trim() || password.length < 6) {
      setError("Name, phone, and a password of at least 6 characters are required. Email is optional.");
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
          phone: phone.trim(),
          password,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not create account");
      setPassengerSession({
        uid: d.uid,
        email: d.email || "",
        name: d.name || name.trim(),
        phone: d.phone || "",
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
            <Label htmlFor="email">Email (optional if using phone)</Label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input id="email" type="email" className="pl-9 bg-slate-950 border-slate-700" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone number</Label>
            <div className="relative">
              <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input id="phone" className="pl-9 bg-slate-950 border-slate-700" value={phone} onChange={(e) => setPhone(e.target.value)} />
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
