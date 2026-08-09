import { Truck, Navigation, ArrowRight, CheckCircle2, Clock, Shield, Phone, Mail, MapPin, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

const SERVICES = [
  { title: "Emergency Towing", desc: "Broken down on the road? We'll get you and your vehicle to safety fast.", icon: "🚨" },
  { title: "Accident Recovery", desc: "Professional vehicle recovery after accidents, day or night.", icon: "🚧" },
  { title: "Flatbed Towing", desc: "Safe flatbed transport for low-clearance, classic, or damaged vehicles.", icon: "🚗" },
  { title: "Long-Distance Towing", desc: "Need your vehicle moved across Southland or further? We've got you.", icon: "🛣️" },
];

export default function TowingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/30 flex flex-col">
      <header className="bg-foreground text-white px-6 py-4 flex items-center justify-between shadow-xl">
        <a href="/" className="flex items-center gap-2 group">
          <div className="bg-primary text-primary-foreground p-2 rounded-xl rotate-3 group-hover:rotate-0 transition-transform">
            <Navigation className="w-5 h-5" />
          </div>
          <span className="font-display font-extrabold text-xl tracking-tight">BookaWaka</span>
        </a>
        <a href="tel:+6403123456">
          <Button size="sm" className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-full font-bold">
            <Phone className="w-4 h-4 mr-1.5" /> Emergency Call
          </Button>
        </a>
      </header>

      <main className="flex-1">
        <section className="bg-foreground text-white py-20 px-6">
          <div className="max-w-4xl mx-auto text-center">
            <div className="w-20 h-20 bg-destructive/20 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <Truck className="w-10 h-10 text-destructive" />
            </div>
            <h1 className="text-4xl md:text-6xl font-display font-black mb-4 leading-tight">
              Towing &amp; Recovery<br /><span className="text-accent">Southland</span>
            </h1>
            <p className="text-lg md:text-xl text-white/70 font-medium max-w-2xl mx-auto mb-10">
              Stuck on the side of the road? Our network of towing operators covers Invercargill and all of Southland — 24 hours a day.
            </p>
            <div className="flex flex-wrap gap-4 justify-center mb-10">
              <div className="flex items-center gap-2 bg-white/10 rounded-full px-5 py-2.5 text-sm font-bold"><Clock className="w-4 h-4 text-accent" /> 24/7 emergency</div>
              <div className="flex items-center gap-2 bg-white/10 rounded-full px-5 py-2.5 text-sm font-bold"><Shield className="w-4 h-4 text-accent" /> Insured operators</div>
              <div className="flex items-center gap-2 bg-white/10 rounded-full px-5 py-2.5 text-sm font-bold"><AlertTriangle className="w-4 h-4 text-accent" /> Fast response</div>
            </div>
            <div className="flex flex-wrap gap-4 justify-center">
              <a href="/tow">
                <Button size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90 rounded-full h-14 px-10 font-extrabold shadow-xl text-base">
                  <Truck className="w-5 h-5 mr-2" /> Request a Tow
                </Button>
              </a>
              <a href="tel:+6403123456">
                <Button size="lg" className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-full h-14 px-10 font-extrabold shadow-xl text-base">
                  <Phone className="w-5 h-5 mr-2" /> Emergency Call
                </Button>
              </a>
            </div>
          </div>
        </section>

        <section className="py-16 px-6">
          <div className="max-w-3xl mx-auto">

            {/* Emergency banner */}
            <div className="bg-destructive/10 border-2 border-destructive/30 rounded-2xl p-6 mb-10 flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
              <div className="w-14 h-14 bg-destructive/20 rounded-2xl flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-7 h-7 text-destructive" />
              </div>
              <div className="flex-1">
                <h3 className="font-display font-black text-lg mb-1">Broken down right now?</h3>
                <p className="text-sm text-muted-foreground font-medium">Call us immediately for the fastest response. Don't wait — operators are standing by.</p>
              </div>
              <a href="tel:+6403123456" className="flex-shrink-0">
                <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-full font-bold px-6">
                  <Phone className="w-4 h-4 mr-2" /> Call Now
                </Button>
              </a>
            </div>

            <h2 className="text-2xl font-display font-black mb-8 text-center">Our Towing Services</h2>
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
                {["Invercargill", "Bluff", "Gore", "Winton", "Riverton", "Te Anau", "Lumsden", "Manapouri"].map((area) => (
                  <div key={area} className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" /> {area}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-6 mb-16">
              <a href="/tow" className="block">
                <div className="bg-primary rounded-2xl p-8 text-center text-primary-foreground hover:bg-primary/90 transition-all hover:shadow-xl group h-full">
                  <Truck className="w-10 h-10 mx-auto mb-4 text-accent" />
                  <h3 className="text-xl font-display font-black mb-2">Request a Tow</h3>
                  <p className="text-primary-foreground/80 text-sm font-medium mb-4">Fill in the booking form and we'll dispatch the nearest available operator.</p>
                  <span className="inline-flex items-center gap-2 bg-accent text-accent-foreground rounded-full px-5 py-2 text-sm font-bold group-hover:bg-white transition-colors">
                    Book Now <ArrowRight className="w-4 h-4" />
                  </span>
                </div>
              </a>
              <a href="/tow/track" className="block">
                <div className="bg-card border-2 border-border rounded-2xl p-8 text-center hover:border-primary/40 hover:shadow-xl transition-all group h-full">
                  <MapPin className="w-10 h-10 mx-auto mb-4 text-primary" />
                  <h3 className="text-xl font-display font-black mb-2">Track Your Tow</h3>
                  <p className="text-muted-foreground text-sm font-medium mb-4">Already booked? Enter your job ID (sent to you by email) to track your job status.</p>
                  <span className="inline-flex items-center gap-2 bg-muted text-foreground rounded-full px-5 py-2 text-sm font-bold group-hover:bg-primary group-hover:text-white transition-colors">
                    Track Job <ArrowRight className="w-4 h-4" />
                  </span>
                </div>
              </a>
            </div>

            <div className="bg-primary rounded-[2rem] p-10 md:p-12 text-center text-primary-foreground">
              <h2 className="text-2xl md:text-3xl font-display font-black mb-3">Run a towing business?</h2>
              <p className="text-primary-foreground/80 font-medium mb-8 max-w-lg mx-auto">Join BookaWaka and connect with customers who need towing and recovery across Southland.</p>
              <a href={`${import.meta.env.BASE_URL}register`}>
                <Button size="lg" className="bg-accent text-accent-foreground hover:bg-white rounded-full h-14 px-10 font-extrabold shadow-xl">
                  Join as an Operator <ArrowRight className="w-5 h-5 ml-2" />
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
