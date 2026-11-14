// Reads what a shared link exposes publicly: Open Graph / Twitter card tags and the page title.
// Instagram, Facebook and Threads often hide posts behind a login wall, so this is best effort;
// the caption usually still appears in og:description.

const UA = "Mozilla/5.0 (compatible; ToWatchListBot/1.0; personal watch list)";
const MAX_HTML_BYTES = 1_500_000;
const MAX_IMAGE_BYTES = 4_500_000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const PLATFORMS = [
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)threads\.(net|com)$/, "Threads"],
  [/(^|\.)(facebook\.com|fb\.watch|fb\.com)$/, "Facebook"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)(x\.com|twitter\.com)$/, "X"],
  [/(^|\.)reddit\.com$/, "Reddit"],
  [/(^|\.)(xiaohongshu\.com|xhslink\.com)$/, "Xiaohongshu"],
  [/(^|\.)weibo\.(com|cn)$/, "Weibo"],
];

export function platformFor(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const [pattern, name] of PLATFORMS) if (pattern.test(host)) return name;
    return host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** First http(s) URL inside shared text (iOS often shares "caption… https://…"). */
export function extractUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[),.;!?]+$/, "") : "";
}

/** Refuse links to this machine or private networks, so the server can't be pointed at internal services. */
export function isPublicHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  if (host.includes(":")) {
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host.startsWith("::ffff:")) return false;
  }
  return true;
}

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function parseMeta(html) {
  const meta = {};
  for (const tag of html.match(/<meta\s[^>]*>/gi) || []) {
    const key = (tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1];
    if (key && content !== undefined && !(key.toLowerCase() in meta)) meta[key.toLowerCase()] = decodeEntities(content).trim();
  }
  const pageTitle = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  return {
    title: meta["og:title"] || meta["twitter:title"] || (pageTitle ? decodeEntities(pageTitle).trim() : ""),
    description: meta["og:description"] || meta["twitter:description"] || meta["description"] || "",
    image: meta["og:image"] || meta["og:image:url"] || meta["twitter:image"] || "",
    siteName: meta["og:site_name"] || "",
  };
}

async function readLimited(response, limit) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks).subarray(0, limit);
}

export async function fetchPostMeta(url, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (!isPublicHttpUrl(url)) throw new Error("Only public http(s) links can be read.");
  const response = await fetchImpl(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en,*;q=0.5" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`The link returned HTTP ${response.status}.`);
  const html = (await readLimited(response, MAX_HTML_BYTES)).toString("utf8");
  const meta = parseMeta(html);
  if (meta.image) {
    try {
      meta.image = new URL(meta.image, response.url || url).href;
    } catch {
      meta.image = "";
    }
  }
  return meta;
}

/** Downloads the post's preview image so it can be shown to Claude. Returns null if unusable. */
export async function fetchImage(url, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (!url || !isPublicHttpUrl(url)) return null;
  try {
    const response = await fetchImpl(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(type)) return null;
    const bytes = await readLimited(response, MAX_IMAGE_BYTES + 1);
    if (bytes.length > MAX_IMAGE_BYTES) return null;
    return { mediaType: type, data: bytes.toString("base64") };
  } catch {
    return null;
  }
}
