// To watch list: client. No framework; talks to the JSON API in src/app.js.

const $ = (selector) => document.querySelector(selector);

const state = {
  items: [],
  tab: "to-watch",
  expanded: new Set(),
  features: { identify: false, search: false },
};

const POSTER_PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#a5afbd" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/></svg>');

// ---------- helpers ----------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key in el && key !== "list") el[key] = value;
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "/api/login") {
    showLogin();
  }
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status})`), { status: response.status, data });
  return data;
}

let toastTimer;
let undoAction = null;
function showToast(message, undo = null) {
  const toast = $("#toast");
  $("#toast-message").textContent = message;
  undoAction = undo;
  $("#undo-action").hidden = !undo;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    undoAction = null;
  }, undo ? 4500 : 3200);
}

function typeLabel(type) {
  return type === "tv" ? "TV series" : "Movie";
}

function itemMeta(item) {
  return [item.year, item.genre, typeLabel(item.type)].filter(Boolean).join(" · ");
}

function isUrl(text) {
  return /^\s*https?:\/\/\S+\s*$/i.test(text) || /https?:\/\/\S+/i.test(text);
}

// ---------- list ----------

function renderList() {
  const list = $("#movie-list");
  const empty = $("#empty-state");
  const toWatch = state.items.filter((item) => !item.watched);
  const watched = state.items.filter((item) => item.watched);
  $("#count-to-watch").textContent = toWatch.length ? `(${toWatch.length})` : "";
  $("#count-watched").textContent = watched.length ? `(${watched.length})` : "";

  const visible = state.tab === "watched"
    ? watched.sort((a, b) => (b.watchedAt || "").localeCompare(a.watchedAt || ""))
    : toWatch;

  const existing = new Map([...list.children].map((row) => [row.dataset.id, row]));
  const used = new Set();
  let previous = null;

  for (const item of visible) {
    let row = existing.get(item.id);
    if (!row) {
      row = $("#movie-row-template").content.firstElementChild.cloneNode(true);
      row.dataset.id = item.id;
      row.querySelector(".movie-checkbox").addEventListener("change", (event) => toggleWatched(item.id, event.currentTarget));
      row.querySelector(".expand-button").addEventListener("click", () => toggleExpanded(item.id));
      row.querySelector(".movie-text").addEventListener("click", () => toggleExpanded(item.id));
      row.querySelector(".detail-edit").addEventListener("click", () => openManualForm(findItem(item.id)));
      row.querySelector(".detail-delete").addEventListener("click", () => removeItem(item.id));
    }
    // keep DOM order equal to list order
    if (previous ? previous.nextSibling !== row : list.firstChild !== row) {
      previous ? previous.after(row) : list.prepend(row);
    }
    previous = row;
    used.add(item.id);

    const expanded = state.expanded.has(item.id);
    row.classList.toggle("is-watched", item.watched);
    row.classList.toggle("expanded", expanded);
    const checkbox = row.querySelector(".movie-checkbox");
    checkbox.checked = item.watched;
    checkbox.setAttribute("aria-label", `Mark ${item.title} as ${item.watched ? "not watched" : "watched"}`);
    row.querySelector(".movie-title").textContent = item.title;
    row.querySelector(".movie-meta").textContent = itemMeta(item) || "Details to be added";
    const img = row.querySelector(".movie-thumbnail");
    img.src = item.poster || POSTER_PLACEHOLDER;
    img.classList.toggle("placeholder", !item.poster);
    img.alt = item.poster ? `Poster for ${item.title}` : "";
    row.querySelector(".detail-genre").textContent = item.genre || "Not specified";
    row.querySelector(".detail-runtime").textContent = [item.year, item.runtime].filter(Boolean).join(" · ") || "Not specified";
    row.querySelector(".detail-notes").textContent = item.notes || item.overview || "No notes yet.";
    const source = row.querySelector(".detail-source");
    source.hidden = !item.sourceUrl;
    if (item.sourceUrl) {
      source.href = item.sourceUrl;
      source.textContent = `Open post ↗`;
    }
    const expand = row.querySelector(".expand-button");
    expand.setAttribute("aria-expanded", String(expanded));
    expand.setAttribute("aria-label", `${expanded ? "Hide" : "Show"} details for ${item.title}`);
  }

  for (const [id, row] of existing) if (!used.has(id)) row.remove();

  empty.hidden = visible.length > 0;
  empty.textContent = state.tab === "watched"
    ? "Nothing watched yet. Tick a title once you've seen it."
    : "Nothing here yet. Share a post to this app, or tap Add when inspiration strikes.";
}

function findItem(id) {
  return state.items.find((item) => item.id === id);
}

function upsert(item) {
  const index = state.items.findIndex((x) => x.id === item.id);
  if (index === -1) state.items.unshift(item);
  else state.items[index] = item;
  state.items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab-button").forEach((button) => {
    const selected = button.dataset.tab === tab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  renderList();
}

function toggleExpanded(id) {
  if (state.expanded.has(id)) state.expanded.delete(id);
  else state.expanded.add(id);
  renderList();
}

async function setWatched(id, watched) {
  const { item } = await api(`/api/items/${id}`, { method: "PATCH", body: { watched } });
  upsert(item);
  renderList();
}

async function toggleWatched(id, control) {
  const item = findItem(id);
  if (!item) return;
  const previous = item.watched;
  control.disabled = true;
  try {
    await setWatched(id, control.checked);
    showToast(`Moved to ${control.checked ? "Watched" : "To watch"}`, async () => {
      await setWatched(id, previous);
      setTab(previous ? "watched" : "to-watch");
    });
  } catch (err) {
    control.checked = previous;
    showToast(err.message);
  } finally {
    control.disabled = false;
  }
}

async function removeItem(id) {
  const item = findItem(id);
  if (!item) return;
  try {
    await api(`/api/items/${id}`, { method: "DELETE" });
    state.items = state.items.filter((x) => x.id !== id);
    renderList();
    showToast(`Removed ${item.title}`, async () => {
      const { item: restored } = await api("/api/items", { method: "POST", body: item });
      if (item.watched) await api(`/api/items/${restored.id}`, { method: "PATCH", body: { watched: true } });
      await loadItems();
    });
  } catch (err) {
    showToast(err.message);
  }
}

async function loadItems() {
  const { items } = await api("/api/items");
  state.items = items;
  renderList();
}

// ---------- sheet ----------

function openSheet(...content) {
  const sheet = $("#sheet");
  sheet.replaceChildren(...content);
  const overlay = $("#sheet-overlay");
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");
  sheet.scrollTop = 0;
}

function closeSheet() {
  const overlay = $("#sheet-overlay");
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
  $("#sheet").replaceChildren();
}

function sheetHeader(title, subtitle) {
  return [h("h2", { class: "form-heading", id: "sheet-title" }, title), subtitle ? h("p", { class: "sheet-sub" }, subtitle) : null];
}

function closeRow(label = "Close") {
  return h("div", { class: "form-actions" }, h("button", { class: "form-action cancel-action", type: "button", onclick: closeSheet }, label));
}

/** One candidate title with an Add button. */
function resultCard(match, { sourceUrl = "" } = {}) {
  const existing = match.existingId || (match.tmdbId && state.items.find((i) => i.tmdbId === match.tmdbId && i.type === match.type));
  const button = h("button", { class: "result-add", type: "button" }, existing ? (existing.watched || match.existingWatched ? "Watched" : "On list") : "Add");
  if (existing) button.disabled = true;
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Adding…";
    try {
      const { item } = await api("/api/items", {
        method: "POST",
        body: {
          tmdbId: match.tmdbId,
          type: match.type,
          title: match.title,
          year: match.year,
          genre: match.genre,
          runtime: match.runtime,
          poster: match.poster,
          overview: match.overview,
          sourceUrl,
        },
      });
      upsert(item);
      setTab("to-watch");
      closeSheet();
      showToast(`Added ${item.title} to your list.`);
    } catch (err) {
      if (err.status === 409) {
        button.textContent = "On list";
        showToast(`${match.title} is already on your list.`);
      } else {
        button.disabled = false;
        button.textContent = "Add";
        showToast(err.message);
      }
    }
  });

  const confidence = match.confidence ? h("span", { class: `chip ${match.confidence === "low" ? "low" : ""}` }, match.confidence === "high" ? "Best match" : match.confidence === "medium" ? "Likely" : "Maybe") : null;
  const original = match.originalTitle && match.originalTitle !== match.title ? ` (${match.originalTitle})` : "";
  return h(
    "div",
    { class: "result" },
    h("img", { src: match.poster || POSTER_PLACEHOLDER, alt: "", loading: "lazy" }),
    h(
      "div",
      {},
      h("p", { class: "result-title" }, match.title + original, confidence),
      h("p", { class: "result-meta" }, [match.year, typeLabel(match.type), match.genre, match.runtime].filter(Boolean).join(" · ")),
      match.reason ? h("p", { class: "result-reason" }, match.reason) : null,
    ),
    button,
  );
}

function loadingRow(text) {
  return h("div", { class: "loading" }, h("div", { class: "spinner" }), h("span", {}, text));
}

/** Add sheet: one box for a title search or a pasted link, plus a manual form. */
function openAddSheet(prefill = "") {
  const input = h("input", { class: "form-input", type: "search", placeholder: "Title, or paste a post link", value: prefill, enterKeyHint: "search", autocomplete: "off" });
  const results = h("div", { class: "results" });
  const form = h(
    "form",
    {
      class: "search-row",
      onsubmit: (event) => {
        event.preventDefault();
        const query = input.value.trim();
        if (!query) return;
        if (isUrl(query)) runIdentify({ text: query }, results);
        else runSearch(query, results);
      },
    },
    input,
    h("button", { class: "form-action primary-action", type: "submit" }, "Find"),
  );

  const hint = !state.features.search
    ? "Title search needs TMDB_API_KEY on the server. You can still add a title by hand."
    : "Search by name, or paste a link to a post and the app will work out what it's about.";

  openSheet(
    ...sheetHeader("Add to your list", hint),
    form,
    results,
    h("p", { class: "sheet-sub", style: "margin-top:16px" }, h("button", { class: "text-button", type: "button", onclick: () => openManualForm() }, "Enter details by hand")),
    closeRow("Cancel"),
  );
  setTimeout(() => input.focus(), 50);
}

async function runSearch(query, container) {
  container.replaceChildren(loadingRow("Searching…"));
  try {
    const { results } = await api(`/api/search?q=${encodeURIComponent(query)}`);
    container.replaceChildren(...(results.length ? results.map((r) => resultCard(r)) : [h("p", { class: "sheet-sub" }, "No titles found. Try another spelling, or enter it by hand.")]));
  } catch (err) {
    container.replaceChildren(h("p", { class: "sheet-sub" }, err.message));
  }
}

async function runIdentify(payload, container) {
  container.replaceChildren(loadingRow("Reading the post and finding the title…"));
  try {
    const result = await api("/api/identify", { method: "POST", body: payload });
    renderIdentifyResult(result, container);
  } catch (err) {
    container.replaceChildren(h("p", { class: "sheet-sub" }, err.message));
  }
}

function renderIdentifyResult(result, container) {
  const { source, matches, explanation } = result;
  const parts = [];
  if (source.url || source.description) {
    parts.push(
      h(
        "div",
        { class: "source-card" },
        h("img", { src: source.image || POSTER_PLACEHOLDER, alt: "", referrerPolicy: "no-referrer" }),
        h("p", {}, h("strong", {}, source.platform || "Shared post"), " ", source.description || source.title || source.url),
      ),
    );
  }
  if (matches.length) {
    parts.push(...matches.map((m) => resultCard(m, { sourceUrl: source.url })));
  } else {
    parts.push(h("p", { class: "sheet-sub" }, explanation || "Couldn't tell which title this post is about."));
  }
  if (matches.length && explanation) parts.push(h("p", { class: "sheet-sub" }, explanation));
  container.replaceChildren(...parts);
}

/** Opened by the iOS Shortcut (/share?text=…) or the Android share target. */
function openShareSheet(payload) {
  const results = h("div", { class: "results" });
  openSheet(
    ...sheetHeader("From your share", "Pick the title to add."),
    results,
    h(
      "p",
      { class: "sheet-sub", style: "margin-top:16px" },
      "Not the right one? ",
      h("button", { class: "text-button", type: "button", onclick: () => openAddSheet() }, "Search instead"),
    ),
    closeRow(),
  );
  if (!state.features.identify) {
    results.replaceChildren(h("p", { class: "sheet-sub" }, "Identifying posts needs ANTHROPIC_API_KEY on the server."));
    return;
  }
  runIdentify(payload, results);
}

/** The prototype's form, used for manual adds and for editing. */
function openManualForm(item = null) {
  const field = (label, input, full = false) => h("label", { class: `form-field${full ? " full" : ""}` }, h("span", { class: "field-label" }, label), input);
  const title = h("input", { class: "form-input", type: "text", maxLength: 200, required: true, value: item?.title || "" });
  const type = h("select", { class: "form-input" }, h("option", { value: "movie" }, "Movie"), h("option", { value: "tv" }, "TV series"));
  type.value = item?.type || "movie";
  const genre = h("input", { class: "form-input", type: "text", maxLength: 80, placeholder: "Drama", value: item?.genre || "" });
  const year = h("input", { class: "form-input", type: "text", maxLength: 4, inputMode: "numeric", placeholder: "2026", value: item?.year || "" });
  const runtime = h("input", { class: "form-input", type: "text", maxLength: 40, placeholder: "1h 48m", value: item?.runtime || "" });
  const notes = h("textarea", { class: "form-input", maxLength: 500, placeholder: "Why you want to watch it…" });
  notes.value = item?.notes || "";

  const submit = h("button", { class: "form-action primary-action", type: "submit" }, item ? "Save" : "Save movie");
  const form = h(
    "form",
    {
      novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        const body = { title: title.value.trim(), type: type.value, genre: genre.value, year: year.value, runtime: runtime.value, notes: notes.value };
        if (!body.title) {
          showToast("Add a title to save it.");
          title.focus();
          return;
        }
        submit.disabled = true;
        try {
          const { item: saved } = item
            ? await api(`/api/items/${item.id}`, { method: "PATCH", body })
            : await api("/api/items", { method: "POST", body });
          upsert(saved);
          if (!item) setTab("to-watch");
          else renderList();
          closeSheet();
          showToast(item ? "Saved." : "Added to your list.");
        } catch (err) {
          showToast(err.message);
        } finally {
          submit.disabled = false;
        }
      },
    },
    ...sheetHeader(item ? "Edit details" : "Add to your list"),
    h(
      "div",
      { class: "field-grid" },
      field("Title", title, true),
      field("Type", type),
      field("Year", year),
      field("Genre", genre),
      field("Runtime", runtime),
      field("Notes", notes, true),
    ),
    h("div", { class: "form-actions" }, h("button", { class: "form-action cancel-action", type: "button", onclick: closeSheet }, "Cancel"), submit),
  );
  openSheet(form);
  if (!item) setTimeout(() => title.focus(), 50);
}

function openSettings() {
  const origin = location.origin;
  const shareUrl = `${origin}/share?text=`;
  openSheet(
    ...sheetHeader("Share from Instagram, Threads, Facebook…", "On iPhone, add a Shortcut once and it will appear in the Share sheet of every app."),
    h(
      "ol",
      { class: "steps" },
      h("li", {}, "Open the Shortcuts app and tap + to make a new shortcut. Name it “To watch list”."),
      h("li", {}, "Tap the ⓘ (Details) button and turn on ", h("strong", {}, "Show in Share Sheet"), ". Set it to receive ", h("strong", {}, "URLs"), " and ", h("strong", {}, "Text"), "."),
      h("li", {}, "Add the action ", h("strong", {}, "URL Encode"), " with ", h("strong", {}, "Shortcut Input"), "."),
      h("li", {}, "Add ", h("strong", {}, "Text"), " with this, then the ", h("strong", {}, "URL Encoded Text"), " variable right after it:", h("span", { class: "code" }, shareUrl)),
      h("li", {}, "Add ", h("strong", {}, "Open URLs"), " with that Text."),
      h("li", {}, "In Instagram (or any app) tap Share → ", h("strong", {}, "To watch list"), ". Safari opens this page and suggests the title."),
    ),
    h("p", { class: "sheet-sub" }, "Tip: in Safari, Share → Add to Home Screen gives you an app icon for the list."),
    h(
      "div",
      { class: "form-actions" },
      h("button", { class: "form-action cancel-action", type: "button", onclick: closeSheet }, "Close"),
      h("button", { class: "form-action cancel-action", type: "button", onclick: logout }, "Sign out"),
    ),
  );
}

// ---------- session ----------

function showLogin() {
  $("#list-view").hidden = true;
  $("#login-view").hidden = false;
  closeSheet();
  setTimeout(() => $("#login-password").focus(), 50);
}

async function logout() {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  location.reload();
}

/** Shared content arrives as ?text=…&url=…&title=… (Shortcut or Web Share Target). */
function takePendingShare() {
  const params = new URLSearchParams(location.search);
  const text = [params.get("title"), params.get("text")].filter(Boolean).join("\n");
  const url = params.get("url") || "";
  if (text || url) {
    sessionStorage.setItem("pendingShare", JSON.stringify({ text, url }));
    history.replaceState(null, "", "/");
  }
  const pending = sessionStorage.getItem("pendingShare");
  return pending ? JSON.parse(pending) : null;
}

async function startApp() {
  $("#login-view").hidden = true;
  $("#list-view").hidden = false;
  await loadItems();
  const share = takePendingShare();
  if (share) {
    sessionStorage.removeItem("pendingShare");
    openShareSheet(share);
  }
}

async function init() {
  document.querySelectorAll(".tab-button").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
  $("#open-add-button").addEventListener("click", () => openAddSheet());
  $("#profile-button").addEventListener("click", openSettings);
  $("#sheet-overlay").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeSheet();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSheet();
  });
  $("#undo-action").addEventListener("click", async () => {
    const action = undoAction;
    undoAction = null;
    $("#toast").classList.remove("show");
    if (!action) return;
    try {
      await action();
    } catch (err) {
      showToast(err.message);
    }
  });
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/login", { method: "POST", body: { password: $("#login-password").value } });
      await startApp();
    } catch (err) {
      showToast(err.message);
    }
  });

  takePendingShare(); // stash share params before a possible sign-in
  const session = await api("/api/session");
  state.features = session.features || state.features;
  if (session.authenticated) await startApp();
  else showLogin();
}

init().catch((err) => showToast(err.message));
