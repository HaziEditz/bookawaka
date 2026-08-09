import { Package, Navigation, ArrowRight, CheckCircle2, Clock, Shield, Truck, MapPin, Phone, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

const SERVICES = [
  { title: "Same-Day Local Delivery", desc: "Urgent parcels and packages delivered within Invercargill the same day.", icon: "📦" },
  { title: "Freight & Bulk Goods", desc: "Large or heavy items moved safely across Southland by our courier partners.", icon: "🚛" },
  { title: "Business Contracts", desc: "Regular scheduled courier runs for local businesses — daily, weekly, or custom.", icon: "📋" },
  { title: "Document Delivery", desc: "Secure, fast delivery of important documents and legal paperwork.", icon: "📄" },
];

export default function FreightPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/30 flex flex-col">
      <header className="bg-foreground text-white px-6 py-4 flex items-center justify-between shadow-xl">
        <a href="/" className="flex items-center gap-2 group">
          <div className="bg-primary text-primary-foreground p-2 rounded-xl rotate-3 group-hover:rotate-0 transition-transform">
            <Navigation className="w-5 h-5" />
          </div>
          <span className="font-display font-extrabold text-xl tracking-tight">BookaWaka</span>
        </a>
        <a href={`${import.meta.env.BASE_URL}book`}>
          <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-full font-bold">
            Book a Courier
          </Button>
        </a>
      </header>

      <main className="flex-1">
        <section className="bg-foreground text-white py-20 px-6">
          <div className="max-w-4xl mx-auto text-center">
            <div className="w-20 h-20 bg-primary/20 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <Package className="w-10 h-10 text-primary" />
            </div>
            <h1 className="text-4xl md:text-6xl font-display font-black mb-4 leading-tight">
              Freight &amp; Couriers<br /><span className="text-accent">Southland's Best</span>
            </h1>
            <p className="text-lg md:text-xl text-white/70 font-medium max-w-2xl mx-auto mb-10">
              From small parcels to bulk freight — our network of local courier operators gets it there fast and safely.
            </p>
            <div className="flex flex-wrap gap-4 justify-center mb-10">
              <div className="flex items-center gap-2 bg-white/10 rounded-full px-5 py-2.5 text-sm font-bold"><Clock className="w-4 h-4 text-accent" /> Same-day available</div>
              <div className="flex items-center gap-2 bg-white/10 rounded-full px-5 py-2.5 text-sm font-bold"><Shield className="w-4 h-4 text-accent" /> Tracked deliveries</div>
              <div className="flex items-center gap-2 bg-white/10 rounded-full px-5 py-2.5 text-sm font-bold"><Truck className="w-4 h-4 text-accent" /> All sizes</div>
            </div>
            <a href={`${import.meta.env.BASE_URL}book`}>
              <Button size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-full h-14 px-10 font-extrabold shadow-xl text-base">
                Book Now <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </a>
          </div>
        </section>

        <section className="py-16 px-6">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-display font-black mb-8 text-center">Courier Services</h2>
            <div className="grid md:grid-cols-2 gap-6 mb-16">
              {SERVICES.map((s) => (
                <div key={s.title} className="bg-card border border-border rounded-2xl p-6 hover:border-primary/40 hover:shadow-lg transition-all">
                  <div className="text-4xl mb-4">{s.icon}</div>
                  <h3 className="font-display font-black text-lg mb-2">{s.title}</h3>
                  <p className="text-sm text-muted-foreground font-medium">{s.desc}</p>
                </div>
              ))}
            </div>

            <div className="bg-card border border-border rounded-2xl p-8 mb-16">
              <h2 className="text-xl font-display font-black mb-6 flex items-center gap-2"><MapPin className="w-5 h-5 text-primary" /> Coverage Areas</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {["Invercargill", "Bluff", "Gore", "Winton", "Riverton", "Te Anau", "Lumsden", "Queenstown"].map((area) => (
                  <div key={area} className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" /> {area}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-accent/10 border-2 border-accent/30 rounded-[2rem] p-10 text-center mb-16">
              <div className="text-4xl mb-4">📦</div>
              <h2 className="text-2xl font-display font-black mb-3">Get a Quote</h2>
              <p className="text-muted-foreground font-medium mb-6">
                For large or complex freight jobs, contact us directly for a custom quote.
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

            <div className="bg-primary rounded-[2rem] p-10 md:p-12 text-center text-primary-foreground">
              <h2 className="text-2xl md:text-3xl font-display font-black mb-3">Run a courier business?</h2>
              <p className="text-primary-foreground/80 font-medium mb-8 max-w-lg mx-auto">Join BookaWaka's courier network and get more jobs delivered to you automatically.</p>
              <a href={`${import.meta.env.BASE_URL}register`}>
                <Button size="lg" className="bg-accent text-accent-foreground hover:bg-white rounded-full h-14 px-10 font-extrabold shadow-xl">
                  Join as a Courier <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-foreground text-white/60 text-sm text-center py-6 px-6">
        <p>&copy; {new Date().getFullYear()} BookaWaka. All rights reserved. &mdash; <a href="/" className="hover:text-white transition-colors">Back to home</a></p>
      </footer>
    </div>
  );
}
