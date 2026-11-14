import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { startServer } from "./helpers.js";
import { createAuth } from "../src/auth.js";

test("items: add, list, mark watched, edit, delete, persisted to disk", async () => {
  const srv = await startServer();
  try {
    let r = await srv.call("POST", "/api/items", { title: "  Past Lives ", type: "movie", year: "2023", genre: "Drama", runtime: "1h 46m", notes: "From IG" });
    assert.equal(r.status, 201);
    const id = r.body.item.id;
    assert.equal(r.body.item.title, "Past Lives");
    assert.equal(r.body.item.watched, false);

    r = await srv.call("POST", "/api/items", { title: "Moving", type: "tv" });
    assert.equal(r.body.item.type, "tv");

    r = await srv.call("GET", "/api/items");
    assert.deepEqual(r.body.items.map((i) => i.title), ["Moving", "Past Lives"]);

    r = await srv.call("PATCH", `/api/items/${id}`, { watched: true, notes: "Loved it", id: "hacked", createdAt: "x" });
    assert.equal(r.body.item.watched, true);
    assert.ok(r.body.item.watchedAt);
    assert.equal(r.body.item.notes, "Loved it");
    assert.equal(r.body.item.id, id);

    r = await srv.call("PATCH", `/api/items/${id}`, { title: "" });
    assert.equal(r.body.item.title, "Past Lives", "empty title is ignored");

    const saved = JSON.parse(await fs.readFile(path.join(srv.dir, "list.json"), "utf8"));
    assert.equal(saved.items.length, 2);

    r = await srv.call("DELETE", `/api/items/${id}`);
    assert.equal(r.status, 200);
    r = await srv.call("DELETE", `/api/items/${id}`);
    assert.equal(r.status, 404);
    r = await srv.call("PATCH", "/api/items/nope", { watched: true });
    assert.equal(r.status, 404);
  } finally {
    await srv.close();
  }
});

test("items: title required, bad JSON is a 400", async () => {
  const srv = await startServer();
  try {
    assert.equal((await srv.call("POST", "/api/items", { title: "  " })).status, 400);
    const res = await srv.call("POST", "/api/items", undefined);
    assert.equal(res.status, 400);
  } finally {
    await srv.close();
  }
});

test("items: TMDB id fills details and duplicates return 409", async () => {
  const tmdb = {
    enabled: true,
    search: async () => [],
    details: async (type, id) => ({ tmdbId: id, type, title: "Queen of Tears", year: "2024", genre: "Drama, Comedy", runtime: "1 season · 16 episodes", poster: "https://img/p.jpg", overview: "…" }),
  };
  const srv = await startServer({ tmdb });
  try {
    let r = await srv.call("POST", "/api/items", { tmdbId: 209374, type: "tv", sourceUrl: "https://www.instagram.com/p/abc/" });
    assert.equal(r.status, 201);
    assert.equal(r.body.item.title, "Queen of Tears");
    assert.equal(r.body.item.runtime, "1 season · 16 episodes");
    assert.equal(r.body.item.sourceUrl, "https://www.instagram.com/p/abc/");
    r = await srv.call("POST", "/api/items", { tmdbId: 209374, type: "tv" });
    assert.equal(r.status, 409);
    assert.equal(r.body.item.title, "Queen of Tears");
    // same id but a movie is a different title
    r = await srv.call("POST", "/api/items", { tmdbId: 209374, type: "movie", title: "Other" });
    assert.equal(r.status, 201);
  } finally {
    await srv.close();
  }
});

test("identify marks matches already on the list", async () => {
  const identify = async ({ text }) => ({
    source: { url: text },
    explanation: "",
    matches: [
      { tmdbId: 1, type: "movie", title: "A" },
      { tmdbId: 2, type: "movie", title: "B" },
    ],
  });
  const srv = await startServer({ identify });
  try {
    await srv.call("POST", "/api/items", { tmdbId: 2, type: "movie", title: "B" });
    const r = await srv.call("POST", "/api/identify", { text: "https://threads.net/x" });
    assert.equal(r.status, 200);
    assert.equal(r.body.matches[0].existingId, null);
    assert.ok(r.body.matches[1].existingId);
  } finally {
    await srv.close();
  }
});

test("password: API locked until sign-in; wrong password rejected; logout", async () => {
  const srv = await startServer({ password: "popcorn" });
  try {
    let r = await srv.call("GET", "/api/session");
    assert.deepEqual([r.body.authenticated, r.body.authRequired], [false, true]);
    assert.equal((await srv.call("GET", "/api/items")).status, 401);
    assert.equal((await srv.call("POST", "/api/identify", { text: "x" })).status, 401);
    assert.equal((await srv.call("POST", "/api/login", { password: "nope" })).status, 401);
    r = await srv.call("POST", "/api/login", { password: "popcorn" });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("set-cookie"), /HttpOnly/);
    assert.equal((await srv.call("GET", "/api/items")).status, 200);
    await srv.call("POST", "/api/logout");
    assert.equal((await srv.call("GET", "/api/items")).status, 401);
  } finally {
    await srv.close();
  }
});

test("session cookies: valid accepted, forged or expired rejected", () => {
  const auth = createAuth({ password: "popcorn", secret: "s3cret" });
  const headers = {};
  auth.setSession({ secure: true, headers: {} }, { setHeader: (k, v) => (headers[k] = v) });
  const token = headers["Set-Cookie"].split(";")[0];
  assert.match(headers["Set-Cookie"], /Secure/);
  const req = (cookie) => ({ headers: { cookie } });
  assert.equal(auth.isAuthenticated(req(token)), true);
  const [name, value] = token.split("=");
  const [v, exp] = value.split(".");
  assert.equal(auth.isAuthenticated(req(`${name}=${v}.${Number(exp) + 999999}.${value.split(".")[2]}`)), false, "changed expiry");
  assert.equal(auth.isAuthenticated(req(`${name}=${v}.${exp}.AAAA`)), false, "bad signature");
  const other = createAuth({ password: "popcorn", secret: "different" });
  assert.equal(other.isAuthenticated(req(token)), false, "other secret");
  assert.equal(createAuth({ password: "" }).isAuthenticated(req("")), true, "no password = open");
});

test("static app and /share are served", async () => {
  const srv = await startServer();
  try {
    let r = await srv.call("GET", "/share?text=https%3A%2F%2Fwww.instagram.com%2Fp%2Fabc%2F");
    assert.equal(r.status, 200);
    assert.match(r.body, /To watch list/);
    r = await srv.call("GET", "/manifest.webmanifest");
    assert.equal(r.status, 200);
    assert.equal(r.body.share_target.action, "/share");
    assert.equal((await srv.call("GET", "/health")).body.ok, true);
  } finally {
    await srv.close();
  }
});
