import { KeyRound, Navigation, ArrowRight, CheckCircle2, Phone, Mail, Calendar, Users, Fuel, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

const FLEET_CATEGORIES = [
  {
    title: "Economy Cars",
    desc: "Fuel-efficient and affordable for city driving and short trips.",
    seats: "5",
    features: ["Air conditioning", "Bluetooth", "Fuel efficient"],
    icon: "🚗",
  },
  {
    title: "SUVs & 4WDs",
    desc: "Perfect for exploring Southland's back roads and scenic routes.",
    seats: "5–7",
    features: ["All-wheel drive", "High clearance", "Extra luggage space"],
    icon: "🚙",
  },
  {
    title: "Vans & People Movers",
    desc: "Ideal for families, groups, or moving large items.",
    seats: "7–12",
    features: ["Spacious interior", "Sliding doors", "Multiple rows"],
    icon: "🚐",
  },
];

export default function RentPage() {
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
        <a href={`${import.meta.env.BASE_URL}register`}>
          <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-full font-bold">
            List Your Fleet
          </Button>
        </a>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-foreground text-white py-20 px-6">
          <div className="max-w-4xl mx-auto text-center">
            <div className="w-20 h-20 bg-accent/20 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <KeyRound className="w-10 h-10 text-accent" />
            </div>
            <h1 className="text-4xl md:text-6xl font-display font-black mb-4 leading-tight">
              Rental Cars<br /><span className="text-accent">Across Southland</span>
            </h1>
            <p className="text-lg md:text-xl text-white/70 font-medium max-w-2xl mx-auto mb-10">
              Cars, vans, and SUVs available for daily, weekly, or long-term hire. Browse our network of trusted rental operators across Invercargill and Southland.
            </p>
            <div className="flex flex-wrap gap-4 justify-center">
              <div className="flex items-center gap-2 bg-white/10 rounded-full px-5 py-2.5 text-sm font-bold">
                <Calendar className="w-4 h-4 text-accent" /> Daily, weekly &amp; long-term
              </div>
              <div className="flex items-center gap-2 bg-white/10 rounded-full px-5 py-2.5 text-sm font-bold">
                <Shield className="w-4 h-4 text-accent" /> Verified operators
              </div>
              <div className="flex items-center gap-2 bg-white/10 rounded-full px-5 py-2.5 text-sm font-bold">
                <Fuel className="w-4 h-4 text-accent" /> All vehicle types
              </div>
            </div>
          </div>
        </section>

        {/* Coming Soon notice */}
        <section className="py-16 px-6">
          <div className="max-w-3xl mx-auto">
            <div className="bg-accent/10 border-2 border-accent/30 rounded-[2rem] p-10 text-center mb-16">
              <div className="text-4xl mb-4">🚗</div>
              <h2 className="text-2xl font-display font-black mb-3">Online Booking Coming Soon</h2>
              <p className="text-muted-foreground font-medium mb-6">
                We're onboarding rental car operators now. In the meantime, contact us directly to arrange your hire or enquire about availability.
              </p>
              <div className="flex flex-wrap gap-4 justify-center">
                <a href="mailto:info@bookawaka.com">
                  <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full font-bold px-8">
                    <Mail className="w-4 h-4 mr-2" /> Email Us
                  </Button>
                </a>
                <a href="tel:+6403123456">
                  <Button size="lg" variant="outline" className="rounded-full font-bold px-8">
                    <Phone className="w-4 h-4 mr-2" /> Call Us
                  </Button>
                </a>
              </div>
            </div>

            {/* Fleet categories */}
            <h2 className="text-2xl font-display font-black mb-8 text-center">Vehicle Categories</h2>
            <div className="grid md:grid-cols-3 gap-6 mb-16">
              {FLEET_CATEGORIES.map((cat) => (
                <div key={cat.title} className="bg-card border border-border rounded-2xl p-6 hover:border-primary/40 hover:shadow-lg transition-all">
                  <div className="text-4xl mb-4">{cat.icon}</div>
                  <h3 className="font-display font-black text-lg mb-2">{cat.title}</h3>
                  <p className="text-sm text-muted-foreground font-medium mb-4">{cat.desc}</p>
                  <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground mb-3">
                    <Users className="w-4 h-4" /> Up to {cat.seats} seats
                  </div>
                  <ul className="space-y-1.5">
                    {cat.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm font-medium">
                        <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" /> {f}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {/* Operator CTA */}
            <div className="bg-primary rounded-[2rem] p-10 md:p-12 text-center text-primary-foreground">
              <h2 className="text-2xl md:text-3xl font-display font-black mb-3">Have a rental fleet?</h2>
              <p className="text-primary-foreground/80 font-medium mb-8 max-w-lg mx-auto">
                List your cars, vans, or SUVs on BookaWaka and reach customers across Southland. Quick setup, transparent pricing.
              </p>
              <a href={`${import.meta.env.BASE_URL}register`}>
                <Button size="lg" className="bg-accent text-accent-foreground hover:bg-white rounded-full h-14 px-10 font-extrabold shadow-xl">
                  List Your Fleet <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-foreground text-white/60 text-sm text-center py-6 px-6">
        <p>&copy; {new Date().getFullYear()} BookaWaka. All rights reserved. &mdash; <a href="/" className="hover:text-white transition-colors">Back to home</a></p>
      </footer>
    </div>
  );
}
