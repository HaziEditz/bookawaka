import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setPassengerSession } from "@/lib/passengerKey";
import { Lock, User, ArrowLeft, Loader2 } from "lucide-react";

export default function SignInPage() {
  const [, setLocation] = useLocation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!identifier.trim() || !password) {
      setError("Enter your email or phone number, and password.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/passenger-auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Sign in failed");
      setPassengerSession({
        uid: d.uid,
        email: d.email || "",
        name: d.name || "",
        phone: d.phone || "",
        idToken: d.idToken,
        refreshToken: d.refreshToken,
      });
      const next = new URLSearchParams(window.location.search).get("next") || "/book";
      setLocation(next);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign in failed");
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
          <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
          <p className="text-slate-400 mt-2">Email or phone number plus your password. Guest booking is not available.</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
          <div className="space-y-2">
            <Label htmlFor="identifier">Email or phone</Label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input
                id="identifier"
                className="pl-9 bg-slate-950 border-slate-700"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                placeholder="you@email.com or 021…"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input
                id="password"
                type="password"
                className="pl-9 bg-slate-950 border-slate-700"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign In"}
          </Button>
          <div className="flex flex-col gap-2 text-sm text-center text-slate-400">
            <Link href="/forgot-password" className="text-sky-400 hover:underline">
              Forgot password?
            </Link>
            <Link href="/create-account" className="text-sky-400 hover:underline">
              Create an account
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
