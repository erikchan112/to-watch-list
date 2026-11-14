# To watch list

A personal to-watch list for movies and TV dramas. When you see a post about a show on Instagram, Threads, Facebook, TikTok, YouTube or X, tap **Share → To watch list**. The app reads the post, works out which title it is about, and you tap **Add**.

The design follows the Canva prototype: To watch / Watched tabs, tick to mark as watched (with Undo), tap a row for the poster, genre, runtime and notes, and an **Add** button for searching or typing a title in.

## How it works

```
Share sheet (iPhone Shortcut)  →  /share?text=<post link>  →  POST /api/identify
                                                                 1. read the post's public preview (caption + image)
                                                                 2. Claude: which movie / series is this about?
                                                                 3. TMDB: real title, poster, year, genre, runtime
                                   pick a match  →  POST /api/items  →  data/watchlist.json
```

- **Reading the post.** The server fetches the link and reads its Open Graph tags (`og:title`, `og:description`, `og:image`). For Instagram and Threads the description usually holds the caption. Facebook often returns a login page instead, so for those posts Claude only sees the link and any text that came with the share.
- **Identifying the title.** Claude (`claude-opus-5-5`) gets the caption, the page title and the preview image, and returns up to 5 candidates as structured JSON. Each candidate has an English title, the original title (Korean, Japanese, Chinese…), movie or TV, year, a confidence level and the clue it used.
- **Details.** Each candidate is looked up on TMDB, which adds the poster, genres and a runtime (`1h 46m` for movies, `1 season · 16 episodes` for series). Without a TMDB key, Claude's guesses are still shown and you can add them without that extra detail.
- **One list, one person.** Everything is stored in a single JSON file. `APP_PASSWORD` protects it, and your phone stays signed in for a year.

## Run locally

```bash
npm install
cp .env.example .env   # add ANTHROPIC_API_KEY, TMDB_API_KEY, APP_PASSWORD
npm start              # http://localhost:3000
npm test
```

You need Node 20 or later. The app starts without the keys: with no `ANTHROPIC_API_KEY` you can't identify posts, and with no `TMDB_API_KEY` there is no search and there are no posters. Manual adding always works.

## Put it online

The iPhone Shortcut needs a public HTTPS address. `render.yaml` sets up a Render Blueprint: choose **New → Blueprint**, pick this repo, and enter `APP_PASSWORD`, `ANTHROPIC_API_KEY` and `TMDB_API_KEY` when asked.

The list is a file, so it needs a persistent disk. The Blueprint attaches a 1 GB disk, which requires the Starter plan. On a free instance the file is wiped on every deploy or restart. Any host with a persistent volume (Fly.io, Railway, a home server) works too: set `DATA_FILE` to a path on that volume.

## Add it to the iPhone Share sheet

iOS only lets App Store apps add themselves to the Share sheet, so this uses a Shortcut instead. It takes about a minute to set up. The same steps are in the app under the profile button.

1. Open **Shortcuts**, tap **+**, and name the shortcut **To watch list**.
2. Tap **ⓘ** and turn on **Show in Share Sheet**. Set it to receive **URLs** and **Text**.
3. Add the action **URL Encode** with **Shortcut Input**.
4. Add a **Text** action containing `https://YOUR-APP-ADDRESS/share?text=`, followed by the **URL Encoded Text** variable.
5. Add **Open URLs** with that Text.

Then, in Instagram, tap **Share → To watch list**. Safari opens the app with the suggested titles. To get a home-screen icon for your list, open the app in Safari and use **Share → Add to Home Screen**.

On Android, install the site from Chrome (**Add to Home screen**). The app then appears directly in the Share menu, because the manifest declares a `share_target`.

## API

All `/api/*` routes except `session`, `login` and `logout` need the login cookie when `APP_PASSWORD` is set.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/session` | `{ authenticated, authRequired, features }` |
| POST | `/api/login` | `{ password }` sets an HttpOnly cookie |
| POST | `/api/logout` | |
| GET | `/api/items` | Newest first |
| POST | `/api/items` | `{ tmdbId, type }` fills the details from TMDB. Manual adds send `{ title, type, year, genre, runtime, notes }`. Returns `409` and the existing item if the TMDB title is already on the list. |
| PATCH | `/api/items/:id` | Any of `title, type, year, genre, runtime, notes, poster, overview, watched` |
| DELETE | `/api/items/:id` | |
| POST | `/api/identify` | `{ text, url }` → `{ source, explanation, matches[] }`. Matches that are already on the list carry `existingId`. |
| GET | `/api/search?q=&type=` | TMDB title search (movies and TV) |

## Limits worth knowing

- **Login walls.** Instagram, Threads and especially Facebook sometimes serve a login page to servers. When that happens, Claude has only the link and any shared text to go on. If it can't tell what the post is about, it says so, and **Search instead** lets you type the title.
- **Cost.** Each shared post is one Claude request with an image, which costs a few US cents at most. `CLAUDE_EFFORT=low` makes it faster and cheaper, and `CLAUDE_MODEL` switches the model.
- **Link safety.** The server reads only public `http(s)` links and refuses `localhost` and private-network addresses.
