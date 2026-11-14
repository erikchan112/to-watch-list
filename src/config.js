import path from "node:path";

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 3000,
    // Shared password for the single owner of the list. Leave empty only for local development.
    appPassword: env.APP_PASSWORD || "",
    // Secret used to sign the login cookie. Falls back to the password so one setting is enough.
    sessionSecret: env.SESSION_SECRET || env.APP_PASSWORD || "dev-secret",
    dataFile: env.DATA_FILE || path.resolve("data", "watchlist.json"),
    anthropicApiKey: env.ANTHROPIC_API_KEY || "",
    claudeModel: env.CLAUDE_MODEL || "claude-opus-5-5",
    claudeEffort: env.CLAUDE_EFFORT || "medium",
    // TMDB accepts either a v3 API key or a v4 "API Read Access Token".
    tmdbKey: env.TMDB_API_KEY || env.TMDB_READ_TOKEN || "",
    tmdbLanguage: env.TMDB_LANGUAGE || "en-US",
    requestTimeoutMs: Number(env.REQUEST_TIMEOUT_MS) || 10000,
  };
}
