import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { 
  MapPin, 
  Clock, 
  Car, 
  ShieldCheck, 
  CheckCircle2, 
  Navigation,
  Utensils,
  Package,
  Star,
  ChevronRight,
  ChevronDown,
  Menu,
  X,
  Zap,
  Users,
  TrendingUp,
  BadgeCheck,
  ArrowRight,
  Mail,
  Send,
  Loader2,
  KeyRound,
  Truck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { getPassengerSession } from "@/lib/passengerKey";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import NotFound from "@/pages/not-found";
import BookPage from "@/pages/BookPage";
import RegisterPage from "@/pages/RegisterPage";
import MyRidesPage from "@/pages/MyRidesPage";
import SignInPage from "@/pages/SignInPage";
import CreateAccountPage from "@/pages/CreateAccountPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import RentPage from "@/pages/RentPage";
import TaxiPage from "@/pages/TaxiPage";
import FoodPage from "@/pages/FoodPage";
import FreightPage from "@/pages/FreightPage";
import TowingPage from "@/pages/TowingPage";
import TowRequestPage from "@/pages/TowRequestPage";
import TowTrackPage from "@/pages/TowTrackPage";
import PaymentSuccessPage from "@/pages/PaymentSuccessPage";
import PaymentCancelPage from "@/pages/PaymentCancelPage";
import PassengerAppReturnPage from "@/pages/PassengerAppReturnPage";
import PassengerAppCancelPage from "@/pages/PassengerAppCancelPage";

const queryClient = new QueryClient();

function FadeIn({ children, delay = 0, direction = "up", className = "" }: { children: React.ReactNode, delay?: number, direction?: "up" | "left" | "right" | "none", className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("opacity-100", "translate-y-0", "translate-x-0");
          entry.target.classList.remove("opacity-0", "translate-y-12", "-translate-x-12", "translate-x-12");
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -50px 0px" }
    );
    
    if (ref.current) {
      observer.observe(ref.current);
    }
    return () => observer.disconnect();
  }, []);

  const translateClass = direction === "up" ? "translate-y-12" : direction === "left" ? "-translate-x-12" : direction === "right" ? "translate-x-12" : "";

  return (
    <div 
      ref={ref} 
      className={`opacity-0 ${translateClass} transition-all duration-1000 ease-out ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
      data-testid="fade-in-container"
    >
      {children}
    </div>
  );
}

function ContactSection() {
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      setSubmitted(true);
      setForm({ name: "", email: "", subject: "", message: "" });
    } catch (err: any) {
      toast({ title: "Couldn't send message", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="contact" className="py-32 bg-background" data-testid="section-contact">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-start">
          <FadeIn direction="left">
            <h2 className="text-sm font-extrabold tracking-widest text-primary uppercase mb-4">Get In Touch</h2>
            <h3 className="text-4xl md:text-5xl lg:text-6xl font-display font-black text-foreground mb-8 leading-tight">We'd love to<br /><span className="text-primary">hear from you.</span></h3>
            <p className="text-lg text-muted-foreground font-medium mb-10 leading-relaxed">
              Have a question about our services, want to partner with us, or just want to say hi? Send us a message and we'll get back to you as soon as we can.
            </p>
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center text-primary flex-shrink-0">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-1">Email</div>
                  <a href="mailto:info@bookawaka.com" className="font-bold text-foreground hover:text-primary transition-colors">info@bookawaka.com</a>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center text-primary flex-shrink-0">
                  <MapPin className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-1">Based In</div>
                  <div className="font-bold text-foreground">Invercargill, Southland, New Zealand</div>
                </div>
              </div>
            </div>
          </FadeIn>

          <FadeIn direction="right">
            <div className="bg-card border border-border rounded-[2rem] p-8 md:p-10 shadow-xl">
              {submitted ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary mx-auto mb-6">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <h4 className="text-2xl font-display font-black text-foreground mb-3">Message sent!</h4>
                  <p className="text-muted-foreground font-medium mb-8">Thanks for reaching out. We'll get back to you soon.</p>
                  <Button variant="outline" onClick={() => setSubmitted(false)} className="rounded-full font-bold px-8">Send another</Button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6" data-testid="form-contact">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="contact-name" className="font-bold text-sm">Your Name <span className="text-destructive">*</span></Label>
                      <Input id="contact-name" name="name" placeholder="e.g. Jane Smith" value={form.name} onChange={handleChange} required className="rounded-xl h-12" data-testid="input-contact-name" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="contact-email" className="font-bold text-sm">Email Address <span className="text-destructive">*</span></Label>
                      <Input id="contact-email" name="email" type="email" placeholder="you@example.com" value={form.email} onChange={handleChange} required className="rounded-xl h-12" data-testid="input-contact-email" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contact-subject" className="font-bold text-sm">Subject</Label>
                    <Input id="contact-subject" name="subject" placeholder="What's it about?" value={form.subject} onChange={handleChange} className="rounded-xl h-12" data-testid="input-contact-subject" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contact-message" className="font-bold text-sm">Message <span className="text-destructive">*</span></Label>
                    <Textarea id="contact-message" name="message" placeholder="Tell us what you need..." value={form.message} onChange={handleChange} required rows={5} className="rounded-xl resize-none" data-testid="input-contact-message" />
                  </div>
                  <Button type="submit" size="lg" disabled={submitting} className="w-full bg-primary text-primary-foreground hover:bg-primary/90 rounded-full h-14 font-extrabold text-base shadow-lg" data-testid="btn-contact-submit">
                    {submitting ? (
                      <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Sending...</>
                    ) : (
                      <><Send className="w-5 h-5 mr-2" /> Send Message</>
                    )}
                  </Button>
                </form>
              )}
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

function useAppVersions() {
  const [versions, setVersions] = useState<{ driverAppMinVersion: string | null; passengerAppMinVersion: string | null } | null>(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/app-settings`)
      .then((r) => r.json())
      .then(setVersions)
      .catch(() => {});
  }, []);
  return versions;
}

function Home() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const appVersions = useAppVersions();

  const handleBookNow = () => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const session = getPassengerSession();
    if (!session?.uid) {
      window.location.href = `${base}/sign-in?next=/book`;
      return;
    }
    window.location.href = `${base}/book`;
  };

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-background font-sans text-foreground selection:bg-accent selection:text-accent-foreground overflow-x-hidden" data-testid="page-home">
      {/* Navigation */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${isScrolled ? "bg-background/95 backdrop-blur-xl border-b border-border/40 py-4 shadow-sm" : "bg-transparent py-6"}`} data-testid="navbar">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-2" data-testid="brand-logo">
            <div className="bg-primary text-primary-foreground p-2 rounded-xl rotate-3 shadow-md">
              <Navigation className="w-6 h-6" />
            </div>
            <span className={`font-display font-extrabold text-2xl tracking-tight ${isScrolled ? "text-foreground" : "text-white"}`}>
              BookaWaka
            </span>
          </div>
          
          <div className="hidden lg:flex items-center gap-8">
            {/* Services dropdown */}
            <div className="relative" onMouseEnter={() => setServicesOpen(true)} onMouseLeave={() => setServicesOpen(false)}>
              <button
                className={`flex items-center gap-1 text-sm font-bold transition-colors ${isScrolled ? "text-foreground/80 hover:text-primary" : "text-white/90 hover:text-accent"}`}
                data-testid="nav-link-services"
              >
                Services <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${servicesOpen ? "rotate-180" : ""}`} />
              </button>
              {servicesOpen && (
                <div className="absolute top-full left-0 mt-2 w-52 bg-background border border-border rounded-2xl shadow-2xl py-2 z-50">
                  <a href={`${import.meta.env.BASE_URL}taxi`} className="flex items-center gap-3 px-4 py-2.5 text-sm font-bold hover:bg-muted transition-colors rounded-xl mx-1"><Car className="w-4 h-4 text-primary" /> Taxi &amp; Transfers</a>
                  <a href={`${import.meta.env.BASE_URL}food`} className="flex items-center gap-3 px-4 py-2.5 text-sm font-bold hover:bg-muted transition-colors rounded-xl mx-1"><Utensils className="w-4 h-4 text-primary" /> Food Delivery</a>
                  <a href={`${import.meta.env.BASE_URL}freight`} className="flex items-center gap-3 px-4 py-2.5 text-sm font-bold hover:bg-muted transition-colors rounded-xl mx-1"><Package className="w-4 h-4 text-primary" /> Freight &amp; Couriers</a>
                  <a href={`${import.meta.env.BASE_URL}towing`} className="flex items-center gap-3 px-4 py-2.5 text-sm font-bold hover:bg-muted transition-colors rounded-xl mx-1"><Truck className="w-4 h-4 text-primary" /> Towing &amp; Recovery</a>
                  <a href={`${import.meta.env.BASE_URL}rent`} className="flex items-center gap-3 px-4 py-2.5 text-sm font-bold hover:bg-muted transition-colors rounded-xl mx-1"><KeyRound className="w-4 h-4 text-primary" /> Rental Cars</a>
                </div>
              )}
            </div>
            <a href="#areas" className={`text-sm font-bold transition-colors ${isScrolled ? "text-foreground/80 hover:text-primary" : "text-white/90 hover:text-accent"}`} data-testid="nav-link-areas">Areas</a>
            <a href="#about" className={`text-sm font-bold transition-colors ${isScrolled ? "text-foreground/80 hover:text-primary" : "text-white/90 hover:text-accent"}`} data-testid="nav-link-about">About</a>
            <a href="#testimonials" className={`text-sm font-bold transition-colors ${isScrolled ? "text-foreground/80 hover:text-primary" : "text-white/90 hover:text-accent"}`} data-testid="nav-link-reviews">Reviews</a>
            <a href="#operators" className={`text-sm font-bold transition-colors ${isScrolled ? "text-accent hover:text-primary" : "text-accent hover:text-white"}`} data-testid="nav-link-operators">For Operators</a>
            <a href="#contact" className={`text-sm font-bold transition-colors ${isScrolled ? "text-foreground/80 hover:text-primary" : "text-white/90 hover:text-accent"}`} data-testid="nav-link-contact">Contact</a>
            <a href={`${import.meta.env.BASE_URL}my-rides`} className={`text-sm font-bold transition-colors ${isScrolled ? "text-foreground/80 hover:text-primary" : "text-white/90 hover:text-accent"}`} data-testid="nav-link-my-rides">My Rides</a>
            <a href={`${import.meta.env.BASE_URL}sign-in`} className={`text-sm font-bold transition-colors ${isScrolled ? "text-foreground/80 hover:text-primary" : "text-white/90 hover:text-accent"}`} data-testid="nav-link-sign-in">Sign In</a>
          </div>

          <div className="hidden lg:flex items-center gap-3">
            <a href={`${import.meta.env.BASE_URL}register`}>
              <Button variant="outline" className={`rounded-full font-extrabold tracking-wide px-5 border-2 ${isScrolled ? "border-primary text-primary hover:bg-primary hover:text-white" : "border-white/60 text-white hover:bg-white/10"}`} data-testid="nav-btn-register">
                Join as Operator
              </Button>
            </a>
            <Button onClick={handleBookNow} className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-full font-extrabold tracking-wide shadow-lg px-6" data-testid="nav-btn-book">
              Book Now
            </Button>
          </div>

          <button className={`lg:hidden p-2 rounded-full ${isScrolled ? "text-foreground" : "text-white"}`} onClick={() => setMobileMenuOpen(!mobileMenuOpen)} data-testid="nav-mobile-toggle">
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden absolute top-full left-0 right-0 bg-background border-b border-border shadow-xl py-6 px-6 flex flex-col gap-4" data-testid="nav-mobile-menu">
            <p className="text-xs font-extrabold uppercase tracking-widest text-muted-foreground">Services</p>
            <a href={`${import.meta.env.BASE_URL}taxi`} className="flex items-center gap-3 text-base font-bold text-foreground" onClick={() => setMobileMenuOpen(false)}><Car className="w-4 h-4 text-primary" /> Taxi &amp; Transfers</a>
            <a href={`${import.meta.env.BASE_URL}food`} className="flex items-center gap-3 text-base font-bold text-foreground" onClick={() => setMobileMenuOpen(false)}><Utensils className="w-4 h-4 text-primary" /> Food Delivery</a>
            <a href={`${import.meta.env.BASE_URL}freight`} className="flex items-center gap-3 text-base font-bold text-foreground" onClick={() => setMobileMenuOpen(false)}><Package className="w-4 h-4 text-primary" /> Freight &amp; Couriers</a>
            <a href={`${import.meta.env.BASE_URL}towing`} className="flex items-center gap-3 text-base font-bold text-foreground" onClick={() => setMobileMenuOpen(false)}><Truck className="w-4 h-4 text-primary" /> Towing &amp; Recovery</a>
            <a href={`${import.meta.env.BASE_URL}rent`} className="flex items-center gap-3 text-base font-bold text-foreground" onClick={() => setMobileMenuOpen(false)}><KeyRound className="w-4 h-4 text-primary" /> Rental Cars</a>
            <hr className="border-border" />
            <a href="#areas" className="text-base font-bold text-foreground" onClick={() => setMobileMenuOpen(false)}>Areas</a>
            <a href="#about" className="text-lg font-bold text-foreground" onClick={() => setMobileMenuOpen(false)}>About</a>
            <a href="#testimonials" className="text-lg font-bold text-foreground" onClick={() => setMobileMenuOpen(false)}>Reviews</a>
            <a href="#operators" className="text-lg font-bold text-accent" onClick={() => setMobileMenuOpen(false)}>For Operators</a>
            <a href="#contact" className="text-lg font-bold text-foreground" onClick={() => setMobileMenuOpen(false)}>Contact</a>
            <a href={`${import.meta.env.BASE_URL}my-rides`} className="text-lg font-bold text-foreground" onClick={() => setMobileMenuOpen(false)}>My Rides</a>
            <hr className="border-border" />
            <a href={`${import.meta.env.BASE_URL}register`} onClick={() => setMobileMenuOpen(false)}>
              <Button size="lg" variant="outline" className="w-full border-2 border-primary text-primary hover:bg-primary hover:text-white rounded-full font-bold" data-testid="nav-mobile-register">
                Join as Operator
              </Button>
            </a>
            <Button size="lg" className="w-full bg-accent text-accent-foreground hover:bg-accent/90 rounded-full font-bold shadow-md" onClick={() => { setMobileMenuOpen(false); handleBookNow(); }} data-testid="nav-mobile-book">
              Book Now
            </Button>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="relative pt-40 pb-32 lg:pt-56 lg:pb-48 overflow-hidden min-h-[95vh] flex items-center" data-testid="hero-section">
        <div className="absolute inset-0 z-0 bg-primary">
          <img 
            src="/images/hero-new.png" 
            alt="Southland landscape with modern transport" 
            className="w-full h-full object-cover object-center scale-105 transform transition-transform duration-[20000ms] hover:scale-110"
            data-testid="img-hero-bg"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-primary/95 via-primary/80 to-primary/30"></div>
          <div className="absolute inset-0 bg-gradient-to-t from-primary/70 via-transparent to-transparent"></div>
        </div>
        
        <div className="max-w-7xl mx-auto px-6 relative z-10 w-full">
          <div className="max-w-3xl">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-accent/10 backdrop-blur-md border border-accent/20 text-accent mb-6 rounded-full shadow-sm" data-testid="badge-hero-availability">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
                </span>
                <span className="text-xs font-extrabold tracking-widest uppercase">Operating across Southland & NZ</span>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-5xl md:text-7xl lg:text-8xl font-display text-white font-black leading-[1.05] tracking-tight mb-6" data-testid="text-hero-title">
                One app.<br />
                <span className="text-accent">Any destination.</span>
              </h1>
            </FadeIn>
            <FadeIn delay={200}>
              <p className="text-lg md:text-2xl text-white/90 mb-10 max-w-2xl leading-relaxed font-medium" data-testid="text-hero-subtitle">
                Your premium New Zealand transport connection. From reliable taxi rides and airport transfers, to piping hot food delivery and fast local couriers — we've got you sorted.
              </p>
            </FadeIn>
            <FadeIn delay={300}>
              <div className="flex flex-col sm:flex-row gap-4 mb-12">
                <Button size="xl" onClick={handleBookNow} className="w-full sm:w-auto bg-accent text-accent-foreground hover:bg-white rounded-full h-16 px-10 text-lg font-extrabold shadow-[0_0_40px_-10px_rgba(255,183,0,0.5)] transition-all" data-testid="btn-hero-book">
                  Book Now
                  <ChevronRight className="w-5 h-5 ml-2" />
                </Button>
              </div>
            </FadeIn>
            
            <FadeIn delay={400}>
              <div className="flex flex-wrap gap-x-6 gap-y-4">
                <div className="flex items-center gap-3" data-testid="text-hero-feature-1">
                  <div className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Car className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <div className="text-white text-sm font-extrabold leading-tight">Taxi & Transport</div>
                    <div className="text-white/60 text-xs font-medium">Rides, airports & charters</div>
                  </div>
                </div>
                <div className="flex items-center gap-3" data-testid="text-hero-feature-2">
                  <div className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Utensils className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <div className="text-white text-sm font-extrabold leading-tight">Food Delivery</div>
                    <div className="text-white/60 text-xs font-medium">Hot meals to your door</div>
                  </div>
                </div>
                <div className="flex items-center gap-3" data-testid="text-hero-feature-3">
                  <div className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Package className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <div className="text-white text-sm font-extrabold leading-tight">Local Couriers</div>
                    <div className="text-white/60 text-xs font-medium">Parcels up to 10 kg — documents, groceries, pharmacy & retail items</div>
                  </div>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Trust Bar */}
      <section className="relative z-20 -mt-16 mb-20 px-6" data-testid="trust-bar-section">
        <div className="max-w-7xl mx-auto">
          <FadeIn delay={500}>
            <div className="bg-card rounded-3xl shadow-2xl border border-border p-8 grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-4 divide-x divide-border/0 md:divide-border/50">
              <div className="text-center px-4" data-testid="trust-stat-1">
                <div className="text-3xl lg:text-4xl font-display font-black text-primary mb-1">10,000+</div>
                <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Rides Completed</div>
              </div>
              <div className="text-center px-4" data-testid="trust-stat-2">
                <div className="text-3xl lg:text-4xl font-display font-black text-primary mb-1">24/7</div>
                <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Dispatch & Support</div>
              </div>
              <div className="text-center px-4" data-testid="trust-stat-3">
                <div className="text-3xl lg:text-4xl font-display font-black text-primary mb-1">5+</div>
                <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Southland Towns</div>
              </div>
              <div className="text-center px-4" data-testid="trust-stat-4">
                <div className="text-3xl lg:text-4xl font-display font-black text-primary mb-1">100%</div>
                <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Licensed & Insured</div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Services Deep Dive */}
      <section id="services" className="py-24 bg-background relative" data-testid="services-section">
        <div className="max-w-7xl mx-auto px-6">
          <FadeIn>
            <div className="text-center max-w-3xl mx-auto mb-24">
              <h2 className="text-sm font-extrabold tracking-widest text-primary uppercase mb-4" data-testid="text-services-kicker">Our Services</h2>
              <h3 className="text-4xl md:text-5xl lg:text-6xl font-display font-black text-foreground leading-tight" data-testid="text-services-title">More than just a ride.</h3>
            </div>
          </FadeIn>

          <FadeIn>
            <Tabs defaultValue="taxi" className="w-full">
              {/* Tab Buttons */}
              <TabsList className="w-full h-auto flex rounded-2xl bg-muted p-1.5 mb-12 gap-1">
                <TabsTrigger
                  value="taxi"
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 px-3 text-sm font-bold data-[state=active]:bg-background data-[state=active]:shadow-md data-[state=active]:text-primary transition-all"
                  data-testid="tab-taxi"
                >
                  <Car className="w-4 h-4 flex-shrink-0" />
                  <span className="hidden sm:inline">Taxi Transport</span>
                  <span className="sm:hidden">Taxi</span>
                </TabsTrigger>
                <TabsTrigger
                  value="food"
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 px-3 text-sm font-bold data-[state=active]:bg-background data-[state=active]:shadow-md data-[state=active]:text-accent-foreground transition-all"
                  data-testid="tab-food"
                >
                  <Utensils className="w-4 h-4 flex-shrink-0" />
                  <span className="hidden sm:inline">Food Delivery</span>
                  <span className="sm:hidden">Food</span>
                </TabsTrigger>
                <TabsTrigger
                  value="courier"
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 px-3 text-sm font-bold data-[state=active]:bg-background data-[state=active]:shadow-md data-[state=active]:text-primary transition-all"
                  data-testid="tab-courier"
                >
                  <Package className="w-4 h-4 flex-shrink-0" />
                  <span className="hidden sm:inline">Local Couriers</span>
                  <span className="sm:hidden">Courier</span>
                </TabsTrigger>
                <TabsTrigger
                  value="rental"
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 px-3 text-sm font-bold data-[state=active]:bg-background data-[state=active]:shadow-md data-[state=active]:text-accent-foreground transition-all"
                  data-testid="tab-rental"
                >
                  <KeyRound className="w-4 h-4 flex-shrink-0" />
                  <span className="hidden sm:inline">Rental Cars</span>
                  <span className="sm:hidden">Rentals</span>
                </TabsTrigger>
              </TabsList>

              {/* Taxi */}
              <TabsContent value="taxi" className="mt-0">
                <div className="grid lg:grid-cols-2 gap-12 items-center">
                  <div className="relative h-[300px] lg:h-[520px] rounded-[2.5rem] overflow-hidden shadow-2xl group">
                    <img
                      src="/images/taxi-service.png"
                      alt="Premium taxi service in New Zealand"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      data-testid="img-service-taxi"
                    />
                    <div className="absolute inset-0 border-4 border-white/20 rounded-[2.5rem] z-10 pointer-events-none"></div>
                  </div>
                  <div>
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
                        <Car className="w-7 h-7" />
                      </div>
                      <h4 className="text-3xl md:text-4xl font-display font-black" data-testid="text-service-1-title">Taxi Transport</h4>
                    </div>
                    <p className="text-lg text-muted-foreground font-medium mb-8 leading-relaxed" data-testid="text-service-1-desc">
                      Whether you're heading across town, catching a flight, or managing corporate travel, our premium fleet gets you there comfortably. We offer modern sedans, spacious vans, and wheelchair-accessible vehicles.
                    </p>
                    <ul className="space-y-3 mb-8 text-base font-medium">
                      <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0" /> Airport transfers from Invercargill to Queenstown & beyond</li>
                      <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0" /> Corporate accounts & streamlined billing</li>
                      <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0" /> Wheelchair accessible mobility vans</li>
                      <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0" /> Long-distance scenic charters across NZ</li>
                    </ul>
                    <Button size="lg" onClick={handleBookNow} className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full h-14 px-8 font-bold shadow-md" data-testid="btn-book-taxi">
                      Book a Ride
                    </Button>
                  </div>
                </div>
              </TabsContent>

              {/* Food Delivery */}
              <TabsContent value="food" className="mt-0">
                <div className="grid lg:grid-cols-2 gap-12 items-center">
                  <div className="order-2 lg:order-1">
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-14 h-14 bg-accent/20 rounded-2xl flex items-center justify-center text-accent-foreground">
                        <Utensils className="w-7 h-7" />
                      </div>
                      <h4 className="text-3xl md:text-4xl font-display font-black" data-testid="text-service-2-title">Food Delivery</h4>
                    </div>
                    <p className="text-lg text-muted-foreground font-medium mb-8 leading-relaxed" data-testid="text-service-2-desc">
                      Craving your local favorites? We partner with the best restaurants and takeaways across Southland to deliver hot, fresh meals straight to your door. Fast, reliable, and handled with care.
                    </p>
                    <ul className="space-y-3 mb-8 text-base font-medium">
                      <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" /> Local restaurant partnerships</li>
                      <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" /> Insulated premium thermal bags</li>
                      <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" /> Contactless delivery options</li>
                      <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" /> Late-night craving runs</li>
                    </ul>
                    <Button size="lg" onClick={handleBookNow} className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-full h-14 px-8 font-bold shadow-md" data-testid="btn-book-food">
                      Order Food
                    </Button>
                  </div>
                  <div className="relative h-[300px] lg:h-[520px] rounded-[2.5rem] overflow-hidden shadow-2xl group order-1 lg:order-2">
                    <img
                      src="/images/food-service.png"
                      alt="Fresh food delivery service"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      data-testid="img-service-food"
                    />
                    <div className="absolute inset-0 border-4 border-white/20 rounded-[2.5rem] z-10 pointer-events-none"></div>
                  </div>
                </div>
              </TabsContent>

              {/* Local Couriers */}
              <TabsContent value="courier" className="mt-0">
                <div className="grid lg:grid-cols-2 gap-12 items-center">
                  <div className="relative h-[300px] lg:h-[520px] rounded-[2.5rem] overflow-hidden shadow-2xl group">
                    <img
                      src="/images/courier-service.png"
                      alt="Professional courier delivery service"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      data-testid="img-service-courier"
                    />
                    <div className="absolute inset-0 border-4 border-white/20 rounded-[2.5rem] z-10 pointer-events-none"></div>
                  </div>
                  <div>
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
                        <Package className="w-7 h-7" />
                      </div>
                      <h4 className="text-3xl md:text-4xl font-display font-black" data-testid="text-service-3-title">Local Couriers</h4>
                    </div>
                    <p className="text-lg text-muted-foreground font-medium mb-4 leading-relaxed" data-testid="text-service-3-desc">
                      Need a package delivered right now? Our local courier network offers fast, secure, same-day delivery for businesses and individuals across the region.
                    </p>
                    <div className="mb-6 bg-primary/10 border-l-4 border-primary rounded-r-xl px-4 py-4">
                      <p className="text-sm font-bold text-primary mb-1 uppercase tracking-wide">What we carry</p>
                      <p className="text-sm font-medium text-foreground leading-relaxed">
                        Ideal for small parcels and packages up to 10 kg — including documents, groceries, pharmacy pickups, and small retail items.
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        For larger or freight-sized loads, please contact us directly.
                      </p>
                    </div>
                    <ul className="space-y-3 mb-8 text-base font-medium">
                      <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0" /> Urgent same-day local runs</li>
                      <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0" /> Business and B2B delivery accounts</li>
                      <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0" /> Secure document handling</li>
                      <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0" /> Parcel and package distribution</li>
                    </ul>
                    <Button size="lg" onClick={handleBookNow} className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full h-14 px-8 font-bold shadow-md" data-testid="btn-book-courier">
                      Book a Courier
                    </Button>
                    <div className="mt-6 bg-primary/10 border-l-4 border-primary rounded-r-xl px-4 py-4">
                      <p className="text-sm font-bold text-primary mb-1 uppercase tracking-wide">What we carry</p>
                      <p className="text-sm font-medium text-foreground leading-relaxed">
                        Ideal for small parcels and packages up to 10 kg — including documents, groceries, pharmacy pickups, and small retail items.
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        For larger or freight-sized loads, please contact us directly.
                      </p>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Rental Cars */}
              <TabsContent value="rental" className="mt-0">
                <div className="grid lg:grid-cols-2 gap-12 items-center">
                  <div className="order-2 lg:order-1">
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-14 h-14 bg-accent/20 rounded-2xl flex items-center justify-center text-accent-foreground">
                        <KeyRound className="w-7 h-7" />
                      </div>
                      <h4 className="text-3xl md:text-4xl font-display font-black" data-testid="text-service-4-title">Rental Cars</h4>
                    </div>
                    <p className="text-lg text-muted-foreground font-medium mb-8 leading-relaxed" data-testid="text-service-4-desc">
                      Need wheels for a day, a week, or longer? Browse our rental fleet — cars, vans, and SUVs available across Southland. Book online and pick up at your convenience.
                    </p>
                    <ul className="space-y-3 mb-8 text-base font-medium">
                      <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0" /> Cars, vans &amp; SUVs available</li>
                      <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0" /> Daily, weekly &amp; long-term rates</li>
                      <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0" /> Flexible pickup &amp; drop-off</li>
                      <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0" /> Online booking — instant confirmation</li>
                    </ul>
                    <a href={`${import.meta.env.BASE_URL}rent`}>
                      <Button size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-full h-14 px-8 font-bold shadow-md" data-testid="btn-browse-rentals">
                        Browse Rental Cars
                        <ArrowRight className="w-5 h-5 ml-2" />
                      </Button>
                    </a>
                  </div>
                  <div className="relative h-[300px] lg:h-[520px] rounded-[2.5rem] overflow-hidden shadow-2xl group order-1 lg:order-2 bg-muted flex items-center justify-center">
                    <div className="text-center text-muted-foreground">
                      <KeyRound className="w-16 h-16 mx-auto mb-4 opacity-30" />
                      <p className="font-bold text-lg opacity-50">Rental fleet photo coming soon</p>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </FadeIn>

        </div>
      </section>

      {/* Areas Section */}
      <section id="areas" className="py-32 bg-secondary/30 relative" data-testid="areas-section">
        <div className="max-w-7xl mx-auto px-6">
          <FadeIn>
            <div className="text-center max-w-3xl mx-auto mb-20">
              <h2 className="text-sm font-extrabold tracking-widest text-primary uppercase mb-4" data-testid="text-areas-kicker">Where We Go</h2>
              <h3 className="text-4xl md:text-5xl lg:text-6xl font-display font-black text-foreground mb-6" data-testid="text-areas-title">Southland born, nationwide reach.</h3>
              <p className="text-lg md:text-xl text-muted-foreground font-medium leading-relaxed" data-testid="text-areas-desc">
                While our roots and daily operations are firmly planted in the deep south, our charter and transport services can connect you to destinations across beautiful New Zealand.
              </p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-8">
            <FadeIn delay={0}>
              <div className="bg-card p-10 rounded-3xl shadow-lg border border-border h-full">
                <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center text-primary mb-6">
                  <MapPin className="w-6 h-6" />
                </div>
                <h4 className="text-2xl font-display font-bold mb-4">Invercargill Core</h4>
                <p className="text-muted-foreground font-medium mb-6">Our primary hub. 24/7 taxi dispatch, local food delivery network, and rapid couriers covering every suburb.</p>
                <ul className="space-y-2 text-sm font-bold text-foreground/80">
                  <li>Invercargill City</li>
                  <li>Bluff</li>
                  <li>Otatara</li>
                  <li>Winton</li>
                </ul>
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <div className="bg-card p-10 rounded-3xl shadow-lg border border-border h-full relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-accent/10 rounded-bl-full -z-10"></div>
                <div className="w-14 h-14 bg-accent/20 rounded-full flex items-center justify-center text-accent-foreground mb-6">
                  <Navigation className="w-6 h-6" />
                </div>
                <h4 className="text-2xl font-display font-bold mb-4">Wider Southland</h4>
                <p className="text-muted-foreground font-medium mb-6">Connecting rural communities and major Southland towns with scheduled services and direct bookings.</p>
                <ul className="space-y-2 text-sm font-bold text-foreground/80">
                  <li>Gore & Surrounds</li>
                  <li>Riverton</li>
                  <li>Te Anau & Fiordland</li>
                  <li>Catlins Coast</li>
                </ul>
              </div>
            </FadeIn>
            <FadeIn delay={200}>
              <div className="bg-primary text-primary-foreground p-10 rounded-3xl shadow-lg h-full relative overflow-hidden">
                <div className="absolute top-0 right-0 w-full h-full bg-[url('/images/hero-bg.png')] opacity-10 bg-cover bg-center -z-10"></div>
                <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center text-white mb-6">
                  <Clock className="w-6 h-6" />
                </div>
                <h4 className="text-2xl font-display font-bold mb-4 text-white">Long Distance</h4>
                <p className="text-primary-foreground/80 font-medium mb-6">Need to go further? We offer pre-booked charters and transfers from Invercargill across the South Island.</p>
                <ul className="space-y-2 text-sm font-bold text-white/90">
                  <li>Transfers to Queenstown Airport</li>
                  <li>Transfers to Dunedin City & Airport</li>
                  <li>Christchurch connections</li>
                  <li>Custom nationwide charters</li>
                </ul>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* About/Fleet Section */}
      <section id="about" className="py-32 bg-background overflow-hidden" data-testid="about-section">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-20 items-center">
            <div className="relative">
              <FadeIn direction="left">
                <div className="grid grid-cols-2 gap-6 relative z-10">
                  <img 
                    src="/images/taxi-interior.png" 
                    alt="Clean comfortable taxi interior" 
                    className="w-full h-[300px] object-cover rounded-3xl shadow-xl mt-12"
                    data-testid="img-about-1"
                  />
                  <img 
                    src="/images/invercargill-city.png" 
                    alt="Invercargill city" 
                    className="w-full h-[300px] object-cover rounded-3xl shadow-xl -mt-4"
                    data-testid="img-about-2"
                  />
                </div>
                <div className="absolute -inset-10 bg-accent/5 rounded-full blur-3xl -z-10"></div>
              </FadeIn>
            </div>
            
            <div>
              <FadeIn direction="right">
                <h2 className="text-sm font-extrabold tracking-widest text-primary uppercase mb-4" data-testid="text-about-kicker">Our Story</h2>
                <h3 className="text-4xl md:text-5xl lg:text-6xl font-display font-black text-foreground mb-8 leading-tight" data-testid="text-about-title">Built by a 15-year-old and his dad.</h3>
                
                <div className="space-y-6 text-lg text-muted-foreground font-medium mb-10 leading-relaxed">
                  <p data-testid="text-about-desc-1">
                    BookaWaka was born in Invercargill, Southland — the brainchild of Hasnat Abdullah, who started building this entire platform at just 15 years old, alongside his father. Hasnat is a student at Southland Boys High School, a member of the Invercargill Youth Council, and an Air Cadet.
                  </p>
                  <div className="flex flex-wrap gap-3 my-2" data-testid="about-badges">
                    <span className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-full text-sm font-extrabold">
                      <BadgeCheck className="w-4 h-4" /> Youth Council Member
                    </span>
                    <span className="inline-flex items-center gap-2 px-4 py-2 bg-accent/15 text-accent-foreground rounded-full text-sm font-extrabold">
                      <BadgeCheck className="w-4 h-4 text-accent" /> Southland Boys High School
                    </span>
                    <span className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-full text-sm font-extrabold">
                      <BadgeCheck className="w-4 h-4" /> Air Cadet
                    </span>
                  </div>
                  <p data-testid="text-about-desc-2">
                    Between his studies, community commitments, and cadet training, Hasnat found time to do something most adults never attempt — build a fully functioning transport dispatch system from scratch. Together with his father, they designed and developed the entire platform right here in Invercargill, covering taxis, food delivery, and couriers.
                  </p>
                  <p data-testid="text-about-desc-3">
                    No outside investors. No corporate playbook. Just a driven young Southlander with a laptop, a supportive dad, and the belief that their community deserved better. That spirit lives in every booking made through BookaWaka.
                  </p>
                </div>

                <div className="flex gap-10 pt-6 border-t border-border mb-10">
                  <div data-testid="stat-founded">
                    <div className="text-4xl font-display font-black text-primary mb-1">15</div>
                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Age when it started</div>
                  </div>
                  <div data-testid="stat-team">
                    <div className="text-4xl font-display font-black text-primary mb-1">2</div>
                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Founders — father & son</div>
                  </div>
                  <div data-testid="stat-location">
                    <div className="text-4xl font-display font-black text-primary mb-1">INV</div>
                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Built in Invercargill</div>
                  </div>
                </div>
                
                <div className="flex items-center gap-6">
                  <a href={`${import.meta.env.BASE_URL}register`} data-testid="btn-about-operators">
                    <Button size="xl" className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full h-14 px-8 font-bold shadow-md">
                      Join the Platform
                    </Button>
                  </a>
                </div>
              </FadeIn>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="py-32 relative bg-primary overflow-hidden" data-testid="testimonials-section">
        <div className="absolute inset-0 z-0">
          <img 
            src="/images/testimonials-bg.png" 
            alt="Scenic New Zealand coastal road" 
            className="w-full h-full object-cover opacity-20 scale-105"
            data-testid="img-testimonials-bg"
          />
          <div className="absolute inset-0 bg-primary/90 mix-blend-multiply"></div>
        </div>

        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <FadeIn>
            <div className="text-center max-w-3xl mx-auto mb-20">
              <h2 className="text-sm font-extrabold tracking-widest text-accent uppercase mb-4" data-testid="text-testimonials-kicker">Word on the street</h2>
              <h3 className="text-4xl md:text-5xl font-display font-black text-white" data-testid="text-testimonials-title">What our locals are saying.</h3>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                name: "Aroha T.",
                role: "Invercargill Resident",
                text: "Honestly the best transport service down here. I use them for my weekly grocery run and getting to the airport. Drivers are always up for a good yarn and the cars are spotless."
              },
              {
                name: "Mike F.",
                role: "Local Business Owner",
                text: "Switched our business courier account to BookaWaka last year and haven't looked back. Same-day deliveries across Southland have never been this reliable. Top tier service."
              },
              {
                name: "Sandra K.",
                role: "Regular Foodie",
                text: "Their food delivery is unmatched. Food actually arrives hot and the tracking is super accurate. Love supporting a local NZ business instead of the massive overseas apps."
              }
            ].map((testimonial, i) => (
              <FadeIn key={i} delay={i * 100}>
                <div className="bg-white/10 backdrop-blur-md p-8 rounded-3xl border border-white/20 h-full flex flex-col" data-testid={`testimonial-card-${i}`}>
                  <div className="flex text-accent mb-6">
                    {[1,2,3,4,5].map(star => <Star key={star} className="w-5 h-5 fill-current" />)}
                  </div>
                  <p className="text-white/90 text-lg font-medium leading-relaxed mb-8 flex-grow">"{testimonial.text}"</p>
                  <div>
                    <div className="text-white font-display font-bold text-xl">{testimonial.name}</div>
                    <div className="text-accent font-bold text-sm uppercase tracking-wider">{testimonial.role}</div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Dispatch Platform / For Operators */}
      <section id="operators" className="py-32 bg-background relative overflow-hidden" data-testid="operators-section">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-accent/5 rounded-full blur-3xl"></div>
          <div className="absolute -bottom-40 -left-40 w-[600px] h-[600px] bg-primary/5 rounded-full blur-3xl"></div>
        </div>
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <FadeIn>
            <div className="text-center max-w-3xl mx-auto mb-20">
              <div className="inline-flex items-center gap-2 px-5 py-2 bg-accent/10 border border-accent/20 text-accent-foreground rounded-full mb-6">
                <Zap className="w-4 h-4 text-accent" />
                <span className="text-sm font-extrabold uppercase tracking-widest">For Operators</span>
              </div>
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-display font-black text-foreground leading-tight mb-6" data-testid="text-operators-title">
                Run your own business.<br /><span className="text-primary">Powered by BookaWaka.</span>
              </h2>
              <p className="text-lg md:text-xl text-muted-foreground font-medium leading-relaxed" data-testid="text-operators-desc">
                Whether you run taxis, a restaurant, a courier fleet, or a rental car company — we've built the platform infrastructure so you don't have to. Sign up, get onboarded, and start taking bookings across Southland and beyond.
              </p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-8 mb-20">
            {[
              {
                icon: <BadgeCheck className="w-8 h-8" />,
                step: "01",
                title: "Sign Up",
                desc: "Create your operator account on our platform. Choose your service type — taxi, food delivery, couriers, rental cars, or any combination."
              },
              {
                icon: <TrendingUp className="w-8 h-8" />,
                step: "02",
                title: "Get Set Up & Pay",
                desc: "Complete onboarding, link your vehicles, get verified, and activate your subscription. Simple, transparent pricing — no hidden fees."
              },
              {
                icon: <Users className="w-8 h-8" />,
                step: "03",
                title: "Start Your Business",
                desc: "Go live on the BookaWaka dispatch network. Receive bookings, manage your fleet, and build your own Southland transport business."
              }
            ].map((item, i) => (
              <FadeIn key={i} delay={i * 120}>
                <div className="relative bg-card border border-border rounded-3xl p-10 h-full flex flex-col group hover:border-primary/30 hover:shadow-xl transition-all duration-500" data-testid={`operator-step-${i}`}>
                  <div className="absolute top-8 right-8 text-6xl font-display font-black text-muted/30 leading-none select-none">{item.step}</div>
                  <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary mb-8 group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-500">
                    {item.icon}
                  </div>
                  <h4 className="text-2xl font-display font-black mb-4">{item.title}</h4>
                  <p className="text-muted-foreground font-medium leading-relaxed flex-grow">{item.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>

          <FadeIn>
            <div className="bg-primary rounded-[2.5rem] p-12 md:p-16 flex flex-col lg:flex-row items-center justify-between gap-10" data-testid="operators-cta-block">
              <div className="flex-1">
                <h3 className="text-3xl md:text-4xl font-display font-black text-primary-foreground mb-4">
                  Ready to be your own boss?
                </h3>
                <p className="text-primary-foreground/80 text-lg font-medium leading-relaxed max-w-xl">
                  Join the growing network of independent operators — taxis, restaurants, couriers, and rental car companies — running their business on the BookaWaka platform right here in Southland and beyond.
                </p>
                <div className="mt-8 flex flex-wrap gap-6 text-primary-foreground/70 text-sm font-bold">
                  <div className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-accent" /> Instant dispatch access</div>
                  <div className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-accent" /> Transparent pricing</div>
                  <div className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-accent" /> Local support team</div>
                  <div className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-accent" /> No lock-in contracts</div>
                </div>
              </div>
              <div className="flex flex-col gap-4 flex-shrink-0">
                <a href={`${import.meta.env.BASE_URL}register`}>
                  <Button size="xl" className="bg-accent text-accent-foreground hover:bg-white rounded-full h-16 px-10 text-lg font-extrabold shadow-xl whitespace-nowrap" data-testid="btn-operator-signup">
                    Get Started as an Operator
                    <ArrowRight className="w-5 h-5 ml-3" />
                  </Button>
                </a>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* App Teaser & Final CTA */}
      <section className="py-24 bg-accent relative overflow-hidden" data-testid="app-teaser-section">
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="bg-background rounded-[3rem] shadow-2xl p-10 md:p-20 border border-border/50 text-center max-w-5xl mx-auto">
            <FadeIn>
              <div className="inline-flex items-center gap-2 px-5 py-2 bg-primary/10 text-primary mb-8 rounded-full">
                <span className="font-extrabold text-sm uppercase tracking-widest">Coming Soon</span>
              </div>
              <h2 className="text-4xl md:text-6xl font-display font-black mb-6 text-foreground" data-testid="text-cta-title">The BookaWaka App.</h2>
              <p className="text-xl md:text-2xl mb-8 font-medium max-w-2xl mx-auto text-muted-foreground" data-testid="text-cta-desc">
                We're building the ultimate local app for rides, food, and couriers. Until then, our dispatch team is ready to help you 24/7.
              </p>

              {/* App version badges — shown when versions are available in Firebase */}
              {appVersions && (appVersions.passengerAppMinVersion || appVersions.driverAppMinVersion) && (
                <div className="flex flex-wrap justify-center gap-4 mb-10">
                  {appVersions.passengerAppMinVersion && (
                    <div className="flex items-center gap-3 bg-muted rounded-2xl px-5 py-3 border border-border">
                      <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center text-primary flex-shrink-0">
                        <Users className="w-5 h-5" />
                      </div>
                      <div className="text-left">
                        <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Passenger App</div>
                        <div className="font-display font-black text-foreground">v{appVersions.passengerAppMinVersion}</div>
                      </div>
                    </div>
                  )}
                  {appVersions.driverAppMinVersion && (
                    <div className="flex items-center gap-3 bg-muted rounded-2xl px-5 py-3 border border-border">
                      <div className="w-9 h-9 bg-accent/20 rounded-xl flex items-center justify-center text-accent-foreground flex-shrink-0">
                        <Car className="w-5 h-5" />
                      </div>
                      <div className="text-left">
                        <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Driver App</div>
                        <div className="font-display font-black text-foreground">v{appVersions.driverAppMinVersion}</div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col sm:flex-row justify-center gap-4">
                <Button size="xl" onClick={handleBookNow} className="w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary/90 rounded-full h-16 px-10 text-lg font-bold shadow-xl" data-testid="btn-cta-book">
                  Book Now
                </Button>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <ContactSection />

      {/* Footer */}
      <footer className="bg-foreground text-background pt-24 pb-12" data-testid="footer">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-12 mb-20">
            <div className="col-span-2 md:col-span-2">
              <div className="flex items-center gap-2 mb-8" data-testid="footer-logo">
                <div className="bg-primary text-primary-foreground p-2 rounded-xl rotate-3">
                  <Navigation className="w-6 h-6" />
                </div>
                <span className="font-display font-extrabold text-3xl tracking-tight text-white">
                  BookaWaka
                </span>
              </div>
              <p className="text-background/70 mb-8 font-medium leading-relaxed max-w-xs" data-testid="text-footer-desc">
                Your premium New Zealand transport connection. Rides, food, and couriers sorted with local hospitality.
              </p>
              <div className="flex items-center gap-4">
                <Button size="icon" variant="outline" className="rounded-full bg-white/5 border-white/10 hover:bg-white/20 text-white">
                  <span className="sr-only">Facebook</span>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path fillRule="evenodd" d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" clipRule="evenodd" /></svg>
                </Button>
                <Button size="icon" variant="outline" className="rounded-full bg-white/5 border-white/10 hover:bg-white/20 text-white">
                  <span className="sr-only">Instagram</span>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path fillRule="evenodd" d="M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z" clipRule="evenodd" /></svg>
                </Button>
              </div>
            </div>
            
            <div>
              <h4 className="font-bold mb-6 text-accent uppercase tracking-wider text-sm" data-testid="footer-heading-services">Taxi</h4>
              <ul className="space-y-4 font-medium text-background/70">
                <li><a href="#services" className="hover:text-white transition-colors">Book a Ride</a></li>
                <li><a href="#services" className="hover:text-white transition-colors">Airport Transfers</a></li>
                <li><a href="#services" className="hover:text-white transition-colors">Corporate Accounts</a></li>
                <li><a href="#services" className="hover:text-white transition-colors">Mobility Vans</a></li>
                <li><a href="#services" className="hover:text-white transition-colors">Charters</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold mb-6 text-accent uppercase tracking-wider text-sm" data-testid="footer-heading-food">Food</h4>
              <ul className="space-y-4 font-medium text-background/70">
                <li><a href="#services" className="hover:text-white transition-colors">Order Delivery</a></li>
                <li><a href="#services" className="hover:text-white transition-colors">Local Restaurants</a></li>
                <li><a href="#services" className="hover:text-white transition-colors">Late Night</a></li>
                <li><a href="#services" className="hover:text-white transition-colors">Partner With Us</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold mb-6 text-accent uppercase tracking-wider text-sm" data-testid="footer-heading-couriers">Couriers</h4>
              <ul className="space-y-4 font-medium text-background/70">
                <li><a href="#services" className="hover:text-white transition-colors">Same-Day Local</a></li>
                <li><a href="#services" className="hover:text-white transition-colors">Business Packages</a></li>
                <li><a href="#services" className="hover:text-white transition-colors">B2B Network</a></li>
                <li><a href="#services" className="hover:text-white transition-colors">Track Parcel</a></li>
              </ul>
            </div>

            <div className="col-span-2 md:col-span-5 border-t border-white/10 mt-8 pt-8">
              <h4 className="font-bold mb-6 text-accent uppercase tracking-wider text-sm" data-testid="footer-heading-contact">Contact</h4>
              <div className="grid md:grid-cols-2 gap-8">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center text-accent">
                    <Mail className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm text-background/70 font-bold uppercase tracking-wider mb-1">Email</div>
                    <a href="#contact" className="text-base font-display font-bold text-white hover:text-accent transition-colors">info@bookawaka.com</a>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center text-primary">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm text-background/70 font-bold uppercase tracking-wider mb-1">HQ</div>
                    <div className="text-white font-medium">Invercargill, Southland<br />New Zealand</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-sm font-medium text-background/50">
            <div data-testid="text-footer-copy">&copy; {new Date().getFullYear()} BookaWaka Transport Ltd. All rights reserved.</div>
            <div className="flex gap-6">
              <a href="/privacy-policy.html" className="hover:text-white transition-colors" data-testid="link-footer-privacy">Privacy Policy</a>
              <a href="#" className="hover:text-white transition-colors" data-testid="link-footer-terms">Terms of Service</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/book" component={BookPage} />
      <Route path="/my-rides" component={MyRidesPage} />
      <Route path="/sign-in" component={SignInPage} />
      <Route path="/create-account" component={CreateAccountPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/join" component={RegisterPage} />
      <Route path="/rent" component={RentPage} />
      <Route path="/taxi" component={TaxiPage} />
      <Route path="/food" component={FoodPage} />
      <Route path="/freight" component={FreightPage} />
      <Route path="/towing" component={TowingPage} />
      <Route path="/tow/track" component={TowTrackPage} />
      <Route path="/tow" component={TowRequestPage} />
      <Route path="/booking-success" component={PaymentSuccessPage} />
      <Route path="/payment-success" component={PaymentSuccessPage} />
      <Route path="/payment-cancel" component={PaymentCancelPage} />
      <Route path="/passenger-app-return" component={PassengerAppReturnPage} />
      <Route path="/passenger-app-cancel" component={PassengerAppCancelPage} />
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
