import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { createAuth } from "./auth.js";
import { createTmdb } from "./identify/tmdb.js";
import { createClaudeIdentifier } from "./identify/claude.js";
import { createIdentifier } from "./identify/index.js";
import { createApp } from "./app.js";

try {
  process.loadEnvFile?.(".env");
} catch {
  // no .env file: rely on the real environment
}

const cfg = loadConfig();

const store = await new Store(cfg.dataFile).load();
const auth = createAuth({ password: cfg.appPassword, secret: cfg.sessionSecret });
const tmdb = createTmdb({ key: cfg.tmdbKey, language: cfg.tmdbLanguage, timeoutMs: cfg.requestTimeoutMs });
const identifyTitles = createClaudeIdentifier({ apiKey: cfg.anthropicApiKey, model: cfg.claudeModel, effort: cfg.claudeEffort });
const identify = createIdentifier({ identifyTitles, tmdb, timeoutMs: cfg.requestTimeoutMs });

const app = createApp({
  store,
  auth,
  identify,
  tmdb,
  features: { identify: Boolean(cfg.anthropicApiKey), search: tmdb.enabled },
});

app.listen(cfg.port, () => {
  console.log(`To watch list on http://localhost:${cfg.port} (${store.items.length} items, data in ${cfg.dataFile})`);
  if (!cfg.appPassword) console.warn("APP_PASSWORD is not set: anyone who can reach this server can edit the list.");
  if (!cfg.anthropicApiKey) console.warn("ANTHROPIC_API_KEY is not set: identifying shared posts is disabled.");
  if (!tmdb.enabled) console.warn("TMDB_API_KEY is not set: no posters, details or title search.");
});
