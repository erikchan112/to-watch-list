import Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `You identify which movies or TV series (including dramas, anime, documentaries and variety shows) a social media post is about.

You get whatever could be read from a shared post: the text the user shared, the page title and description (usually the caption, sometimes prefixed with like counts and the account name), and possibly the post's preview image, which may be a still, a poster or a screenshot with subtitles.

Rules:
- Return the titles the post is actually about, most likely first. Use clues such as actor names, character names, quotes, hashtags, streaming platform names, posters and recognisable scenes.
- Give the title as it is best known in English when one exists, and put the original-language title (for example Korean, Japanese or Chinese) in original_title.
- type is "tv" for any series and "movie" for films.
- year is the release or first-air year as four digits, or "" if unsure.
- confidence: "high" when the post names it or it is unmistakable, "medium" when strongly implied, "low" for a guess.
- If the post is about no particular title (or the content is unreadable, e.g. a login page), return an empty candidates list and say why in explanation.
- At most 5 candidates. Never invent titles that do not exist.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates", "explanation"],
  properties: {
    explanation: { type: "string", description: "One short sentence on how the titles were identified, or why none were." },
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "original_title", "type", "year", "confidence", "reason"],
        properties: {
          title: { type: "string" },
          original_title: { type: "string" },
          type: { type: "string", enum: ["movie", "tv"] },
          year: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          reason: { type: "string", description: "The clue from the post, in a few words." },
        },
      },
    },
  },
};

export function createClaudeIdentifier({ apiKey, model, effort, client } = {}) {
  const anthropic = client || (apiKey ? new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 }) : null);

  return async function identifyTitles({ sharedText, url, platform, meta, image }) {
    if (!anthropic) throw Object.assign(new Error("ANTHROPIC_API_KEY is not set on the server."), { status: 503 });

    const lines = [
      `Platform: ${platform || "unknown"}`,
      `Link: ${url || "(none)"}`,
      `Shared text: ${sharedText || "(none)"}`,
      `Page title: ${meta?.title || "(none)"}`,
      `Page description: ${meta?.description || "(none)"}`,
      meta?.error ? `Note: the link could not be read (${meta.error}).` : "",
      image ? "The post's preview image is attached." : "No image was available.",
    ].filter(Boolean);

    const content = [];
    if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
    content.push({ type: "text", text: `${lines.join("\n")}\n\nWhich movie(s) or TV series is this post about?` });

    const response = await anthropic.beta.messages.create({
      model,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { effort, format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") return { candidates: [], explanation: "The post could not be analysed." };
    const text = response.content.find((block) => block.type === "text")?.text;
    if (!text) return { candidates: [], explanation: "No answer was returned." };
    const parsed = JSON.parse(text);
    return {
      explanation: parsed.explanation || "",
      candidates: (parsed.candidates || []).slice(0, 5),
    };
  };
}
