import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

export function createApp({ store, auth, identify, tmdb, features }) {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_req, res) => res.json({ ok: true, items: store.items.length }));

  app.get("/api/session", (req, res) => {
    res.json({ authenticated: auth.isAuthenticated(req), authRequired: auth.required, features });
  });

  app.post("/api/login", (req, res) => {
    if (!auth.checkPassword(req.body?.password)) return res.status(401).json({ error: "Wrong password." });
    auth.setSession(req, res);
    res.json({ ok: true });
  });

  app.post("/api/logout", (_req, res) => {
    auth.clearSession(res);
    res.json({ ok: true });
  });

  const api = express.Router();
  api.use(auth.requireAuth);

  api.get("/items", (_req, res) => res.json({ items: store.list() }));

  api.post("/items", async (req, res) => {
    const body = req.body || {};
    const type = body.type === "tv" ? "tv" : "movie";
    const tmdbId = Number(body.tmdbId) || null;

    const existing = store.findByTmdb(type, tmdbId);
    if (existing) return res.status(409).json({ error: "Already in your list.", item: existing });

    let details = {};
    if (tmdbId && tmdb.enabled) {
      try {
        details = await tmdb.details(type, tmdbId);
      } catch {
        details = {};
      }
    }
    const pick = (key) => (body[key] !== undefined && body[key] !== "" ? body[key] : details[key]);
    const title = String(pick("title") || "").trim();
    if (!title) return res.status(400).json({ error: "A title is required." });

    const item = await store.add({
      title,
      type,
      tmdbId,
      year: pick("year"),
      genre: pick("genre"),
      runtime: pick("runtime"),
      poster: pick("poster"),
      overview: pick("overview"),
      notes: body.notes,
      sourceUrl: body.sourceUrl,
    });
    res.status(201).json({ item });
  });

  api.patch("/items/:id", async (req, res) => {
    const item = await store.update(req.params.id, req.body || {});
    if (!item) return res.status(404).json({ error: "Not found." });
    res.json({ item });
  });

  api.delete("/items/:id", async (req, res) => {
    const item = await store.remove(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found." });
    res.json({ item });
  });

  api.post("/identify", async (req, res) => {
    const result = await identify({ text: req.body?.text, url: req.body?.url });
    // Flag titles that are already on the list so the app can say so.
    for (const match of result.matches) {
      const existing = store.findByTmdb(match.type, match.tmdbId);
      match.existingId = existing?.id || null;
      match.existingWatched = existing?.watched || false;
    }
    res.json(result);
  });

  api.get("/search", async (req, res) => {
    const type = ["movie", "tv"].includes(req.query.type) ? req.query.type : undefined;
    const results = await tmdb.search(String(req.query.q || "").slice(0, 200), { type });
    res.json({ results: results.slice(0, 12) });
  });

  app.use("/api", api);

  app.use(express.static(publicDir, { extensions: ["html"], maxAge: "1h", setHeaders: noCacheHtml }));
  // The iOS Shortcut opens /share?text=…; the page reads the query string itself.
  app.get("/share", (_req, res) => res.sendFile(path.join(publicDir, "index.html"), { headers: { "Cache-Control": "no-cache" } }));

  app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === "entity.parse.failed" ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 && !err.status ? "Something went wrong." : err.message });
  });

  return app;
}

function noCacheHtml(res, filePath) {
  if (filePath.endsWith(".html") || filePath.endsWith(".webmanifest")) res.setHeader("Cache-Control", "no-cache");
}
