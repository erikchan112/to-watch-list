import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const EDITABLE = ["title", "type", "year", "genre", "runtime", "notes", "poster", "overview", "watched", "expanded"];
const MAX_ITEMS = 2000;

/** The watch list, kept in one JSON file. Writes are serialised and atomic (write temp file, then rename). */
export class Store {
  constructor(file) {
    this.file = file;
    this.items = [];
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, "utf8"));
      this.items = Array.isArray(raw.items) ? raw.items : [];
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      this.items = [];
    }
    return this;
  }

  persist() {
    const snapshot = JSON.stringify({ version: 1, items: this.items }, null, 2);
    this.queue = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, snapshot);
      await fs.rename(tmp, this.file);
    });
    return this.queue;
  }

  list() {
    return [...this.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id) {
    return this.items.find((item) => item.id === id);
  }

  findByTmdb(mediaType, tmdbId) {
    if (!tmdbId) return undefined;
    return this.items.find((item) => item.tmdbId === tmdbId && item.type === mediaType);
  }

  async add(input) {
    if (this.items.length >= MAX_ITEMS) throw Object.assign(new Error("The list is full."), { status: 400 });
    const item = {
      id: crypto.randomUUID(),
      title: String(input.title).trim().slice(0, 200),
      type: input.type === "tv" ? "tv" : "movie",
      year: clean(input.year, 4),
      genre: clean(input.genre, 80),
      runtime: clean(input.runtime, 40),
      notes: clean(input.notes, 500),
      poster: clean(input.poster, 500),
      overview: clean(input.overview, 1500),
      tmdbId: Number(input.tmdbId) || null,
      sourceUrl: clean(input.sourceUrl, 1000),
      watched: false,
      expanded: false,
      createdAt: new Date().toISOString(),
      watchedAt: null,
    };
    this.items.push(item);
    await this.persist();
    return item;
  }

  async update(id, patch) {
    const item = this.get(id);
    if (!item) return undefined;
    for (const key of EDITABLE) {
      if (!(key in patch)) continue;
      if (key === "watched" || key === "expanded") {
        const value = Boolean(patch[key]);
        if (key === "watched" && value !== item.watched) item.watchedAt = value ? new Date().toISOString() : null;
        item[key] = value;
      } else if (key === "title") {
        const title = String(patch.title ?? "").trim();
        if (title) item.title = title.slice(0, 200);
      } else if (key === "type") {
        item.type = patch.type === "tv" ? "tv" : "movie";
      } else {
        item[key] = clean(patch[key], key === "overview" ? 1500 : 500);
      }
    }
    await this.persist();
    return item;
  }

  async remove(id) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) return undefined;
    const [removed] = this.items.splice(index, 1);
    await this.persist();
    return removed;
  }
}

function clean(value, max) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, max);
}
