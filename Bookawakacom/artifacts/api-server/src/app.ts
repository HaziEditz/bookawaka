import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

const staticDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../invercargill-taxis/dist/public",
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Stripe webhook needs the raw body for signature verification — must come BEFORE express.json()
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * Native passenger-app Stripe AuthSession return pages under /api/*.
 * The SPA also has /passenger-app-return (preferred for new clients). This /api
 * alias exists because some OTAs send successUrl here — without it Express 404s
 * while the rest of /api/stripe/* works (exactly the production symptom).
 */
function passengerAppReturnHtml(kind: "success" | "cancel"): string {
  const title = kind === "success" ? "Payment confirmed" : "Payment cancelled";
  const body =
    kind === "success"
      ? "You can close this window — returning you to the BookaWaka passenger app."
      : "Payment was cancelled. You can close this window and return to BookaWaka.";
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#f8fafc;text-align:center;padding:24px}
  h1{font-size:1.35rem;margin:0 0 8px}p{opacity:.85;margin:0;line-height:1.45}
</style>
</head><body>
  <div><h1>${title}</h1><p>${body}</p></div>
  <script>try{window.close()}catch(e){}setTimeout(function(){try{window.close()}catch(e){}},400)</script>
</body></html>`;
}

app.get("/api/passenger-app-return", (_req, res) => {
  res.status(200).type("html").send(passengerAppReturnHtml("success"));
});
app.get("/api/passenger-app-cancel", (_req, res) => {
  res.status(200).type("html").send(passengerAppReturnHtml("cancel"));
});

// Surface A — Public website (bookawaka.com) — original mount, unchanged
app.use("/api", router);

// Surface B — Passenger mobile app — same routes, alias namespace.
// Backward-safe: existing /api/* keeps working forever for the website.
// Mobile clients should call /api/passenger/* so the mobile traffic is
// distinguishable in logs and can later diverge without breaking the web.
app.use("/api/passenger", router);

// Invercargill-taxis Vite build (artifacts/invercargill-taxis/dist/public)
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
  logger.info({ staticDir }, "Serving invercargill-taxis frontend");
} else {
  logger.warn({ staticDir }, "Frontend build not found — run invercargill-taxis build first");
}

export default app;
