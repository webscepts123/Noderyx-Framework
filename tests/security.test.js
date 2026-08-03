import test from "node:test";
import assert from "node:assert/strict";
import { noderyx } from "../framework/app.js";
import {
  CSRF_COOKIE,
  RateLimiter,
  createApiKey,
  corsHeaders,
  csrfToken,
  hashPassword,
  requireApiKey,
  parseCookies,
  preflightHeaders,
  readSession,
  safeEqual,
  securityProfile,
  securityHeaders,
  serializeCookie,
  sign,
  unsign,
  validate,
  verifyApiKey,
  verifyPassword,
  writeSession
} from "../framework/security.js";

const KEY = "test-application-key-that-is-long-enough";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

test("signed values survive a round trip and reject tampering", () => {
  const signed = sign("user:42", KEY);
  assert.equal(unsign(signed, KEY), "user:42");

  assert.equal(unsign(signed, "a-different-key-that-is-long-enough"), null, "wrong key");
  assert.equal(unsign(`user:43.${signed.split(".")[1]}`, KEY), null, "tampered payload");
  assert.equal(unsign(`${signed}x`, KEY), null, "tampered signature");
  assert.equal(unsign("no-signature", KEY), null);
  assert.equal(unsign(undefined, KEY), null);
});

test("a signature is only valid for the purpose it was made for", () => {
  const signed = sign("abc", KEY, "session");
  assert.equal(unsign(signed, KEY, "session"), "abc");
  assert.equal(unsign(signed, KEY, "csrf"), null);
});

test("banking profile fails closed with bounded requests and sessions", () => {
  const profile = securityProfile("banking");
  assert.equal(profile.enforceHttps, true);
  assert.equal(profile.request.requireContentType, true);
  assert.equal(profile.session.sameSite, "Strict");
  assert.equal(profile.session.idleTimeout, 900);
  assert.equal(profile.headers.frameAncestors, "'none'");
});

test("API keys are stored as hashes and enforce scopes", async () => {
  const key = createApiKey("bank");
  assert.notEqual(key.token, key.hash);
  assert.equal(verifyApiKey(key.token, key.hash), true);
  assert.equal(verifyApiKey(`${key.token}x`, key.hash), false);
  const middleware = requireApiKey({
    lookup: async (hash) => ({ id: "service-1", hash, scopes: ["ledger:read"] }),
    scopes: ["ledger:read"]
  });
  const context = {
    request: { headers: { authorization: `Bearer ${key.token}` } },
    abort: (status) => { throw new Error(String(status)); },
    principal: null
  };
  let reached = false;
  await middleware(context, () => { reached = true; });
  assert.equal(reached, true);
  assert.equal(context.principal.id, "service-1");
});

test("safeEqual compares without throwing on mismatched lengths", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcdef"), false);
  assert.equal(safeEqual("", ""), true);
});

test("cookies are serialized with secure defaults and parsed back", () => {
  const cookie = serializeCookie("token", "a b/c", { secure: true, maxAge: 60 });
  assert.match(cookie, /^token=a%20b%2Fc/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=60/);

  assert.deepEqual(parseCookies("a=1; b=hello%20world"), { a: "1", b: "hello world" });
  assert.deepEqual(parseCookies(undefined), {});
  assert.throws(() => serializeCookie("bad name", "x"), /Invalid cookie name/);
});

test("sessions round trip, expire, and cannot be forged", () => {
  const { cookie, payload } = writeSession({ userId: 7 }, KEY);
  const value = cookie.slice("noderyx_session=".length, cookie.indexOf(";"));
  const cookies = { noderyx_session: decodeURIComponent(value) };

  const loaded = readSession(cookies, KEY);
  assert.equal(loaded.userId, 7);
  assert.equal(loaded.sid, payload.sid);

  assert.equal(readSession(cookies, "another-key-that-is-long-enough-x"), null);
  assert.equal(readSession({ noderyx_session: "garbage" }, KEY), null);

  const expired = writeSession({ userId: 7 }, KEY, { maxAge: -10 });
  const expiredValue = expired.cookie.slice("noderyx_session=".length, expired.cookie.indexOf(";"));
  assert.equal(readSession({ noderyx_session: decodeURIComponent(expiredValue) }, KEY), null);
});

test("passwords hash with scrypt and verify in constant time", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.match(hash, /^scrypt\$/);
  assert.notEqual(hash, await hashPassword("correct horse battery staple"), "salted");

  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("wrong password here", hash), false);
  assert.equal(await verifyPassword("x", "not-a-hash"), false);
  await assert.rejects(() => hashPassword("short"), /at least 8 characters/);
});

test("security headers include a per-request CSP nonce and no unsafe-inline", () => {
  const headers = securityHeaders("abc123");
  const csp = headers["content-security-policy"];

  assert.match(csp, /script-src 'self' 'nonce-abc123'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.doesNotMatch(csp, /unsafe-eval/);

  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["cross-origin-opener-policy"], "same-origin");
  assert.match(headers["permissions-policy"], /payment=\(\)/);
  // Camera, microphone, and location stay available to this origin because the
  // native bridge falls back to them on the web, but never to embedded frames.
  assert.match(headers["permissions-policy"], /camera=\(self\)/);
  assert.match(headers["permissions-policy"], /geolocation=\(self\)/);
});

test("CORS only answers allowlisted origins and never mixes * with credentials", () => {
  const options = { origins: ["https://app.example.com", "capacitor://localhost"], credentials: true };

  const allowed = corsHeaders("https://app.example.com", options);
  assert.equal(allowed["access-control-allow-origin"], "https://app.example.com");
  assert.equal(allowed["access-control-allow-credentials"], "true");
  assert.equal(allowed.vary, "Origin");

  assert.equal(corsHeaders("https://evil.example.com", options), null);
  assert.equal(corsHeaders("https://app.example.com", { origins: [] }), null);
  assert.equal(corsHeaders(undefined, options), null);

  // A wildcard with credentials would let any site read authenticated data.
  assert.equal(corsHeaders("https://evil.example.com", { origins: ["*"], credentials: true }), null);
  assert.ok(corsHeaders("https://anywhere.example", { origins: ["*"] }));

  const preflight = preflightHeaders("capacitor://localhost", options);
  assert.match(preflight["access-control-allow-methods"], /POST/);
  assert.match(preflight["access-control-allow-headers"], /X-CSRF-Token/);
});

test("the rate limiter blocks past the limit and recovers after the window", () => {
  const limiter = new RateLimiter({ windowMs: 50, max: 3 });

  assert.equal(limiter.check("1.2.3.4").allowed, true);
  assert.equal(limiter.check("1.2.3.4").allowed, true);
  assert.equal(limiter.check("1.2.3.4").allowed, true);
  assert.equal(limiter.check("1.2.3.4").allowed, false);
  assert.equal(limiter.check("5.6.7.8").allowed, true, "limits are per address");

  limiter.hits.get("1.2.3.4").reset = Date.now() - 1;
  assert.equal(limiter.check("1.2.3.4").allowed, true, "window rolled over");
});

test("the rate limiter bounds its own memory", () => {
  const limiter = new RateLimiter({ windowMs: 60_000, max: 10, maxEntries: 10 });
  for (let index = 0; index < 40; index += 1) limiter.check(`address-${index}`);
  assert.ok(limiter.hits.size <= 10, `expected at most 10 entries, got ${limiter.hits.size}`);
});

test("validation reports errors and returns only declared fields", () => {
  const rules = { email: "required|email|max:255", age: "integer", role: "in:admin,editor" };

  const good = validate({ email: "ada@example.com", age: "42", role: "admin", isAdmin: true }, rules);
  assert.equal(good.valid, true);
  assert.deepEqual(good.values, { email: "ada@example.com", age: "42", role: "admin" });
  assert.equal(good.values.isAdmin, undefined, "undeclared fields are dropped");

  const bad = validate({ email: "not-an-email", role: "owner" }, rules);
  assert.equal(bad.valid, false);
  assert.match(bad.errors.email, /valid email/);
  assert.match(bad.errors.role, /must be one of/);

  assert.equal(validate({}, { email: "required" }).errors.email, "email is required");
  assert.equal(validate({}, { nickname: "string" }).valid, true, "optional fields may be absent");
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

async function withServer(options, run) {
  const previousKey = process.env.APP_KEY;
  process.env.APP_KEY = KEY;

  const app = noderyx({ views: "resources/views", public: "public", ...options });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((ready) => server.once("listening", ready));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    return await run(base, app);
  } finally {
    server.close();
    if (previousKey === undefined) delete process.env.APP_KEY;
    else process.env.APP_KEY = previousKey;
  }
}

test("every response carries the security headers", async () => {
  await withServer({}, async (base, app) => {
    app.get("/", ({ text }) => text("ok"));
    const response = await fetch(base);

    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("content-security-policy"), /script-src 'self' 'nonce-/);
    assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.match(response.headers.get("referrer-policy"), /strict-origin/);
  });
});

test("the CSP nonce changes on every request", async () => {
  await withServer({}, async (base, app) => {
    app.get("/", ({ text }) => text("ok"));
    const first = await fetch(base);
    const second = await fetch(base);

    const nonce = (response) => response.headers.get("content-security-policy").match(/'nonce-([^']+)'/)[1];
    assert.notEqual(nonce(first), nonce(second));
  });
});

test("state-changing requests are rejected without a CSRF token", async () => {
  await withServer({}, async (base, app) => {
    app.post("/save", ({ json }) => json({ saved: true }));

    const response = await fetch(`${base}/save`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ value: 1 })
    });
    assert.equal(response.status, 419);
  });
});

test("a request carrying the issued CSRF token is accepted", async () => {
  await withServer({}, async (base, app) => {
    app.get("/", ({ text }) => text("ok"));
    app.post("/save", ({ json, body }) => json({ saved: body.value }));

    const first = await fetch(base);
    const cookies = first.headers.getSetCookie();
    const jar = cookies.map((cookie) => cookie.split(";")[0]).join("; ");
    const token = parseCookies(jar)[CSRF_COOKIE];
    assert.ok(token, "a CSRF cookie is issued on the first response");

    const response = await fetch(`${base}/save`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        cookie: jar,
        "x-csrf-token": token
      },
      body: JSON.stringify({ value: 9 })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { saved: 9 });
  });
});

test("a CSRF token from another session is rejected", async () => {
  await withServer({}, async (base, app) => {
    app.get("/", ({ text }) => text("ok"));
    app.post("/save", ({ json }) => json({ saved: true }));

    const first = await fetch(base);
    const jar = first.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    const foreign = csrfToken("00000000-0000-0000-0000-000000000000", KEY);

    const response = await fetch(`${base}/save`, {
      method: "POST",
      headers: {
        accept: "application/json",
        cookie: `${jar.replace(/noderyx_csrf=[^;]*/, `noderyx_csrf=${foreign}`)}`,
        "x-csrf-token": foreign
      }
    });
    assert.equal(response.status, 419);
  });
});

test("oversized and malformed bodies are refused before reaching a handler", async () => {
  await withServer({ security: { csrf: false, bodyLimit: 1024 } }, async (base, app) => {
    let reached = false;
    app.post("/save", ({ json }) => { reached = true; return json({ ok: true }); });

    const tooLarge = await fetch(`${base}/save`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ value: "x".repeat(4096) })
    });
    assert.equal(tooLarge.status, 413);

    const malformed = await fetch(`${base}/save`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: "{not json"
    });
    assert.equal(malformed.status, 400);
    assert.equal(reached, false, "no handler ran");
  });
});

test("strict request policy rejects ambiguous requests and returns correlation IDs", async () => {
  await withServer({ security: { ...securityProfile("strict"), csrf: false } }, async (base, app) => {
    app.get("/resource", ({ json, requestId }) => json({ requestId }));
    app.post("/resource", ({ json }) => json({ ok: true }));

    const normal = await fetch(`${base}/resource`, { headers: { "x-request-id": "qa-request-1234" } });
    assert.equal(normal.headers.get("x-request-id"), "qa-request-1234");
    assert.equal((await normal.json()).requestId, "qa-request-1234");

    const unsupported = await fetch(`${base}/resource`, { method: "POST", body: "plain text" });
    assert.equal(unsupported.status, 415);
    assert.ok(unsupported.headers.get("x-request-id"));

    const method = await fetch(`${base}/resource`, { method: "DELETE" });
    assert.equal(method.status, 405);
    assert.match(method.headers.get("allow"), /GET/);
  });
});

test("form input cannot reach Object.prototype", async () => {
  await withServer({ security: { csrf: false } }, async (base, app) => {
    app.post("/save", ({ json, body }) => json({ keys: Object.keys(body) }));

    const response = await fetch(`${base}/save`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: '{"__proto__":{"polluted":true},"name":"ok"}'
    });

    assert.deepEqual((await response.json()).keys, ["name"]);
    assert.equal({}.polluted, undefined, "Object.prototype is untouched");
  });
});

test("static file requests cannot escape the public directory", async () => {
  await withServer({}, async (base) => {
    for (const path of [
      "/public/../server.js",
      "/public/..%2Fserver.js",
      "/public/%2e%2e%2f%2e%2e%2fpackage.json",
      "/public/....//package.json"
    ]) {
      const response = await fetch(`${base}${path}`, { headers: { accept: "application/json" } });
      assert.ok(response.status === 403 || response.status === 404, `${path} returned ${response.status}`);

      const body = await response.text();
      assert.doesNotMatch(body, /noderyx-framework/, `${path} leaked file contents`);
    }

    const allowed = await fetch(`${base}/public/cool.css`);
    assert.equal(allowed.status, 200);
  });
});

test("requests past the rate limit receive 429 with Retry-After", async () => {
  await withServer({ security: { rateLimit: { windowMs: 60_000, max: 2 } } }, async (base, app) => {
    app.get("/", ({ text }) => text("ok"));

    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(base)).status, 200);

    const limited = await fetch(base);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
  });
});

test("CORS preflight answers an allowed origin and refuses an unknown one", async () => {
  const cors = { origins: ["capacitor://localhost"], credentials: true };
  await withServer({ security: { cors } }, async (base, app) => {
    app.post("/api/data", ({ json }) => json({ ok: true }));

    const allowed = await fetch(`${base}/api/data`, {
      method: "OPTIONS",
      headers: { origin: "capacitor://localhost" }
    });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "capacitor://localhost");

    const refused = await fetch(`${base}/api/data`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example.com" }
    });
    assert.equal(refused.status, 403);
    assert.equal(refused.headers.get("access-control-allow-origin"), null);
  });
});

test("sessions persist across requests and are signed", async () => {
  await withServer({ security: { csrf: false } }, async (base, app) => {
    app.get("/visit", ({ json, session }) => {
      session.count = (session.count ?? 0) + 1;
      return json({ count: session.count });
    });

    const first = await fetch(`${base}/visit`, { headers: { accept: "application/json" } });
    const jar = first.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    assert.deepEqual(await first.json(), { count: 1 });

    const second = await fetch(`${base}/visit`, {
      headers: { accept: "application/json", cookie: jar }
    });
    assert.deepEqual(await second.json(), { count: 2 });

    const sessionCookie = first.headers.getSetCookie().find((cookie) => cookie.startsWith("noderyx_session="));
    assert.match(sessionCookie, /HttpOnly/);
    assert.match(sessionCookie, /SameSite=Lax/);
  });
});

test("responses that carry a session are never cached by a shared cache", async () => {
  await withServer({}, async (base, app) => {
    app.get("/", ({ text }) => text("ok"));
    const response = await fetch(base);
    assert.match(response.headers.get("cache-control"), /no-store/);
  });
});

test("stack traces are withheld when errors are not exposed", async () => {
  await withServer({ security: { exposeErrors: false } }, async (base, app) => {
    app.get("/boom", () => { throw new Error("secret internal detail"); });

    const response = await fetch(`${base}/boom`, { headers: { accept: "application/json" } });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.details, undefined);
    assert.doesNotMatch(JSON.stringify(body), /secret internal detail/);
  });
});
