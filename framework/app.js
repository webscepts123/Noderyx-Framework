import { createServer } from "node:http";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { extname, join, relative, resolve, sep } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { compileFile } from "./compiler.js";
import { noderyxIcon } from "./icons.js";
import { Router } from "./router.js";
import { injectPwa, manifest, pwaOptions, serviceWorker } from "./pwa.js";
import { ERROR_COPY, HttpError, errorStatus } from "./errors.js";
import {
  CSRF_COOKIE,
  RateLimiter,
  appKey,
  clearSessionCookie,
  clientAddress,
  corsHeaders,
  csrfCookie,
  csrfToken,
  parseCookies,
  preflightHeaders,
  readSession,
  securityHeaders,
  serializeCookie,
  validate,
  verifyCsrf,
  writeSession
} from "./security.js";

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

// Launcher artwork is drawn on demand so an installable app never depends on
// binary files being committed to the project.
const GENERATED_ICONS = {
  "icon-192.png": () => noderyxIcon(192),
  "icon-512.png": () => noderyxIcon(512),
  "icon-maskable-512.png": () => noderyxIcon(512, { maskable: true }),
  "apple-touch-icon.png": () => noderyxIcon(180)
};

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml))/;

// Keys that would let submitted form data reach Object.prototype.
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function withoutPrototypePollution(entries) {
  const safe = Object.create(null);
  for (const [key, value] of entries) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    safe[key] = value;
  }
  return { ...safe };
}

/**
 * Read the request body, refusing anything over the configured limit so a
 * single request cannot exhaust memory.
 */
async function parseBody(request, limit) {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (declared > limit) throw new HttpError(413, "Request body is too large");

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      request.destroy();
      throw new HttpError(413, "Request body is too large");
    }
    chunks.push(chunk);
  }
  if (!size) return {};

  const raw = Buffer.concat(chunks).toString("utf8");
  const type = request.headers["content-type"] ?? "";

  if (type.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? withoutPrototypePollution(Object.entries(parsed))
        : parsed;
    } catch {
      throw new HttpError(400, "Request body is not valid JSON");
    }
  }
  if (type.includes("application/x-www-form-urlencoded")) {
    return withoutPrototypePollution([...new URLSearchParams(raw)]);
  }
  return raw;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Serialize data for embedding in a <script> block. `<` would close the block
 * early, and U+2028/U+2029 terminate a line for the JavaScript parser even
 * though JSON allows them raw.
 */
function jsonForScriptBlock(data) {
  return JSON.stringify(data).replace(/[<\u2028\u2029]/g, (character) => {
    const escaped = character.codePointAt(0).toString(16).padStart(4, "0");
    return `\\u${escaped}`;
  });
}

function injectLiveReload(html) {
  if (html.includes("/public/untitled-live.js")) return html;
  const script = '<script src="/public/untitled-live.js" defer></script>';
  return html.includes("</body>") ? html.replace("</body>", `${script}</body>`) : `${html}${script}`;
}

function stackFrames(error) {
  const root = resolve(process.cwd());
  return String(error?.stack ?? "").split("\n").flatMap((line) => {
    const match = line.match(/(?:file:\/\/\/)?([A-Za-z]:[\\/][^:)]+|\/[^:)]+):(\d+):(\d+)/);
    if (!match) return [];
    let file;
    try { file = decodeURIComponent(match[1]).replaceAll("/", sep); } catch { file = match[1]; }
    const normalized = resolve(file);
    return [{ file: normalized, line: Number(match[2]), column: Number(match[3]),
      application: normalized.startsWith(root) && !normalized.includes(`${sep}node_modules${sep}`) && !normalized.includes(`${sep}framework${sep}`) }];
  });
}

async function sourceExcerpt(frame, radius = 5) {
  if (!frame) return [];
  const source = await readFile(frame.file, "utf8").catch(() => null);
  if (!source) return [];
  const lines = source.split(/\r?\n/);
  const start = Math.max(1, frame.line - radius);
  const end = Math.min(lines.length, frame.line + radius);
  return lines.slice(start - 1, end).map((text, index) => ({ number: start + index, text, active: start + index === frame.line }));
}

function errorHint(error, status) {
  if (error?.code === "APP_KEY_MISSING") return "Noderyx needs an application key to sign sessions, cookies, and CSRF tokens. Run the command below once, then refresh this page.";
  if (error?.code === "APP_KEY_INVALID") return "APP_KEY must contain at least 32 characters. Generate a replacement with the command below; using --force signs out existing sessions.";
  const code = error?.code;
  if (status === 502) {
    if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT"].includes(code)) return "Check that the database service is running, then verify DB_HOST, DB_PORT, DATABASE_URL or MONGODB_URL in .env.";
    if (["ER_ACCESS_DENIED_ERROR", "28P01"].includes(code)) return "The database answered but rejected the credentials. Verify DB_USER and DB_PASSWORD in .env.";
    if (["ER_BAD_DB_ERROR", "3D000"].includes(code)) return "The configured database does not exist. Create it or correct DB_NAME, then run the migrations.";
    return "Verify the configured database driver and connection values, confirm the service is reachable, then run npm run migrate:status.";
  }
  if (/Unsupported HTML tag/i.test(error?.message ?? "")) return "Replace the unsupported element with a supported .noderframe tag, or add the element to the renderer allowlist if it is safe.";
  if (/Cannot find module|ERR_MODULE_NOT_FOUND/i.test(error?.message ?? "")) return "Check the import path and filename casing, then install the package if it is an external dependency.";
  return "Start at the highlighted application frame. Fix that line, save the file, and Noderyx live mode will refresh this page.";
}

export class NoderyxApp {
  constructor(options = {}) {
    this.router = new Router();
    this.views = options.views ?? join(process.cwd(), "views");
    this.public = options.public ?? join(process.cwd(), "public");
    this.viewExtension = options.viewExtension ?? ".noderframe";
    this.legacyViewExtension = options.legacyViewExtension === false ? null : ".untitled";
    this.middleware = [];
    this.services = new Map(Object.entries(options.services ?? {}));
    this.errorHandler = options.errorHandler ?? null;
    this.server = null;
    this.environment = options.environment ?? process.env.NODE_ENV ?? "development";
    this.production = this.environment === "production";
    this.debug = options.debug ?? !this.production;
    const cache = options.cache === false ? { driver: "none" } : (options.cache ?? {});
    this.cache = {
      driver: cache.driver ?? "memory",
      enabled: (cache.driver ?? "memory") !== "none",
      maxItems: cache.maxItems ?? 512,
      staticMaxAge: cache.staticMaxAge ?? 86400,
      staleWhileRevalidate: cache.staleWhileRevalidate ?? 604800
    };

    // Progressive web app support makes the site installable on Android and
    // iOS. Pass `pwa: false` to opt out, or an object to change the details.
    this.pwa = options.pwa === false ? null : pwaOptions({
      name: options.name ?? process.env.SITE_NAME ?? "Noderyx App",
      description: options.description ?? process.env.SITE_DESCRIPTION,
      ...(typeof options.pwa === "object" ? options.pwa : {})
    });
    this.iconCache = new Map();
    this.assetCache = new Map();
    this.viewCache = new Map();

    // Security is on by default. Each part can be disabled with `false`, or
    // tuned by passing an object. See docs/SECURITY.md.
    const security = options.security ?? {};
    this.security = {
      headers: security.headers ?? {},
      csrf: security.csrf ?? true,
      session: security.session ?? {},
      cors: security.cors ?? null,
      rateLimit: security.rateLimit ?? {},
      bodyLimit: security.bodyLimit ?? 1024 * 1024,
      trustProxy: security.trustProxy ?? false,
      exposeErrors: security.exposeErrors ?? this.debug,
      request: security.request ?? {},
      enforceHttps: security.enforceHttps ?? false,
      audit: typeof security.audit === "function" ? security.audit : null
    };

    this.bootstrapError = null;
    try {
      this.key = this.security.csrf === false && security.session === false
        ? null
        : appKey(security.appKey, { required: options.requireAppKey === true });
    } catch (error) {
      this.key = null;
      this.bootstrapError = error;
    }
    this.rateLimiter = this.security.rateLimit === false
      ? null
      : new RateLimiter(typeof this.security.rateLimit === "object" ? this.security.rateLimit : {});

    // The packaged mobile app calls the API cross-origin, so its connect-src
    // and CORS allowlist have to include wherever it is hosted.
    if (this.security.cors && this.security.cors.origins?.length) {
      this.security.headers.connectSrc = [
        ...(this.security.headers.connectSrc ?? []),
        ...this.security.cors.origins.filter((origin) => origin !== "*")
      ];
    }
  }

  get(path, handler) { this.router.get(path, handler); return this; }
  post(path, handler) { this.router.post(path, handler); return this; }
  put(path, handler) { this.router.put(path, handler); return this; }
  delete(path, handler) { this.router.delete(path, handler); return this; }
  patch(path, handler) { this.router.patch(path, handler); return this; }
  use(middleware) { this.middleware.push(middleware); return this; }
  provide(name, service) {
    if (!name || typeof name !== "string") throw new TypeError("A service name must be a non-empty string");
    this.services.set(name, service);
    return this;
  }
  service(name) {
    if (!this.services.has(name)) throw new Error(`Service is not registered: ${name}`);
    return this.services.get(name);
  }
  onError(handler) { this.errorHandler = handler; return this; }

  async findView(view) {
    if (this.production && this.cache.enabled && this.viewCache.has(view)) {
      return this.viewCache.get(view);
    }
    const extensions = [this.viewExtension, this.legacyViewExtension].filter(Boolean);
    for (const extension of extensions) {
      const candidate = join(this.views, `${view}${extension}`);
      if ((await stat(candidate).catch(() => null))?.isFile()) {
        if (this.production && this.cache.enabled) this.viewCache.set(view, candidate);
        return candidate;
      }
    }
    if (this.production && this.cache.enabled) this.viewCache.set(view, null);
    return null;
  }

  /**
   * Run the checks that must happen before any handler sees the request:
   * security headers, CORS, and rate limiting. Returns true when the response
   * is already complete.
   */
  applyGuards(request, response, url) {
    const nonce = randomBytes(16).toString("base64");
    const suppliedId = request.headers["x-request-id"];
    const requestId = typeof suppliedId === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(suppliedId) ? suppliedId : randomUUID();
    response.locals = { nonce, cookies: [], requestId };
    response.baseHeaders = securityHeaders(nonce, this.security.headers);
    response.baseHeaders["x-request-id"] = requestId;

    if (["TRACE", "CONNECT"].includes(request.method)) {
      this.send(response, 405, { error: "Method not allowed", requestId });
      return true;
    }
    const policy = this.security.request;
    if (request.url.length > (policy.maxUrlLength ?? 8192)) {
      this.send(response, 414, { error: "URI too long", requestId });
      return true;
    }
    if ([...url.searchParams].length > (policy.maxQueryParameters ?? 250)) {
      this.send(response, 400, { error: "Too many query parameters", requestId });
      return true;
    }
    const hasBody = request.headers["content-length"] !== undefined || request.headers["transfer-encoding"] !== undefined;
    if (policy.rejectGetBody && hasBody && ["GET", "HEAD"].includes(request.method)) {
      this.send(response, 400, { error: "Request body is not allowed for this method", requestId });
      return true;
    }
    if (policy.requireContentType && hasBody && !["GET", "HEAD"].includes(request.method)) {
      const type = String(request.headers["content-type"] ?? "").split(";", 1)[0].toLowerCase();
      if (!["application/json", "application/x-www-form-urlencoded", "multipart/form-data"].includes(type)) {
        this.send(response, 415, { error: "Unsupported media type", requestId });
        return true;
      }
    }
    if (this.production && this.security.enforceHttps) {
      const forwarded = this.security.trustProxy ? request.headers["x-forwarded-proto"] : null;
      if (!request.socket.encrypted && forwarded !== "https") {
        this.send(response, 400, { error: "HTTPS is required", requestId });
        return true;
      }
    }

    const origin = request.headers.origin;
    if (this.security.cors) {
      const headers = request.method === "OPTIONS"
        ? preflightHeaders(origin, this.security.cors)
        : corsHeaders(origin, this.security.cors);

      if (headers) Object.assign(response.baseHeaders, headers);
      else if (origin) response.baseHeaders.vary = "Origin";

      if (request.method === "OPTIONS") {
        // Never let an unlisted origin learn what the API accepts.
        this.send(response, headers ? 204 : 403, "");
        return true;
      }
    }

    if (this.rateLimiter && !url.pathname.startsWith("/public/")) {
      const address = clientAddress(request, this.security.trustProxy);
      const result = this.rateLimiter.check(address);
      response.baseHeaders["ratelimit-remaining"] = String(result.remaining);

      if (!result.allowed) {
        response.baseHeaders["retry-after"] = String(result.resetSeconds);
        this.send(response, 429, { error: "Too many requests" });
        return true;
      }
    }
    return false;
  }

  async handle(request, response) {
    try {
      const url = new URL(request.url, "http://localhost");
      if (this.applyGuards(request, response, url)) return;

      if (["/__noderyx/live", "/__untitled/live"].includes(url.pathname) && !this.production) {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive"
        });
        response.write("event: ready\ndata: connected\n\n");
        const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15000);
        request.on("close", () => clearInterval(heartbeat));
        return;
      }
      if (this.pwa && url.pathname === this.pwa.manifestPath) {
        return this.send(response, 200, JSON.stringify(manifest(this.pwa)),
          "application/manifest+json; charset=utf-8");
      }
      if (this.pwa && url.pathname === this.pwa.serviceWorkerPath) {
        return this.send(response, 200, serviceWorker(this.pwa),
          "text/javascript; charset=utf-8");
      }
      if (url.pathname.startsWith("/public/")) {
        return await this.serveStatic(url.pathname.slice(8), response);
      }

      // Keep the bootstrap error page usable: its stylesheet, script, PWA
      // metadata, and development live-reload endpoint must remain available
      // while the application is waiting for a valid APP_KEY.
      if (this.bootstrapError) throw this.bootstrapError;

      const route = this.router.match(request.method, url.pathname);
      if (!route) {
        const allowed = this.router.allowedMethods(url.pathname);
        if (allowed.length) {
          response.baseHeaders.allow = allowed.join(", ");
          throw new HttpError(405, "Method not allowed");
        }
        throw new HttpError(404, "Page not found");
      }

      const cookies = parseCookies(request.headers.cookie);
      const body = await parseBody(request, this.security.bodyLimit);
      const session = this.startSession(cookies, response);

      if (this.security.csrf !== false && !this.isCsrfExempt(url.pathname)) {
        const valid = verifyCsrf(request, {
          cookies,
          body,
          sessionId: session.id,
          key: this.key
        });
        if (!valid) throw new HttpError(419, "The form expired or the request could not be verified");
      }

      const context = {
        request,
        response,
        params: route.params,
        query: Object.fromEntries(url.searchParams),
        body,
        cookies,
        session: session.store,
        nonce: response.locals.nonce,
        requestId: response.locals.requestId,
        ip: clientAddress(request, this.security.trustProxy),
        csrfToken: session.csrf,
        principal: null,
        audit: (event, details = {}) => {
          if (!this.security.audit) return;
          return this.security.audit({ event, details, requestId: response.locals.requestId, method: request.method, path: url.pathname, ip: clientAddress(request, this.security.trustProxy), at: new Date().toISOString() });
        },
        service: (name) => this.service(name),
        validate: (rules) => validate(body, rules),
        setCookie: (name, value, options) => {
          response.locals.cookies.push(serializeCookie(name, value, options));
        },
        clearCookie: (name, options) => {
          response.locals.cookies.push(serializeCookie(name, "", { ...options, maxAge: 0 }));
        },
        json: (data, status = 200) => {
          const browserView = request.headers.accept?.includes("text/html")
            && url.searchParams.get("raw") !== "1";
          return browserView
            ? this.sendJsonViewer(response, status, data, url.pathname)
            : this.send(response, status, data);
        },
        text: (text, status = 200, contentType) => this.send(response, status, text, contentType),
        abort: (status, message) => { throw new HttpError(status, message ?? ERROR_COPY[status]?.message); },
        render: async (view, data = {}, status = 200) => {
          const viewFile = await this.findView(view);
          if (!viewFile) {
            throw new Error(`View not found: ${view}${this.viewExtension}`);
          }
          // The CSRF token is always available to views as {{csrfToken}}.
          let html = await compileFile(viewFile, { csrfToken: session.csrf, ...data });
          if (!this.production) html = injectLiveReload(html);
          this.send(
            response,
            status,
            this.pwa ? injectPwa(html, this.pwa, response.locals.nonce) : html,
            "text/html; charset=utf-8"
          );
        }
      };
      const stack = [...this.middleware, route.handler];
      const dispatch = async (index) => {
        const handler = stack[index];
        if (!handler) return;
        const callable = typeof handler === "function" ? handler : handler.handle?.bind(handler);
        if (!callable) throw new TypeError("Middleware must be a function or define handle(context, next)");
        return callable(context, () => dispatch(index + 1));
      };
      await dispatch(0);
      if (!response.writableEnded) this.send(response, 204, "");
    } catch (error) {
      await this.handleError(error, request, response);
    }
  }

  /**
   * Load the signed session cookie, or start a new session. Mutating
   * `session.store` re-issues the cookie when the response is sent.
   */
  startSession(cookies, response) {
    if (this.security.session === false) {
      return { id: "stateless", csrf: "", store: null };
    }

    const settings = typeof this.security.session === "object" ? this.security.session : {};
    const existing = readSession(cookies, this.key, settings);
    const store = { ...(existing ?? {}) };
    const before = JSON.stringify(store);

    const issue = () => {
      const { payload, cookie } = writeSession(store, this.key, settings);
      Object.assign(store, payload);
      response.locals.cookies.push(cookie);
      return payload;
    };

    let payload = existing;
    if (!existing) payload = issue();

    // A rolling session refreshes its expiry, and any change is persisted.
    response.locals.finishSession = () => {
      if (this.security.session === false) return;
      const changed = JSON.stringify(store) !== before;
      if (changed || (settings.rolling ?? true)) issue();
    };

    const token = cookies[CSRF_COOKIE] ?? csrfToken(payload.sid, this.key);
    if (!cookies[CSRF_COOKIE]) {
      response.locals.cookies.push(csrfCookie(token, settings));
    }

    return { id: payload.sid, csrf: token, store };
  }

  /** Requests that never carry a session cookie do not need CSRF. */
  isCsrfExempt(pathname) {
    const exempt = typeof this.security.csrf === "object" ? this.security.csrf.exempt ?? [] : [];
    return exempt.some((pattern) => (pattern instanceof RegExp
      ? pattern.test(pathname)
      : pathname === pattern || pathname.startsWith(`${pattern}/`)));
  }

  /** End the session on the current response, for sign-out. */
  destroySession(response) {
    response.locals.finishSession = null;
    response.locals.cookies.push(clearSessionCookie(
      typeof this.security.session === "object" ? this.security.session : {}
    ));
  }

  sendJsonViewer(response, status, data, path) {
    const title = `${status} JSON — ${path}`;
    const nonce = response.locals?.nonce ?? "";
    // Escape what would break out of the script block or the JS parser.
    const serialized = jsonForScriptBlock(data);
    const html = `<!doctype html>
<html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#090b14"><title>${escapeHtml(title)} | Noderyx</title><link rel="stylesheet" href="/public/cool.css"></head>
<body class="cool-json-body"><header class="cool-json-nav"><a class="cool-brand" href="/"><span class="cool-brand-mark">N</span><span>Noderyx</span></a><span class="cool-json-path">${escapeHtml(path)}</span><span class="cool-json-http"><i></i>${status}</span></header>
<main class="cool-json-shell"><section class="cool-json-heading"><div><span class="cool-eyebrow">Interactive response</span><h1>JSON Explorer</h1></div><div class="cool-json-actions"><button class="cool-btn secondary cool-btn-small" id="json-expand" type="button">Collapse all</button><button class="cool-btn secondary cool-btn-small" id="json-mode" type="button">Raw</button><button class="cool-btn secondary cool-btn-small" id="json-copy" type="button">Copy</button><button class="cool-btn cool-btn-small" id="json-refresh" type="button">Refresh</button></div></section>
<section class="cool-json-panel"><div class="cool-json-meta"><span>application/json</span><span id="json-size"></span><a href="${escapeHtml(path)}?raw=1">Open raw ↗</a></div><div class="cool-json-tree" id="json-tree" aria-live="polite"></div><pre class="cool-json-raw" id="json-raw" hidden></pre></section><p class="cool-json-toast" id="json-toast" aria-live="polite"></p></main>
<script type="application/json" id="json-data" nonce="${nonce}">${serialized}</script><script src="/public/json-viewer.js" defer nonce="${nonce}"></script></body></html>`;
    return this.send(response, status, html, "text/html; charset=utf-8");
  }

  async handleError(error, request, response) {
    const status = errorStatus(error);
    console.error(`[Noderyx ${status}]`, error);
    if (response.headersSent) return response.end();

    if (this.errorHandler) {
      const handled = await this.errorHandler(error, { request, response, status, app: this });
      if (handled === true || response.writableEnded) return;
    }

    const acceptsJson = request.headers.accept?.includes("application/json")
      || request.url?.startsWith("/api/");
    const defaults = ERROR_COPY[status] ?? ERROR_COPY[500];

    // Only errors that were raised deliberately reveal their own message, and
    // stack traces are never sent unless the application asks for them.
    const message = error.expose ? (error.message || defaults.message) : defaults.message;
    const details = this.security.exposeErrors ? (error.stack ?? String(error)) : "";

    if (acceptsJson) {
      return this.send(response, status, {
        error: defaults.title,
        message,
        requestId: response.locals?.requestId,
        ...(details ? { details } : {})
      });
    }

    if (this.security.exposeErrors) {
      return this.sendDebugErrorPage(error, { request, response, status, defaults });
    }

    try {
      const viewFile = await this.findView(`errors/${status}`)
        ?? await this.findView("errors/500");
      if (viewFile) {
        const html = await compileFile(viewFile, { status, title: defaults.title, message, details });
        return this.send(
          response,
          status,
          this.pwa ? injectPwa(html, this.pwa, response.locals?.nonce ?? "") : html,
          "text/html; charset=utf-8"
        );
      }
    } catch (renderError) {
      console.error("[Noderyx error page failed]", renderError);
    }
    return this.send(response, status, `${status} ${defaults.title}\n${message}`, "text/plain; charset=utf-8");
  }

  async sendDebugErrorPage(error, { request, response, status, defaults }) {
    const frames = stackFrames(error);
    const frame = frames.find((item) => item.application) ?? frames[0];
    const excerpt = await sourceExcerpt(frame);
    const relativeFile = frame ? relative(process.cwd(), frame.file).replaceAll("\\", "/") : "No source frame available";
    const location = frame ? `${relativeFile}:${frame.line}:${frame.column}` : "Runtime error";
    const editorUrl = frame ? `vscode://file/${frame.file.replaceAll("\\", "/")}:${frame.line}:${frame.column}` : "#";
    const category = status === 502 ? "Database / service connection" : `${error?.name ?? "Error"}`;
    const fixCommand = error?.code === "APP_KEY_INVALID"
      ? "npx noderyx spark:key --force"
      : error?.code === "APP_KEY_MISSING" ? "npx noderyx spark:key" : null;
    const commandPanel = fixCommand
      ? `<div class="ny-debug-command"><span>$</span><code>${fixCommand}</code><button type="button" data-command="${fixCommand}">Copy command</button></div><pre class="ny-debug-example"><span># .env</span>\nAPP_KEY=&lt;generated securely by Noderyx&gt;</pre>`
      : "";
    const source = commandPanel + excerpt.map((item) => `<div class="ny-debug-line${item.active ? " is-active" : ""}"><span>${item.number}</span><code>${escapeHtml(item.text || " ")}</code></div>`).join("");
    const stack = escapeHtml(error?.stack ?? String(error));
    const nonce = response.locals?.nonce ?? "";
    const html = `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${status} — ${escapeHtml(error?.message ?? defaults.title)} | Noderyx</title><link rel="stylesheet" href="/public/cool.css"></head>
<body class="ny-debug-body"><header class="ny-debug-nav"><a class="cool-brand" href="/"><span class="cool-brand-mark">N</span><span>Noderyx</span></a><span>Development exception</span><span class="ny-debug-status">${status}</span></header>
<main class="ny-debug-shell"><section class="ny-debug-summary"><span class="cool-eyebrow">${escapeHtml(defaults.title)} · ${escapeHtml(category)}</span><h1>${escapeHtml(error?.message ?? defaults.title)}</h1><p>${escapeHtml(errorHint(error, status))}</p><div class="ny-debug-actions"><a class="cool-btn" href="${escapeHtml(editorUrl)}">Open in VS Code</a><button class="cool-btn secondary" type="button" id="debug-copy" data-copy="${escapeHtml(location)}">Copy location</button><button class="cool-btn secondary" type="button" id="debug-back">Go back</button></div></section>
<section class="ny-debug-workbench"><div class="ny-debug-file"><div><span class="cool-pulse"></span><strong>${escapeHtml(relativeFile)}</strong></div><span>Line ${frame?.line ?? "—"}</span></div><div class="ny-debug-source">${source || '<p class="ny-debug-empty">Source is unavailable for this stack frame.</p>'}</div></section>
<section class="ny-debug-meta"><article><span>Exception</span><strong>${escapeHtml(error?.name ?? "Error")}</strong></article><article><span>Code</span><strong>${escapeHtml(error?.code ?? "—")}</strong></article><article><span>Request</span><strong>${escapeHtml(`${request.method ?? "GET"} ${request.url ?? "/"}`)}</strong></article><article><span>Environment</span><strong>${escapeHtml(this.environment)}</strong></article></section>
<details class="ny-debug-stack"><summary>Full stack trace <span>${frames.length} frames</span></summary><pre>${stack}</pre></details><p class="ny-debug-toast" id="debug-toast" aria-live="polite"></p></main><script src="/public/error-debug.js" defer nonce="${nonce}"></script></body></html>`;
    return this.send(response, status, html, "text/html; charset=utf-8");
  }

  /**
   * Security headers and any cookies queued during the request. Every response
   * goes through here, so nothing can be sent without them.
   */
  finalHeaders(response, extra = {}) {
    const locals = response.locals;
    if (locals?.finishSession) {
      locals.finishSession();
      locals.finishSession = null;
    }

    const headers = { ...(response.baseHeaders ?? {}), ...extra };
    const vary = [headers.vary, extra.vary].filter(Boolean).join(", ");
    if (vary) headers.vary = [...new Set(vary.split(", "))].join(", ");
    if (locals?.cookies?.length) headers["set-cookie"] = locals.cookies;
    return headers;
  }

  send(response, status, body, contentType) {
    const isObject = typeof body === "object" && body !== null;
    const type = contentType ?? (isObject
      ? "application/json; charset=utf-8"
      : "text/plain; charset=utf-8");
    let payload = Buffer.from(isObject ? JSON.stringify(body) : String(body));
    const etag = `"${createHash("sha1").update(payload).digest("base64url")}"`;
    const request = response.req;

    // Anything carrying a session must never be stored by a shared cache.
    const isPrivate = Boolean(response.locals?.cookies?.length) || type.startsWith("text/html");
    const headers = this.finalHeaders(response, {
      "content-type": type,
      "cache-control": isPrivate ? "private, no-store" : "no-cache",
      "etag": etag,
      "vary": "Accept-Encoding"
    });

    if (request?.headers["if-none-match"] === etag) {
      response.writeHead(304, headers);
      return response.end();
    }

    if (payload.length >= 512 && COMPRESSIBLE.test(type)) {
      const accepted = request?.headers["accept-encoding"] ?? "";
      // Dynamic responses change per request. Gzip is intentionally preferred
      // because it uses much less CPU on small servers; static assets use
      // cached Brotli below and pay compression only once.
      if (accepted.includes("gzip")) {
        payload = gzipSync(payload);
        headers["content-encoding"] = "gzip";
      } else if (accepted.includes("br")) {
        payload = brotliCompressSync(payload);
        headers["content-encoding"] = "br";
      }
    }
    headers["content-length"] = payload.length;
    response.writeHead(status, headers);
    response.end(request?.method === "HEAD" ? undefined : payload);
  }

  async serveStatic(relativePath, response) {
    // Percent-encoded traversal survives URL parsing, so decode first, then
    // prove the resolved path is still inside the public directory.
    let decoded;
    try {
      decoded = decodeURIComponent(relativePath);
    } catch {
      return this.send(response, 400, { error: "Bad request" });
    }
    if (decoded.includes("\0")) return this.send(response, 400, { error: "Bad request" });

    const root = resolve(this.public);
    const file = resolve(root, `.${sep}${decoded}`);
    const inside = file === root || !relative(root, file).startsWith("..");
    if (!inside) return this.send(response, 403, { error: "Forbidden" });

    const safePath = relative(root, file);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      const generated = this.generatedIcon(safePath);
      if (generated) return this.sendAsset(response, generated, "image/png");
      return this.send(response, 404, { error: "Not found" });
    }
    const type = CONTENT_TYPES[extname(file)] ?? "application/octet-stream";
    let asset = this.assetCache.get(file);
    if (!asset || !this.cache.enabled || (!this.production && asset.mtimeMs !== info.mtimeMs)) {
      const raw = await readFile(file);
      asset = this.prepareAsset(raw, type, info.mtimeMs);
      // Static roots are finite, but keep a ceiling for generated/dev projects.
      if (this.cache.enabled) {
        if (this.assetCache.size >= this.cache.maxItems) this.assetCache.delete(this.assetCache.keys().next().value);
        this.assetCache.set(file, asset);
      }
    }
    return this.sendAsset(response, asset, type);
  }

  generatedIcon(safePath) {
    if (!this.pwa) return null;
    const prefix = `${this.pwa.iconPath.replace(/^\/public\//, "")}/`;
    const normalized = safePath.replaceAll("\\", "/");
    if (!normalized.startsWith(prefix)) return null;

    const name = normalized.slice(prefix.length);
    const draw = GENERATED_ICONS[name];
    if (!draw) return null;
    if (!this.iconCache.has(name)) this.iconCache.set(name, draw());
    return this.iconCache.get(name);
  }

  sendAsset(response, buffer, type) {
    const asset = Buffer.isBuffer(buffer) ? this.prepareAsset(buffer, type) : buffer;
    let payload = asset.raw;
    const etag = asset.etag;
    const request = response.req;
    const headers = this.finalHeaders(response, {
      "content-type": type,
      "cache-control": this.production && this.cache.enabled
        ? `public, max-age=${this.cache.staticMaxAge}, stale-while-revalidate=${this.cache.staleWhileRevalidate}`
        : "no-cache",
      "etag": etag,
      "vary": "Accept-Encoding"
    });
    if (request?.headers["if-none-match"] === etag) {
      response.writeHead(304, headers);
      return response.end();
    }
    const accepted = request?.headers["accept-encoding"] ?? "";
    if (asset.br && accepted.includes("br")) {
        payload = asset.br;
        headers["content-encoding"] = "br";
      } else if (asset.gzip && accepted.includes("gzip")) {
        payload = asset.gzip;
        headers["content-encoding"] = "gzip";
    }
    headers["content-length"] = payload.length;
    response.writeHead(200, headers);
    response.end(request?.method === "HEAD" ? undefined : payload);
  }

  prepareAsset(raw, type, mtimeMs = 0) {
    const compress = raw.length >= 512 && COMPRESSIBLE.test(type);
    return {
      raw,
      mtimeMs,
      etag: `"${createHash("sha1").update(raw).digest("base64url")}"`,
      br: compress ? brotliCompressSync(raw) : null,
      gzip: compress ? gzipSync(raw) : null
    };
  }

  listen(port = 3000, hostOrCallback, callback) {
    this.server = createServer({
      maxHeaderSize: this.security.request.maxHeaderSize ?? 16384,
      requestTimeout: this.security.request.requestTimeout ?? 300_000,
      headersTimeout: this.security.request.headersTimeout ?? 60_000
    }, (request, response) => this.handle(request, response));
    return typeof hostOrCallback === "function"
      ? this.server.listen(port, hostOrCallback)
      : this.server.listen(port, hostOrCallback, callback);
  }
}

export function noderyx(options) {
  return new NoderyxApp(options);
}

// Backwards-compatible aliases for projects created before the Noderyx rebrand.
export const UntitledApp = NoderyxApp;
export const untitled = noderyx;
