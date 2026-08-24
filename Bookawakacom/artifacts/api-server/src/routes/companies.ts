import { Router } from "express";
import { getDatabase } from "../lib/firebase";

const companiesRouter = Router();

companiesRouter.get("/companies", async (req, res) => {
  try {
    const db = getDatabase();

    // Read company profiles from RTDB — written by the platform admin
    const snap = await db.ref("/companyProfiles").once("value");
    const profiles = snap.val() as Record<string, any> | null;

    if (!profiles) {
      // Fallback: derive companies from which IDs have pendingjobs configured
      const pbSnap = await db.ref("/pendingjobs").once("value");
      const pbVal = pbSnap.val() as Record<string, any> | null;
      const companyIds = pbVal ? Object.keys(pbVal) : [];

      const companies = companyIds.map((id) => ({
        id,
        name: `Company ${id}`,
        services: ["taxi"],
        active: true,
      }));

      res.json({ companies });
      return;
    }

    // Merge companySettings (Owner Panel) for operating hours when present.
    // Field is optional / often empty until companies configure hours.
    const settingsSnap = await db.ref("/companySettings").once("value");
    const settingsMap = (settingsSnap.val() as Record<string, any> | null) ?? {};
    // Registration historically wrote contact email only to superClients.
    const superSnap = await db.ref("/superClients").once("value");
    const superMap = (superSnap.val() as Record<string, any> | null) ?? {};

    const companies = Object.entries(profiles)
      .filter(([, v]) => v && v.active !== false)
      .map(([id, v]) => {
        const settings = settingsMap[id] || {};
        const superClient = superMap[id] || {};
        const hours =
          settings.operatingHours ??
          settings.operating_hours ??
          v.operatingHours ??
          v.operating_hours ??
          "";
        return {
          id,
          name: v.name ?? settings.name ?? `Company ${id}`,
          services: settings.services ?? v.services ?? ["taxi"],
          active: v.active ?? true,
          description: v.description ?? "",
          city: v.city ?? settings.city ?? "",
          country: v.country ?? "New Zealand",
          email:
            v.email ||
            settings.email ||
            v.contactEmail ||
            settings.contactEmail ||
            superClient.email ||
            superClient.contactEmail ||
            "",
          operatingHours: typeof hours === "string" ? hours : "",
        };
      });

    res.json({ companies });
  } catch (err: any) {
    console.error("GET /companies error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Public alias — same data, stable path for external integrations
companiesRouter.get("/public/companies", async (req, res) => {
  try {
    const db = getDatabase();
    const snap = await db.ref("/companyProfiles").once("value");
    const profiles = snap.val() as Record<string, any> | null;

    if (!profiles) {
      res.json({ companies: [] });
      return;
    }

    const companies = Object.entries(profiles)
      .filter(([, v]) => v && v.active !== false)
      .map(([id, v]) => ({
        id,
        name: v.name ?? `Company ${id}`,
        services: v.services ?? ["taxi"],
        city: v.city ?? "",
        country: v.country ?? "New Zealand",
        operatingHours: typeof v.operatingHours === "string" ? v.operatingHours : "",
      }));

    res.json({ companies });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default companiesRouter;
