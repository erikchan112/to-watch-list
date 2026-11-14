import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { createAuth } from "../src/auth.js";
import { createApp } from "../src/app.js";

export async function startServer({ password = "", identify, tmdb } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "twl-"));
  const store = await new Store(path.join(dir, "list.json")).load();
  const auth = createAuth({ password, secret: "test-secret" });
  const app = createApp({
    store,
    auth,
    identify: identify || (async () => ({ source: {}, explanation: "", matches: [] })),
    tmdb: tmdb || { enabled: false, search: async () => [], details: async () => ({}) },
    features: { identify: true, search: true },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  async function call(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  }
  return {
    store,
    dir,
    call,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

/** Minimal fetch stand-in: routes by URL substring. */
export function fakeFetch(routes) {
  const calls = [];
  const impl = async (input) => {
    const url = String(input);
    calls.push(url);
    for (const [pattern, reply] of routes) {
      if (url.includes(pattern)) {
        const r = typeof reply === "function" ? reply(url) : reply;
        const headers = new Headers(r.headers || {});
        const body = r.json !== undefined ? JSON.stringify(r.json) : r.body;
        if (r.json !== undefined) headers.set("content-type", "application/json");
        const response = new Response(body, { status: r.status || 200, headers });
        Object.defineProperty(response, "url", { value: url });
        return response;
      }
    }
    return new Response("not found", { status: 404 });
  };
  impl.calls = calls;
  return impl;
}
