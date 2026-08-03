import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

/**
 * Noderyx security layer: application keys, signed cookies, sessions, CSRF,
 * password hashing, security headers, CORS, rate limiting, and validation.
 *
 * Everything here is on by default in `NoderyxApp`. Nothing depends on a
 * third-party package.
 */

// ---------------------------------------------------------------------------
// Application key
// ---------------------------------------------------------------------------

let developmentKey = null;

/**
 * The secret every signature is derived from. Production must supply `APP_KEY`;
 * development falls back to a per-process key so nothing silently signs with a
 * predictable value.
 */
export function appKey(explicit, options = {}) {
  const configured = explicit ?? process.env.APP_KEY;
  if (configured) {
    if (configured.length < 32) {
      const error = new Error("APP_KEY is too short. Forge a secure key with: npx noderyx spark:key");
      error.code = "APP_KEY_INVALID";
      error.expose = true;
      throw error;
    }
    return configured;
  }

  if (process.env.NODE_ENV === "production" || options.required) {
    const error = new Error("No APP_KEY detected. Forge one with: npx noderyx spark:key");
    error.code = "APP_KEY_MISSING";
    error.expose = true;
    throw error;
  }

  if (!developmentKey) {
    developmentKey = randomBytes(32).toString("base64url");
    console.warn("[Noderyx] APP_KEY is not set. Using a temporary development key; sessions reset on restart.");
  }
  return developmentKey;
}

export function generateKey() {
  return randomBytes(32).toString("base64url");
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

// ---------------------------------------------------------------------------
// High-security profiles and API credentials
// ---------------------------------------------------------------------------

const SECURITY_PROFILES = {
  standard: {},
  strict: {
    bodyLimit: 512 * 1024,
    request: { maxUrlLength: 4096, maxQueryParameters: 100, maxHeaderSize: 16384, requestTimeout: 20_000, headersTimeout: 10_000, requireContentType: true, rejectGetBody: true },
    session: { maxAge: 8 * 60 * 60, absoluteMaxAge: 8 * 60 * 60, idleTimeout: 30 * 60, sameSite: "Strict", secure: true },
    rateLimit: { windowMs: 60_000, max: 120, maxEntries: 50_000 },
    headers: { frameAncestors: "'none'", hstsPreload: false }
  },
  banking: {
    bodyLimit: 256 * 1024,
    enforceHttps: true,
    request: { maxUrlLength: 2048, maxQueryParameters: 50, maxHeaderSize: 16384, requestTimeout: 15_000, headersTimeout: 10_000, requireContentType: true, rejectGetBody: true },
    session: { maxAge: 12 * 60 * 60, absoluteMaxAge: 12 * 60 * 60, idleTimeout: 15 * 60, rolling: true, sameSite: "Strict", secure: true },
    rateLimit: { windowMs: 60_000, max: 100, maxEntries: 100_000 },
    headers: {
      frameAncestors: "'none'",
      hstsMaxAge: 63072000,
      hstsPreload: true,
      referrerPolicy: "no-referrer",
      permissionsPolicy: "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()"
    }
  }
};

export function securityProfile(name = "standard", overrides = {}) {
  const key = String(name).toLowerCase();
  const base = SECURITY_PROFILES[key];
  if (!base) throw new Error("Security profile must be standard, strict, or banking");
  return {
    ...base,
    ...overrides,
    profile: key,
    request: { ...(base.request ?? {}), ...(overrides.request ?? {}) },
    session: { ...(base.session ?? {}), ...(overrides.session ?? {}) },
    rateLimit: { ...(base.rateLimit ?? {}), ...(overrides.rateLimit ?? {}) },
    headers: { ...(base.headers ?? {}), ...(overrides.headers ?? {}) }
  };
}

/** Generate an API credential once; persist only `hash`, never the token. */
export function createApiKey(prefix = "nyx") {
  if (!/^[a-z][a-z0-9_-]{1,15}$/i.test(prefix)) throw new Error("Invalid API key prefix");
  const token = `${prefix}_${randomToken(32)}`;
  return { token, hash: hashApiKey(token), hint: `${token.slice(0, prefix.length + 5)}…` };
}

export function hashApiKey(token) {
  if (typeof token !== "string" || token.length < 32 || token.length > 256) throw new Error("Invalid API key");
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function verifyApiKey(token, expectedHash) {
  try { return safeEqual(hashApiKey(token), expectedHash); } catch { return false; }
}

export function requireApiKey(options = {}) {
  if (typeof options.lookup !== "function") throw new TypeError("requireApiKey needs an async lookup(hash) function");
  const required = new Set(options.scopes ?? []);
  return async (context, next) => {
    const authorization = context.request.headers.authorization ?? "";
    const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
    if (!match) return context.abort(401, "A bearer API key is required");
    let hash;
    try { hash = hashApiKey(match[1]); } catch { return context.abort(401, "The API key is invalid"); }
    const credential = await options.lookup(hash);
    if (!credential || credential.revoked || !verifyApiKey(match[1], credential.hash ?? hash)) {
      return context.abort(401, "The API key is invalid");
    }
    const granted = new Set(credential.scopes ?? []);
    if ([...required].some((scope) => !granted.has(scope))) return context.abort(403, "The API key lacks the required scope");
    context.principal = { type: "api-key", id: credential.id, scopes: [...granted] };
    return next();
  };
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

function hmac(value, key, purpose) {
  return createHmac("sha256", key).update(`${purpose}:${value}`).digest("base64url");
}

/** Constant-time comparison that never leaks length through early exit. */
export function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) {
    // Still compare, so the timing does not reveal that the lengths differed.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Append an HMAC so a value can be handed to the client and trusted back. */
export function sign(value, key, purpose = "noderyx") {
  return `${value}.${hmac(value, key, purpose)}`;
}

/** Verify a signed value. Returns null when the signature does not match. */
export function unsign(signed, key, purpose = "noderyx") {
  if (typeof signed !== "string") return null;
  const index = signed.lastIndexOf(".");
  if (index <= 0) return null;

  const value = signed.slice(0, index);
  const signature = signed.slice(index + 1);
  return safeEqual(signature, hmac(value, key, purpose)) ? value : null;
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

export function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      cookies[name] = part.slice(index + 1).trim();
    }
  }
  return cookies;
}

const COOKIE_NAME = /^[\w!#$%&'*+.^`|~-]+$/;

export function serializeCookie(name, value, options = {}) {
  if (!COOKIE_NAME.test(name)) throw new Error(`Invalid cookie name: ${name}`);

  const {
    path = "/",
    maxAge,
    expires,
    domain,
    secure = process.env.NODE_ENV === "production",
    httpOnly = true,
    sameSite = "Lax",
    partitioned = false
  } = options;

  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];
  if (domain) parts.push(`Domain=${domain}`);
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  if (expires) parts.push(`Expires=${new Date(expires).toUTCString()}`);
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (partitioned) parts.push("Partitioned");
  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Sessions (stateless, signed cookie)
// ---------------------------------------------------------------------------

export const SESSION_DEFAULTS = {
  name: "noderyx_session",
  maxAge: 60 * 60 * 24 * 7,
  sameSite: "Lax",
  rolling: true,
  absoluteMaxAge: null,
  idleTimeout: null
};

export function readSession(cookies, key, options = {}) {
  const settings = { ...SESSION_DEFAULTS, ...options };
  const raw = unsign(cookies[settings.name], key, "session");
  if (!raw) return null;

  try {
    const payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object") return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    const now = Math.floor(Date.now() / 1000);
    if (settings.absoluteMaxAge && (!payload.iat || payload.iat + settings.absoluteMaxAge < now)) return null;
    if (settings.idleTimeout && (!payload.last || payload.last + settings.idleTimeout < now)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function writeSession(data, key, options = {}) {
  const settings = { ...SESSION_DEFAULTS, ...options };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    ...data,
    sid: data.sid ?? randomUUID(),
    iat: data.iat ?? now,
    last: now,
    exp: Math.min(now + settings.maxAge, settings.absoluteMaxAge ? (data.iat ?? now) + settings.absoluteMaxAge : Infinity)
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    payload,
    cookie: serializeCookie(settings.name, sign(encoded, key, "session"), {
      maxAge: settings.maxAge,
      sameSite: settings.sameSite,
      secure: settings.secure,
      httpOnly: true
    })
  };
}

export function clearSessionCookie(options = {}) {
  const settings = { ...SESSION_DEFAULTS, ...options };
  return serializeCookie(settings.name, "", { maxAge: 0, sameSite: settings.sameSite });
}

// ---------------------------------------------------------------------------
// CSRF (signed double-submit token)
// ---------------------------------------------------------------------------

export const CSRF_COOKIE = "noderyx_csrf";
export const CSRF_HEADER = "x-csrf-token";
export const CSRF_FIELD = "_csrf";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** A token for this session. The cookie carries it signed; forms send it raw. */
export function csrfToken(sessionId, key) {
  return sign(`${sessionId}:${randomToken(16)}`, key, "csrf");
}

export function csrfCookie(token, options = {}) {
  // Readable by scripts on purpose: the page echoes it back in a header.
  return serializeCookie(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: options.sameSite ?? "Lax",
    secure: options.secure,
    maxAge: options.maxAge ?? SESSION_DEFAULTS.maxAge
  });
}

/**
 * Verify a state-changing request. The submitted token must carry a valid
 * signature, belong to this session, and match the cookie.
 */
export function verifyCsrf(request, { cookies, body, sessionId, key }) {
  if (!UNSAFE_METHODS.has(request.method)) return true;

  const submitted = request.headers[CSRF_HEADER]
    ?? (body && typeof body === "object" ? body[CSRF_FIELD] : null);
  const stored = cookies[CSRF_COOKIE];
  if (!submitted || !stored) return false;
  if (!safeEqual(submitted, stored)) return false;

  const value = unsign(String(submitted), key, "csrf");
  if (!value) return false;
  return safeEqual(value.slice(0, value.indexOf(":")), sessionId);
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keyLength: 64 };

export async function hashPassword(password, options = {}) {
  const minLength = options.minLength ?? 8;
  if (typeof password !== "string" || password.length < minLength) {
    throw new Error(`Password must be a string of at least ${minLength} characters`);
  }
  if (password.length > 1024) throw new Error("Password is too long");

  const settings = { ...SCRYPT, ...options };
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, settings.keyLength, {
    N: settings.N,
    r: settings.r,
    p: settings.p,
    maxmem: 256 * 1024 * 1024
  });
  return [
    "scrypt",
    settings.N,
    settings.r,
    settings.p,
    salt.toString("base64url"),
    derived.toString("base64url")
  ].join("$");
}

export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") return false;

  const [scheme, N, r, p, salt, expected] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;

  try {
    const derived = await scrypt(password, Buffer.from(salt, "base64url"), Buffer.from(expected, "base64url").length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 256 * 1024 * 1024
    });
    return safeEqual(derived.toString("base64url"), expected);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------

export const HEADER_DEFAULTS = {
  contentSecurityPolicy: true,
  hsts: true,
  hstsMaxAge: 60 * 60 * 24 * 365,
  hstsPreload: false,
  frameAncestors: "'self'",
  referrerPolicy: "strict-origin-when-cross-origin",
  // Denied outright, except the three the native bridge falls back to on the
  // web. Those are allowed for this origin only, never for embedded frames.
  permissionsPolicy: "accelerometer=(), autoplay=(), display-capture=(), encrypted-media=(), gyroscope=(), payment=(), usb=(), camera=(self), microphone=(self), geolocation=(self)",
  crossOriginOpenerPolicy: "same-origin",
  crossOriginResourcePolicy: "same-origin",
  connectSrc: [],
  imgSrc: ["'self'", "data:", "blob:"],
  styleSrc: ["'self'"],
  scriptSrc: ["'self'"],
  fontSrc: ["'self'", "data:"],
  reportUri: null
};

export function contentSecurityPolicy(nonce, options = {}) {
  const settings = { ...HEADER_DEFAULTS, ...options };
  const production = process.env.NODE_ENV === "production";

  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `frame-ancestors ${settings.frameAncestors}`,
    `form-action 'self'`,
    `script-src ${[...settings.scriptSrc, `'nonce-${nonce}'`].join(" ")}`,
    `style-src ${settings.styleSrc.join(" ")}`,
    `img-src ${settings.imgSrc.join(" ")}`,
    `font-src ${settings.fontSrc.join(" ")}`,
    `connect-src ${["'self'", ...settings.connectSrc].join(" ")}`,
    `manifest-src 'self'`,
    `worker-src 'self'`
  ];

  if (production) directives.push("upgrade-insecure-requests");
  if (settings.reportUri) directives.push(`report-uri ${settings.reportUri}`);
  return directives.join("; ");
}

/**
 * Headers applied to every response. `nonce` is generated per request so inline
 * scripts Noderyx injects stay allowed while injected ones do not.
 */
export function securityHeaders(nonce, options = {}) {
  const settings = { ...HEADER_DEFAULTS, ...options };
  const production = process.env.NODE_ENV === "production";

  const headers = {
    "x-content-type-options": "nosniff",
    "referrer-policy": settings.referrerPolicy,
    "x-frame-options": settings.frameAncestors === "'none'" ? "DENY" : "SAMEORIGIN",
    "cross-origin-opener-policy": settings.crossOriginOpenerPolicy,
    "cross-origin-resource-policy": settings.crossOriginResourcePolicy,
    "x-permitted-cross-domain-policies": "none",
    "origin-agent-cluster": "?1"
  };

  if (settings.permissionsPolicy) headers["permissions-policy"] = settings.permissionsPolicy;
  if (settings.contentSecurityPolicy) {
    headers["content-security-policy"] = contentSecurityPolicy(nonce, settings);
  }
  if (settings.hsts && production) {
    headers["strict-transport-security"] = `max-age=${settings.hstsMaxAge}; includeSubDomains${settings.hstsPreload ? "; preload" : ""}`;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

// Origins the packaged Android and iOS builds send. Without these the mobile
// app cannot call its own API.
export const CAPACITOR_ORIGINS = ["capacitor://localhost", "ionic://localhost", "http://localhost"];

export const CORS_DEFAULTS = {
  origins: [],
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  headers: ["Content-Type", "Authorization", "X-CSRF-Token", "X-Requested-With"],
  exposeHeaders: [],
  credentials: false,
  maxAge: 600
};

/**
 * Resolve CORS headers for a request. Origins are matched against an explicit
 * allowlist; `*` is never combined with credentials.
 */
export function corsHeaders(origin, options = {}) {
  const settings = { ...CORS_DEFAULTS, ...options };
  if (!origin || !settings.origins.length) return null;

  const allowed = settings.origins.includes("*")
    ? !settings.credentials
    : settings.origins.includes(origin);
  if (!allowed) return null;

  const headers = {
    "access-control-allow-origin": settings.origins.includes("*") ? "*" : origin,
    "vary": "Origin"
  };
  if (settings.credentials) headers["access-control-allow-credentials"] = "true";
  if (settings.exposeHeaders.length) {
    headers["access-control-expose-headers"] = settings.exposeHeaders.join(", ");
  }
  return headers;
}

export function preflightHeaders(origin, options = {}) {
  const settings = { ...CORS_DEFAULTS, ...options };
  const base = corsHeaders(origin, settings);
  if (!base) return null;

  return {
    ...base,
    "access-control-allow-methods": settings.methods.join(", "),
    "access-control-allow-headers": settings.headers.join(", "),
    "access-control-max-age": String(settings.maxAge)
  };
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export const RATE_LIMIT_DEFAULTS = {
  windowMs: 60_000,
  max: 120,
  maxEntries: 50_000
};

export class RateLimiter {
  constructor(options = {}) {
    this.settings = { ...RATE_LIMIT_DEFAULTS, ...options };
    this.hits = new Map();
  }

  /** Returns { allowed, remaining, resetSeconds }. */
  check(key, cost = 1) {
    const now = Date.now();
    const entry = this.hits.get(key);

    if (!entry || entry.reset <= now) {
      // Bound memory: an unbounded map is itself a denial-of-service vector.
      if (this.hits.size >= this.settings.maxEntries) this.sweep(now);
      const reset = now + this.settings.windowMs;
      this.hits.set(key, { count: cost, reset });
      return { allowed: cost <= this.settings.max, remaining: Math.max(0, this.settings.max - cost), resetSeconds: Math.ceil(this.settings.windowMs / 1000) };
    }

    entry.count += cost;
    const resetSeconds = Math.max(1, Math.ceil((entry.reset - now) / 1000));
    return {
      allowed: entry.count <= this.settings.max,
      remaining: Math.max(0, this.settings.max - entry.count),
      resetSeconds
    };
  }

  sweep(now = Date.now()) {
    for (const [key, entry] of this.hits) {
      if (entry.reset <= now) this.hits.delete(key);
    }
    // Still full of live entries: drop the oldest half rather than grow forever.
    if (this.hits.size >= this.settings.maxEntries) {
      const keys = [...this.hits.keys()].slice(0, Math.floor(this.hits.size / 2));
      for (const key of keys) this.hits.delete(key);
    }
  }

  reset() {
    this.hits.clear();
  }
}

/**
 * The address to rate limit by. Proxy headers are only trusted when the
 * application opts in, because they are trivially spoofed otherwise.
 */
export function clientAddress(request, trustProxy = false) {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    if (forwarded) return String(forwarded).split(",")[0].trim();
    const real = request.headers["x-real-ip"];
    if (real) return String(real).trim();
  }
  return request.socket?.remoteAddress ?? "unknown";
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const RULES = {
  required: (value) => (value !== undefined && value !== null && value !== "" ? null : "is required"),
  string: (value) => (typeof value === "string" ? null : "must be text"),
  email: (value) => (typeof value === "string" && EMAIL.test(value) ? null : "must be a valid email address"),
  integer: (value) => (Number.isInteger(Number(value)) ? null : "must be a whole number"),
  number: (value) => (Number.isFinite(Number(value)) ? null : "must be a number"),
  boolean: (value) => ([true, false, "true", "false", "1", "0", 1, 0].includes(value) ? null : "must be true or false"),
  url: (value) => { try { new URL(String(value)); return null; } catch { return "must be a valid URL"; } },
  min: (value, argument) => (String(value).length >= Number(argument) ? null : `must be at least ${argument} characters`),
  max: (value, argument) => (String(value).length <= Number(argument) ? null : `must be at most ${argument} characters`),
  in: (value, argument) => (argument.split(",").includes(String(value)) ? null : `must be one of: ${argument.split(",").join(", ")}`),
  alphanumeric: (value) => (/^[A-Za-z0-9]+$/.test(String(value)) ? null : "may only contain letters and numbers"),
  slug: (value) => (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value)) ? null : "must be a lowercase slug")
};

/**
 * Validate request input against a compact rule string.
 *
 *   validate(body, { email: "required|email|max:255", age: "integer" })
 *
 * Returns `{ valid, values, errors }`. `values` contains only the fields that
 * were declared, so unexpected input never reaches the database.
 */
export function validate(input, rules) {
  const data = input && typeof input === "object" ? input : {};
  const values = {};
  const errors = {};

  for (const [field, definition] of Object.entries(rules)) {
    const checks = String(definition).split("|").filter(Boolean);
    const value = data[field];
    const optional = !checks.includes("required");

    if (optional && (value === undefined || value === null || value === "")) continue;

    for (const check of checks) {
      const [name, argument] = check.split(":");
      const rule = RULES[name];
      if (!rule) throw new Error(`Unknown validation rule: ${name}`);

      const failure = rule(value, argument);
      if (failure) {
        errors[field] = `${field} ${failure}`;
        break;
      }
    }
    if (!errors[field]) values[field] = value;
  }

  return { valid: Object.keys(errors).length === 0, values, errors };
}
