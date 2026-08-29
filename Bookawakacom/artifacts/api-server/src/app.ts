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
function passengerAppReturnHtml(
  kind: "success" | "cancel",
  qs: { booking?: string; cid?: string; sessionId?: string },
): string {
  const title = kind === "success" ? "Payment confirmed" : "Payment cancelled";
  const body =
    kind === "success"
      ? "You can close this window — returning you to the BookaWaka passenger app."
      : "Payment was cancelled. You can close this window and return to BookaWaka.";
  const booking = encodeURIComponent(String(qs.booking || "").trim());
  const cid = encodeURIComponent(String(qs.cid || "").trim());
  const sessionId = encodeURIComponent(String(qs.sessionId || "").trim());
  const deep = `passenger-app://stripe-return?booking=${booking}&cid=${cid}&session_id=${sessionId}&kind=${kind}`;
  const deepJson = JSON.stringify(deep);
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#f8fafc;text-align:center;padding:24px}
  h1{font-size:1.35rem;margin:0 0 8px}p{opacity:.85;margin:0 0 16px;line-height:1.45}
  a{display:inline-block;padding:12px 18px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600}
</style>
</head><body>
  <div>
    <h1>${title}</h1>
    <p>${body}</p>
    <a href=${deepJson}>Open BookaWaka</a>
  </div>
  <script>
    (function(){
      var deep=${deepJson};
      try{window.location.href=deep}catch(e){}
      setTimeout(function(){try{window.location.replace(deep)}catch(e){}},250);
      setTimeout(function(){try{window.close()}catch(e){}},1200);
    })();
  </script>
</body></html>`;
}

app.get("/api/passenger-app-return", (req, res) => {
  const booking = typeof req.query.booking === "string" ? req.query.booking : "";
  const cid = typeof req.query.cid === "string" ? req.query.cid : "";
  const sessionId =
    typeof req.query.session_id === "string"
      ? req.query.session_id
      : typeof req.query.sessionId === "string"
        ? req.query.sessionId
        : "";
  res.status(200).type("html").send(passengerAppReturnHtml("success", { booking, cid, sessionId }));
});
app.get("/api/passenger-app-cancel", (req, res) => {
  const booking = typeof req.query.booking === "string" ? req.query.booking : "";
  const cid = typeof req.query.cid === "string" ? req.query.cid : "";
  res.status(200).type("html").send(passengerAppReturnHtml("cancel", { booking, cid }));
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
