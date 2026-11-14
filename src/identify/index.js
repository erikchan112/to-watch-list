import { extractUrl, fetchPostMeta, fetchImage, platformFor } from "./postMeta.js";

/**
 * Shared post -> list of possible titles.
 * 1. Read the link's public preview (caption + image).  2. Ask Claude which titles it is about.
 * 3. Look each guess up on TMDB for the real title, poster, year, genre and runtime.
 */
export function createIdentifier({ identifyTitles, tmdb, fetchImpl = fetch, timeoutMs = 10000 }) {
  return async function identify({ text = "", url = "" }) {
    const sharedText = String(text).slice(0, 4000);
    const link = String(url || extractUrl(sharedText)).trim();
    if (!link && !sharedText.trim()) throw Object.assign(new Error("Share a link or some text."), { status: 400 });

    const platform = link ? platformFor(link) : "";
    let meta = { title: "", description: "", image: "" };
    if (link) {
      try {
        meta = await fetchPostMeta(link, { fetchImpl, timeoutMs });
      } catch (err) {
        meta.error = err.message;
      }
    }
    const image = meta.image ? await fetchImage(meta.image, { fetchImpl, timeoutMs }) : null;

    const { candidates, explanation } = await identifyTitles({ sharedText, url: link, platform, meta, image });

    const matches = [];
    const seen = new Set();
    for (const candidate of candidates) {
      let match = null;
      if (tmdb.enabled) {
        try {
          match = await tmdb.resolveCandidate(candidate);
        } catch {
          match = null;
        }
      }
      // Without TMDB (or no hit) keep Claude's guess so it can still be added by hand.
      match ||= {
        tmdbId: null,
        type: candidate.type,
        title: candidate.title,
        originalTitle: candidate.original_title,
        year: candidate.year,
        poster: "",
        overview: "",
        genre: "",
        runtime: "",
      };
      const key = match.tmdbId ? `${match.type}:${match.tmdbId}` : `guess:${match.title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({ ...match, confidence: candidate.confidence, reason: candidate.reason });
    }

    return {
      source: { url: link, platform, title: meta.title, description: meta.description, image: meta.image, readError: meta.error || "" },
      explanation,
      matches,
    };
  };
}
