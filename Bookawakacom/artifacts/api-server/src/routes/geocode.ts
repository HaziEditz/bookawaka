import { Router } from "express";
import { GeocodeUpstreamError, geocodeProviderLabel, searchNzPlaces } from "../lib/geocode-search";

const geocodeRouter = Router();

// Proxy geocode searches so we can:
//  1. Identify the app (User-Agent + Referer) per Nominatim policy
//  2. Enforce app-wide ≤1 req/s + result caching
//  3. Prefer LocationIQ when LOCATIONIQ_API_KEY is set (autocomplete-safe free tier)
//  4. Surface real upstream errors instead of an empty suggestion list
geocodeRouter.get("/geocode", async (req, res) => {
  const { q, countrycodes, viewbox, bounded, limit } = req.query as {
    q?: string;
    countrycodes?: string;
    viewbox?: string;
    bounded?: string;
    limit?: string;
  };
  if (!q || q.trim().length < 3) {
    res.json([]);
    return;
  }

  const parsedLimit = limit ? parseInt(limit, 10) : 8;
  const safeLimit = Number.isFinite(parsedLimit)
    ? Math.min(10, Math.max(1, parsedLimit))
    : 8;

  try {
    const data = await searchNzPlaces(q, {
      countrycodes: countrycodes?.trim() || "nz",
      viewbox: viewbox?.trim() || "167,-47,170,-45",
      bounded: bounded?.trim() || "0",
      limit: safeLimit,
    });
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Geocode-Provider", geocodeProviderLabel());
    res.json(Array.isArray(data) ? data : []);
  } catch (err: any) {
    if (err instanceof GeocodeUpstreamError) {
      req.log.warn(
        { err: err.message, status: err.status, provider: err.provider, q },
        "GET /geocode upstream error",
      );
      res.status(503).json({
        error: err.message,
        code: "GEOCODE_UPSTREAM",
        provider: err.provider,
        status: err.status,
      });
      return;
    }
    req.log.warn({ err }, "GET /geocode proxy error");
    res.status(503).json({
      error: "Address lookup temporarily unavailable. Please try again.",
      code: "GEOCODE_PROXY",
    });
  }
});

/** Debug: call Nominatim directly with a fixed query to verify upstream connectivity. */
geocodeRouter.get("/geocode-test", async (req, res) => {
  const query = "Dee Street Invercargill";
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("countrycodes", "nz");
  url.searchParams.set("limit", "8");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("namedetails", "1");

  try {
    const startedAt = Date.now();
    const upstream = await fetch(url.toString(), {
      headers: {
        "User-Agent": "BookaWaka Booking Portal/1.0 (https://bookawaka.com; info@bookawaka.com)",
        Referer: "https://bookawaka.com/",
        "Accept-Language": "en",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    const rawText = await upstream.text();
    let data: unknown;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = rawText;
    }

    res.json({
      ok: upstream.ok,
      query,
      url: url.toString(),
      status: upstream.status,
      statusText: upstream.statusText,
      elapsedMs: Date.now() - startedAt,
      hasLocationIqKey: !!(process.env.LOCATIONIQ_API_KEY || process.env.LOCATION_IQ_API_KEY),
      data,
    });
  } catch (err: any) {
    req.log.error({ err }, "GET /geocode-test error");
    res.status(502).json({
      ok: false,
      query,
      url: url.toString(),
      error: err.message ?? String(err),
      hasLocationIqKey: !!(process.env.LOCATIONIQ_API_KEY || process.env.LOCATION_IQ_API_KEY),
    });
  }
});

export default geocodeRouter;
