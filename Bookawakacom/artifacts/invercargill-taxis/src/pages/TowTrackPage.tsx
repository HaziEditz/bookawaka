import { useState, useEffect, useRef } from "react";
import { Truck, Navigation, Search, CheckCircle2, Clock, MapPin, Hash, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function TowTrackPage() {
  const [jobId, setJobId] = useState("");
  const [inputId, setInputId] = useState("");
  const [loading, setLoading] = useState(false);
  const [job, setJob] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const jobRef = useRef<any>(null);

  useEffect(() => {
    document.documentElement.dataset.liveTripTracking = jobId ? "1" : "";
    return () => {
      document.documentElement.dataset.liveTripTracking = "";
    };
  }, [jobId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (id) {
      setInputId(id);
      setJobId(id);
    }
  }, []);

  useEffect(() => {
    jobRef.current = job;
  }, [job]);

  useEffect(() => {
    if (!jobId) return;

    const doFetch = () => {
      setLoading(true);
      setError(null);
      fetch(`/api/tow/${encodeURIComponent(jobId)}`)
        .then((r) => r.json())
        .then((data) => {
          if (!data.ok) throw new Error(data.error ?? "Job not found. Check the ID and try again.");
          setJob(data);
        })
        .catch((err) => setError(err.message ?? "Job not found. Check the ID and try again."))
        .finally(() => setLoading(false));
    };

    doFetch();

    const interval = setInterval(() => {
      const current = jobRef.current;
      if (current && (current.status === "completed" || current.status === "cancelled")) return;
      doFetch();
    }, 30000);

    return () => clearInterval(interval);
  }, [jobId]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setJob(null);
    setJobId(inputId.trim());
  };

  const statusColor: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
    assigned: "bg-blue-100 text-blue-800 border-blue-200",
    "en-route": "bg-blue-100 text-blue-800 border-blue-200",
    completed: "bg-green-100 text-green-800 border-green-200",
    cancelled: "bg-red-100 text-red-800 border-red-200",
  };

  const statusLabel: Record<string, string> = {
    pending: "Pending — finding nearest operator",
    assigned: "Operator assigned — on the way",
    "en-route": "Driver en route to your location",
    completed: "Job completed",
    cancelled: "Job cancelled",
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/30 flex flex-col">
      <header className="bg-foreground text-white px-6 py-4 flex items-center justify-between shadow-xl">
        <a href="/" className="flex items-center gap-2 group">
          <div className="bg-primary text-primary-foreground p-2 rounded-xl rotate-3 group-hover:rotate-0 transition-transform">
            <Navigation className="w-5 h-5" />
          </div>
          <span className="font-display font-extrabold text-xl tracking-tight">BookaWaka</span>
        </a>
        <a href="/tow">
          <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-full font-bold">
            <Truck className="w-4 h-4 mr-1.5" /> Request a Tow
          </Button>
        </a>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 py-12">
        <div className="w-full max-w-xl">
          <a href="/towing" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6 font-medium text-sm">
            ← Back to Towing
          </a>

          <div className="flex items-center gap-4 mb-8">
            <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
              <MapPin className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-display font-black">Track Your Tow</h1>
              <p className="text-muted-foreground text-sm font-medium">Enter the Job ID from your confirmation email.</p>
            </div>
          </div>

          <form onSubmit={handleSearch} className="bg-card border border-border rounded-[1.5rem] p-6 shadow-xl mb-6">
            <div className="space-y-2 mb-4">
              <Label htmlFor="jobId" className="font-bold text-sm flex items-center gap-2">
                <Hash className="w-4 h-4 text-primary" /> Job ID
              </Label>
              <Input
                id="jobId"
                value={inputId}
                onChange={(e) => setInputId(e.target.value)}
                placeholder="e.g. ABC2505010001"
                required
                className="rounded-xl h-12 font-mono"
              />
            </div>
            <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary/90 rounded-full h-12 font-bold" disabled={loading}>
              {loading ? "Looking up…" : <><Search className="w-4 h-4 mr-2" /> Track Job</>}
            </Button>
          </form>

          {error && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm font-medium mb-6">{error}</div>
          )}

          {job && (
            <div className="bg-card border border-border rounded-[1.5rem] p-6 shadow-xl space-y-5">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2 font-mono font-bold text-sm text-muted-foreground">
                  <Hash className="w-4 h-4" /> {jobId}
                </div>
                <span className={`text-xs font-extrabold uppercase tracking-wider px-3 py-1.5 rounded-full border ${statusColor[job.status] ?? "bg-muted text-muted-foreground border-border"}`}>
                  {job.status ?? "Unknown"}
                </span>
              </div>

              <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-xl">
                {(job.status === "completed")
                  ? <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  : <Clock className="w-5 h-5 text-primary flex-shrink-0 mt-0.5 animate-pulse" />
                }
                <p className="text-sm font-bold">{statusLabel[job.status] ?? "Status unknown — contact us for details."}</p>
              </div>

              {job.location && (
                <div className="flex items-center gap-3 text-sm font-medium">
                  <MapPin className="w-4 h-4 text-primary flex-shrink-0" />
                  <span className="font-bold">Vehicle location:</span>
                  <span>{job.location}</span>
                </div>
              )}

              {job.destination && (
                <div className="flex items-center gap-3 text-sm font-medium">
                  <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="font-bold">Towing to:</span>
                  <span>{job.destination}</span>
                </div>
              )}

              {job.driverName && (
                <div className="text-sm font-medium text-muted-foreground">Driver: <span className="font-bold text-foreground">{job.driverName}</span></div>
              )}

              {job.status !== "completed" && job.status !== "cancelled" && (
                <p className="text-xs text-muted-foreground text-center pt-2">Page refreshes automatically every 30 seconds.</p>
              )}
            </div>
          )}

          {!job && !error && !loading && jobId && (
            <div className="text-center py-8 text-muted-foreground">
              <Truck className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium text-sm">No job found for that ID.</p>
            </div>
          )}

          <div className="mt-8 text-center">
            <p className="text-sm text-muted-foreground mb-3">Don't have a job yet?</p>
            <a href="/tow">
              <Button size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-full font-bold px-8">
                Request a Tow <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </a>
          </div>
        </div>
      </main>

      <footer className="bg-foreground text-white/60 text-sm text-center py-6 px-6">
        <p>&copy; {new Date().getFullYear()} BookaWaka. All rights reserved. &mdash; <a href="/" className="hover:text-white transition-colors">Back to home</a></p>
      </footer>
    </div>
  );
}
