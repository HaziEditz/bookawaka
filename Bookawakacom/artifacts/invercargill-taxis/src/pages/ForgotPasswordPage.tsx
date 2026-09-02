import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, User } from "lucide-react";

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSentTo(null);
    if (!identifier.trim()) {
      setError("Enter the email or phone number for your account.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/passenger-auth/forgot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not send reset email");
      setSentTo(d.email || identifier.trim());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not send reset email");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <Link href="/sign-in" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Back to sign in
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Forgot password</h1>
          <p className="text-slate-400 mt-2">
            Enter your email or phone number. We send a reset link to the email on your account.
          </p>
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
              />
            </div>
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          {sentTo ? (
            <p className="text-sm text-emerald-400">
              Password reset email sent to {sentTo}. Check inbox and spam.
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send reset link"}
          </Button>
        </form>
      </div>
    </div>
  );
}
