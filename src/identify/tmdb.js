// The Movie Database (TMDB) lookups: turns a title guess into a real entry with poster, year, genre and runtime.
const API = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w342";

export function formatRuntime(minutes) {
  const total = Number(minutes);
  if (!total) return "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function normalise(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function createTmdb({ key, language = "en-US", fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const enabled = Boolean(key);
  const bearer = key.startsWith("eyJ"); // v4 read access tokens are JWTs

  async function get(path, params = {}) {
    if (!enabled) throw Object.assign(new Error("TMDB_API_KEY is not set on the server."), { status: 503 });
    const url = new URL(API + path);
    for (const [k, v] of Object.entries({ language, ...params })) if (v !== undefined && v !== "") url.searchParams.set(k, v);
    if (!bearer) url.searchParams.set("api_key", key);
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json", ...(bearer ? { Authorization: `Bearer ${key}` } : {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`TMDB returned HTTP ${response.status}.`);
    return response.json();
  }

  function fromSearch(result, fallbackType) {
    const type = result.media_type || fallbackType;
    const date = result.release_date || result.first_air_date || "";
    return {
      tmdbId: result.id,
      type,
      title: result.title || result.name || "",
      originalTitle: result.original_title || result.original_name || "",
      year: date.slice(0, 4),
      poster: result.poster_path ? IMG + result.poster_path : "",
      overview: result.overview || "",
      popularity: result.popularity || 0,
    };
  }

  async function search(query, { type, year } = {}) {
    const q = String(query || "").trim();
    if (!q) return [];
    if (type === "movie" || type === "tv") {
      const params = { query: q, include_adult: "false" };
      if (year) params[type === "movie" ? "primary_release_year" : "first_air_date_year"] = year;
      let data = await get(`/search/${type}`, params);
      if (!data.results?.length && year) data = await get(`/search/${type}`, { query: q, include_adult: "false" });
      return (data.results || []).map((r) => fromSearch(r, type));
    }
    const data = await get("/search/multi", { query: q, include_adult: "false" });
    return (data.results || []).filter((r) => r.media_type === "movie" || r.media_type === "tv").map((r) => fromSearch(r));
  }

  async function details(type, id) {
    const data = await get(`/${type === "tv" ? "tv" : "movie"}/${Number(id)}`);
    const base = fromSearch({ ...data, media_type: type });
    const genre = (data.genres || []).slice(0, 2).map((g) => g.name).join(", ");
    let runtime = "";
    if (type === "tv") {
      const parts = [];
      if (data.number_of_seasons) parts.push(plural(data.number_of_seasons, "season"));
      if (data.number_of_episodes) parts.push(plural(data.number_of_episodes, "episode"));
      runtime = parts.join(" · ");
    } else {
      runtime = formatRuntime(data.runtime);
    }
    return { ...base, genre, runtime };
  }

  /** Picks the TMDB result that best fits Claude's guess (title match first, then year, then popularity). */
  function pickBest(results, candidate) {
    const wanted = [candidate.title, candidate.original_title].map(normalise).filter(Boolean);
    const score = (r) => {
      const names = [r.title, r.originalTitle].map(normalise);
      let s = 0;
      if (names.some((n) => wanted.includes(n))) s += 100;
      else if (names.some((n) => wanted.some((w) => n.includes(w) || w.includes(n)))) s += 40;
      if (candidate.year && r.year) {
        const diff = Math.abs(Number(r.year) - Number(candidate.year));
        s += diff === 0 ? 30 : diff === 1 ? 15 : 0;
      }
      return s + Math.min(r.popularity, 100) / 10;
    };
    return [...results].sort((a, b) => score(b) - score(a))[0];
  }

  async function resolveCandidate(candidate) {
    let results = await search(candidate.title, { type: candidate.type, year: candidate.year });
    if (!results.length && candidate.original_title) {
      results = await search(candidate.original_title, { type: candidate.type, year: candidate.year });
    }
    if (!results.length) results = await search(candidate.title);
    const best = pickBest(results, candidate);
    if (!best) return null;
    return details(best.type, best.tmdbId);
  }

  return { enabled, search, details, resolveCandidate };
}
