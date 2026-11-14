import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMeta, extractUrl, isPublicHttpUrl, platformFor, fetchPostMeta, fetchImage } from "../src/identify/postMeta.js";
import { createTmdb, formatRuntime } from "../src/identify/tmdb.js";
import { createIdentifier } from "../src/identify/index.js";
import { createClaudeIdentifier } from "../src/identify/claude.js";
import { fakeFetch } from "./helpers.js";

const IG_HTML = `<!doctype html><html><head><title>Instagram</title>
<meta property="og:title" content="Netflix K-Content on Instagram: &quot;Who else cried at episode 12? 😭 #QueenOfTears&quot;">
<meta property="og:description" content="12K likes, 340 comments - netflixkcontent on March 30, 2024: &quot;Who else cried at episode 12? &#x1F62D; Kim Soo-hyun &amp; Kim Ji-won #QueenOfTears&quot;">
<meta property="og:image" content="/media/still.jpg">
</head><body></body></html>`;

test("parseMeta reads Open Graph tags and decodes entities", () => {
  const meta = parseMeta(IG_HTML);
  assert.match(meta.title, /^Netflix K-Content on Instagram: "Who else/);
  assert.match(meta.description, /Kim Soo-hyun & Kim Ji-won #QueenOfTears/);
  assert.match(meta.description, /😭/);
  assert.equal(meta.image, "/media/still.jpg");
  assert.equal(parseMeta("<title>Only &amp; title</title>").title, "Only & title");
});

test("extractUrl, platformFor, isPublicHttpUrl", () => {
  assert.equal(extractUrl("Look at this! https://www.instagram.com/reel/C5abc/?igsh=xyz."), "https://www.instagram.com/reel/C5abc/?igsh=xyz");
  assert.equal(extractUrl("no link"), "");
  assert.equal(platformFor("https://www.threads.net/@a/post/1"), "Threads");
  assert.equal(platformFor("https://www.threads.com/@a/post/1"), "Threads");
  assert.equal(platformFor("https://m.facebook.com/story"), "Facebook");
  assert.equal(platformFor("https://fb.watch/abc"), "Facebook");
  assert.equal(platformFor("https://www.instagram.com/p/1"), "Instagram");
  assert.equal(platformFor("https://example.org/x"), "example.org");
  for (const bad of ["file:///etc/passwd", "http://localhost:3000", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1", "http://169.254.169.254/latest", "http://[::1]/", "ftp://x.com", "nonsense"]) {
    assert.equal(isPublicHttpUrl(bad), false, bad);
  }
  assert.equal(isPublicHttpUrl("https://www.instagram.com/p/1"), true);
});

test("fetchPostMeta resolves relative image URLs; fetchImage checks type and size", async () => {
  const f = fakeFetch([
    ["/p/abc", { body: IG_HTML, headers: { "content-type": "text/html" } }],
    ["/media/still.jpg", { body: new Uint8Array([1, 2, 3]), headers: { "content-type": "image/jpeg" } }],
    ["/media/page.html", { body: "<html>", headers: { "content-type": "text/html" } }],
  ]);
  const meta = await fetchPostMeta("https://www.instagram.com/p/abc/", { fetchImpl: f });
  assert.equal(meta.image, "https://www.instagram.com/media/still.jpg");
  const image = await fetchImage(meta.image, { fetchImpl: f });
  assert.deepEqual(image, { mediaType: "image/jpeg", data: Buffer.from([1, 2, 3]).toString("base64") });
  assert.equal(await fetchImage("https://www.instagram.com/media/page.html", { fetchImpl: f }), null);
  await assert.rejects(fetchPostMeta("http://127.0.0.1/", { fetchImpl: f }), /public/);
});

test("formatRuntime", () => {
  assert.equal(formatRuntime(106), "1h 46m");
  assert.equal(formatRuntime(120), "2h");
  assert.equal(formatRuntime(45), "45m");
  assert.equal(formatRuntime(0), "");
});

function tmdbFetch() {
  return fakeFetch([
    ["/search/tv", (url) => ({
      json: url.includes("query=Queen+of+Tears") || url.includes("query=Queen%20of%20Tears")
        ? { results: [
            { id: 999, name: "Queen of Tears (fan edit)", original_name: "x", first_air_date: "2019-01-01", popularity: 1 },
            { id: 209374, name: "Queen of Tears", original_name: "눈물의 여왕", first_air_date: "2024-03-09", poster_path: "/q.jpg", popularity: 80 },
          ] }
        : { results: [] },
    })],
    ["/tv/209374", { json: { id: 209374, name: "Queen of Tears", original_name: "눈물의 여왕", first_air_date: "2024-03-09", poster_path: "/q.jpg", genres: [{ name: "Drama" }, { name: "Comedy" }, { name: "Romance" }], number_of_seasons: 1, number_of_episodes: 16, overview: "A queen of department stores…" } }],
    ["/search/movie", { json: { results: [] } }],
    ["/search/multi", { json: { results: [{ id: 5, media_type: "person", name: "Someone" }] } }],
  ]);
}

test("TMDB: picks the exact title and formats TV details; uses bearer for v4 tokens", async () => {
  const f = tmdbFetch();
  const tmdb = createTmdb({ key: "v3key", fetchImpl: f });
  const match = await tmdb.resolveCandidate({ title: "Queen of Tears", original_title: "눈물의 여왕", type: "tv", year: "2024" });
  assert.equal(match.tmdbId, 209374);
  assert.equal(match.type, "tv");
  assert.equal(match.year, "2024");
  assert.equal(match.genre, "Drama, Comedy");
  assert.equal(match.runtime, "1 season · 16 episodes");
  assert.equal(match.poster, "https://image.tmdb.org/t/p/w342/q.jpg");
  assert.ok(f.calls.every((u) => u.includes("api_key=v3key")));

  const none = await tmdb.resolveCandidate({ title: "Nothing", original_title: "", type: "movie", year: "" });
  assert.equal(none, null, "people from multi-search are ignored");

  let auth = "";
  const bearerFetch = async (url, init) => {
    auth = init.headers.Authorization;
    return new Response(JSON.stringify({ results: [] }), { headers: { "content-type": "application/json" } });
  };
  await createTmdb({ key: "eyJhbGciOi.token", fetchImpl: bearerFetch }).search("x");
  assert.equal(auth, "Bearer eyJhbGciOi.token");
});

test("identify pipeline: post -> Claude -> TMDB, de-duplicated, keeps unmatched guesses", async () => {
  const f = fakeFetch([
    ["instagram.com/p/abc", { body: IG_HTML, headers: { "content-type": "text/html" } }],
    ["/media/still.jpg", { body: new Uint8Array([9]), headers: { "content-type": "image/png" } }],
  ]);
  let seen;
  const identifyTitles = async (input) => {
    seen = input;
    return {
      explanation: "Hashtag names the show.",
      candidates: [
        { title: "Queen of Tears", original_title: "눈물의 여왕", type: "tv", year: "2024", confidence: "high", reason: "#QueenOfTears" },
        { title: "Queen of Tears", original_title: "", type: "tv", year: "", confidence: "low", reason: "dup" },
        { title: "Imaginary Show", original_title: "", type: "tv", year: "", confidence: "low", reason: "guess" },
      ],
    };
  };
  const tmdb = createTmdb({ key: "k", fetchImpl: tmdbFetch() });
  const identify = createIdentifier({ identifyTitles, tmdb, fetchImpl: f });
  const result = await identify({ text: "Check this https://www.instagram.com/p/abc/?igsh=1" });

  assert.equal(seen.platform, "Instagram");
  assert.equal(seen.url, "https://www.instagram.com/p/abc/?igsh=1");
  assert.match(seen.meta.description, /QueenOfTears/);
  assert.deepEqual(seen.image, { mediaType: "image/png", data: Buffer.from([9]).toString("base64") });

  assert.equal(result.source.platform, "Instagram");
  assert.equal(result.matches.length, 2);
  assert.equal(result.matches[0].tmdbId, 209374);
  assert.equal(result.matches[0].confidence, "high");
  assert.equal(result.matches[1].title, "Imaginary Show");
  assert.equal(result.matches[1].tmdbId, null);
});

test("identify still asks Claude when the link can't be read (login wall)", async () => {
  const f = fakeFetch([["facebook.com", { status: 403, body: "no" }]]);
  let seen;
  const identify = createIdentifier({
    identifyTitles: async (input) => ((seen = input), { explanation: "none", candidates: [] }),
    tmdb: { enabled: false },
    fetchImpl: f,
  });
  const result = await identify({ text: "Must watch: The Glory https://www.facebook.com/share/p/xyz/" });
  assert.match(seen.meta.error, /403/);
  assert.match(seen.sharedText, /The Glory/);
  assert.equal(result.source.readError, "The link returned HTTP 403.");
  await assert.rejects(identify({ text: "  " }), /Share a link/);
});

test("Claude identifier sends image + structured output request and parses JSON", async () => {
  let request;
  const client = {
    beta: {
      messages: {
        create: async (req) => {
          request = req;
          return {
            stop_reason: "end_turn",
            content: [
              { type: "thinking", thinking: "" },
              { type: "text", text: JSON.stringify({ explanation: "ok", candidates: [{ title: "Past Lives", original_title: "", type: "movie", year: "2023", confidence: "high", reason: "named" }] }) },
            ],
          };
        },
      },
    },
  };
  const identifyTitles = createClaudeIdentifier({ client, model: "claude-opus-5-5", effort: "medium" });
  const out = await identifyTitles({ sharedText: "", url: "https://x", platform: "Threads", meta: { title: "t", description: "d" }, image: { mediaType: "image/jpeg", data: "AAA" } });
  assert.equal(out.candidates[0].title, "Past Lives");
  assert.equal(request.model, "claude-opus-5-5");
  assert.equal(request.output_config.format.type, "json_schema");
  assert.equal(request.output_config.effort, "medium");
  assert.equal(request.fallbacks, "default");
  assert.equal(request.messages[0].content[0].type, "image");
  assert.match(request.messages[0].content[1].text, /Platform: Threads/);

  const refused = createClaudeIdentifier({ client: { beta: { messages: { create: async () => ({ stop_reason: "refusal", content: [] }) } } }, model: "m", effort: "low" });
  assert.deepEqual((await refused({ meta: {} })).candidates, []);

  await assert.rejects(createClaudeIdentifier({ apiKey: "" })({ meta: {} }), /ANTHROPIC_API_KEY/);
});
