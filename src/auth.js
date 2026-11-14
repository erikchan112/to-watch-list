import crypto from "node:crypto";

const COOKIE = "twl_session";
const MAX_AGE_S = 60 * 60 * 24 * 365; // stay signed in for a year on your phone

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function createAuth({ password, secret }) {
  const required = Boolean(password);

  function isAuthenticated(req) {
    if (!required) return true;
    const token = readCookie(req, COOKIE);
    const [version, expires, mac] = token.split(".");
    if (version !== "v1" || !expires || !mac) return false;
    if (Number(expires) < Date.now() / 1000) return false;
    return safeEqual(mac, sign(`v1.${expires}`, secret));
  }

  function setSession(req, res) {
    const expires = Math.floor(Date.now() / 1000) + MAX_AGE_S;
    const token = `v1.${expires}.${sign(`v1.${expires}`, secret)}`;
    const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure ? "; Secure" : ""}`,
    );
  }

  function clearSession(res) {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  function checkPassword(candidate) {
    if (!required) return true;
    // Compare HMACs so the comparison is constant-time whatever the lengths.
    return safeEqual(sign(String(candidate ?? ""), secret), sign(password, secret));
  }

  function requireAuth(req, res, next) {
    if (isAuthenticated(req)) return next();
    res.status(401).json({ error: "Sign in first." });
  }

  return { required, isAuthenticated, setSession, clearSession, checkPassword, requireAuth };
}
