# Security

Security in Noderyx is part of the framework, not a package you remember to
install. A new app starts with security headers, a Content-Security-Policy,
signed sessions, CSRF protection, rate limiting, and request size limits already
switched on.

```js
const app = noderyx({ views: "./views", public: "./public" });
```

That application already refuses oversized bodies, rejects forged form posts,
sets a strict CSP, and signs its cookies.

## Strict and banking security profiles

Use an explicit profile for systems that must fail closed:

```js
import { noderyx, securityProfile } from "noderyx-framework";

const app = noderyx({
  environment: process.env.NODE_ENV,
  requireAppKey: true,
  security: securityProfile("banking", {
    trustProxy: true, // only when directly behind a proxy you control
    cors: { origins: ["https://bank.example"], credentials: true },
    audit: async (record) => auditSink.write(record)
  })
});
```

Or set `SECURITY_PROFILE=banking` in a generated project. The banking profile
enables HTTPS enforcement in production, a 256 KB body limit, bounded URL,
query and header sizes, short header/request timeouts, strict media-type checks,
rejection of GET/HEAD bodies, 15-minute session inactivity expiry, a 12-hour
absolute session lifetime, `SameSite=Strict` secure cookies, frame denial,
two-year HSTS with preload, no-referrer, restricted browser permissions, and a
conservative rate limit. Every response receives `X-Request-ID`; a safe incoming
ID is preserved so API gateways, logs, and support systems can correlate it.

This profile is a secure baseline, not a compliance certificate. A financial
deployment still needs independent design review and penetration testing,
multi-factor authentication, object- and function-level authorization in every
business handler, centralized revocation/session state, encryption and key
management, immutable audit storage, fraud controls, dependency and container
scanning, network segmentation, monitoring, incident response, backups, and
the controls required by its regulator and payment environment.

### Scoped API keys

Generate a token once and store only its SHA-256 hash:

```js
import { createApiKey, requireApiKey } from "noderyx-framework";

const created = createApiKey("payments");
console.log(created.token); // reveal once through a protected enrollment flow
await ApiCredential.create({ hash: created.hash, scopes: ["payments:read"] });

app.use(requireApiKey({
  scopes: ["payments:read"],
  lookup: (hash) => ApiCredential.findByHash(hash)
}));
```

The middleware accepts only `Authorization: Bearer ...`, compares credentials
in constant time, rejects revoked keys, enforces scopes, and sets
`context.principal`. Use separate credentials per calling system, record the
principal in audit events, rotate keys, and keep authorization checks close to
the object being accessed. A valid API key does not prove that the caller may
access every account or transaction.

Handlers can emit structured, secret-free audit events:

```js
app.post("/api/transfers", async ({ audit, principal, requestId, json }) => {
  await audit("transfer.requested", { actor: principal.id, requestId });
  return json({ accepted: true }, 202);
});
```

Never place passwords, API keys, full card numbers, session cookies, or request
bodies in audit details.

## The application key

Every signature — sessions, CSRF tokens, signed cookies — derives from
`APP_KEY`.

```bash
noderyx spark:key          # forges a new key into .env
noderyx spark:key --show   # print one without touching any file
```

New Noderyx applications require this key before serving requests. If `.env`
does not exist, `spark:key` creates it from `.env.example`; if the key is
missing, the development exception page shows this command and a copy button.

`noderyx new` creates a `.env` with its own key. In production `APP_KEY` is
**required**; the app refuses to start without it. In development a temporary
key is generated per process, and you get a warning.

Rotating the key signs out every user and invalidates every outstanding CSRF
token, which is why `spark:key` refuses to overwrite an existing key without
`--force`.

## What is on by default

| Protection | Default | Turn off with |
| --- | --- | --- |
| Security headers and CSP | on | `security: { headers: false }` |
| CSRF on POST/PUT/PATCH/DELETE | on | `security: { csrf: false }` |
| Signed sessions | on | `security: { session: false }` |
| Rate limiting | 120 requests/minute per address | `security: { rateLimit: false }` |
| Request body limit | 1 MB | `security: { bodyLimit: n }` |
| CORS | off — no cross-origin access | `security: { cors: { origins: [...] } }` |
| Stack traces in errors | development only | `security: { exposeErrors: false }` |

```js
const app = noderyx({
  views: "./views",
  security: {
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024,
    rateLimit: { windowMs: 60_000, max: 300 },
    cors: { origins: ["capacitor://localhost", "https://localhost"], credentials: true },
    csrf: { exempt: ["/api/webhooks"] },
    session: { maxAge: 60 * 60 * 24, sameSite: "Strict" }
  }
});
```

## Content-Security-Policy

Every response carries a CSP with a **fresh nonce per request**. Inline scripts
Noderyx injects carry that nonce; anything injected by an attacker does not.

```text
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self';
form-action 'self'; script-src 'self' 'nonce-<random>'; style-src 'self';
img-src 'self' data: blob:; connect-src 'self'; upgrade-insecure-requests
```

There is no `unsafe-inline` and no `unsafe-eval`. **This means inline event
handlers do not run.** Instead of `onclick="history.back()"`, use the
declarative attributes the bridge already handles:

```text
button.cool-btn data-noderyx="back" "Go back"
button.cool-btn data-noderyx="reload" "Try again"
button.cool-btn data-noderyx="share" "Share"
button.cool-btn data-noderyx="install" "Install app"
```

For your own inline script, use the nonce that the request context provides:

```js
app.get("/", ({ render, nonce }) => render("home", { nonce }));
```

```text
script nonce="{{nonce}}"
```

Widen the policy when you need a third-party origin:

```js
security: {
  headers: {
    scriptSrc: ["'self'", "https://cdn.example.com"],
    connectSrc: ["https://api.example.com"],
    frameAncestors: "'none'"
  }
}
```

Other headers on every response: `X-Content-Type-Options: nosniff`,
`Referrer-Policy`, `X-Frame-Options`, `Cross-Origin-Opener-Policy`,
`Cross-Origin-Resource-Policy`, and `Strict-Transport-Security` in production.

`Permissions-Policy` denies accelerometer, autoplay, display capture, encrypted
media, gyroscope, payment, and USB. Camera, microphone, and geolocation are
allowed for **your origin only** — the native bridge falls back to them on the
web — and denied to any frame you embed. Deny them entirely if you never use
them:

```js
security: { headers: { permissionsPolicy: "camera=(), microphone=(), geolocation=()" } }
```

## CSRF

Unsafe methods must present a token that is signed, bound to the current
session, and matching the cookie. A missing or foreign token returns **419**.

In a form:

```text
form method="post" action="/posts"
  input type="hidden" name="_csrf" value="{{csrfToken}}"
  input type="text" name="title"
  button type="submit" "Publish"
```

`{{csrfToken}}` is available in every rendered view without passing it.

From JavaScript, send the `X-CSRF-Token` header. The bridge does this for you:

```js
await Noderyx.native.api("/posts", { method: "POST", body: { title } });
```

Exempt endpoints that authenticate another way — a webhook signature, a bearer
token — because they never rely on a cookie:

```js
security: { csrf: { exempt: ["/api/webhooks", /^\/api\/v\d+\/public/] } }
```

## Sessions

Sessions are stateless and signed, so nothing needs a store:

```js
app.post("/login", async ({ body, session, json, abort }) => {
  const user = await User.findByEmail(body.email);
  if (!user || !await verifyPassword(body.password, user.password)) {
    return abort(401, "Those details did not match");
  }
  session.userId = user.id;
  return json({ ok: true });
});

app.get("/me", ({ session, abort, json }) => {
  if (!session.userId) return abort(401);
  return json({ userId: session.userId });
});
```

The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Any change
to `session` re-issues it. Responses that carry a session are sent with
`Cache-Control: private, no-store` so no shared cache keeps them.

Because the session lives in the cookie, keep it small — an id, not a profile.

## Passwords

```js
import { hashPassword, verifyPassword } from "noderyx-framework";

const stored = await hashPassword(plainTextPassword);   // scrypt, per-password salt
const ok = await verifyPassword(attempt, stored);       // constant-time compare
```

Hashing uses scrypt with N=32768. Comparison is constant-time, so a wrong
password takes as long to reject as a right one.

For single-factor passwords, enforce the current NIST minimum through
`hashPassword(password, { minLength: 15 })`, check new passwords against a
blocklist of common/compromised values, allow password-manager paste, and do
not impose arbitrary character-composition rules. High-risk financial access
should use phishing-resistant MFA rather than a password alone.

From the terminal:

```bash
noderyx hash "correct horse battery staple"
```

## Validation

```js
app.post("/users", ({ validate, json, abort }) => {
  const { valid, values, errors } = validate({
    email: "required|email|max:255",
    name: "required|string|min:2|max:100",
    role: "in:admin,editor,viewer"
  });

  if (!valid) return abort(422, Object.values(errors)[0]);
  return json(await User.create(values));
});
```

`values` contains **only** the fields you declared, so unexpected input never
reaches the database. Rules: `required`, `string`, `email`, `integer`, `number`,
`boolean`, `url`, `min:n`, `max:n`, `in:a,b,c`, `alphanumeric`, `slug`.

## CORS and the mobile app

A packaged Android or iOS build runs from `capacitor://localhost` or
`https://localhost`, so calls to your API are cross-origin. CORS is **off by
default** — turn it on with an explicit allowlist:

```js
security: {
  cors: {
    origins: ["capacitor://localhost", "https://localhost", "https://app.example.com"],
    credentials: true
  }
}
```

Allowlisted origins are also added to `connect-src` automatically. `*` is never
combined with `credentials`, and an unknown origin gets `403` on preflight
rather than a listing of what the API accepts.

## Rate limiting

120 requests per minute per address by default, answered with `429` and
`Retry-After`. Static files are not counted.

```js
security: { rateLimit: { windowMs: 60_000, max: 300 } }
```

Behind a proxy or load balancer, set `trustProxy: true` so the limiter reads
`X-Forwarded-For`. **Leave it off otherwise** — the header is trivially spoofed,
and trusting it lets one client bypass the limit entirely.

## What else the framework handles

- **Request bodies** are capped at 1 MB and streamed with the limit enforced, so
  one request cannot exhaust memory. Malformed JSON returns `400`, not `500`.
- **Prototype pollution**: `__proto__`, `constructor`, and `prototype` are
  stripped from parsed bodies.
- **Path traversal**: static paths are decoded, checked for null bytes, resolved,
  and verified to stay inside the public directory. Encoded traversal such as
  `%2e%2e%2f` is refused.
- **XSS**: `{{placeholders}}` are HTML-escaped by the compiler. Data embedded in
  script blocks escapes `<`, U+2028, and U+2029.
- **SQL injection**: `Model` uses parameterised queries, and table and column
  names are validated against `^[A-Za-z_][A-Za-z0-9_]*$`.
- **Error leakage**: stack traces are sent only when `exposeErrors` is on, and
  only errors raised with `abort()` reveal their own message.
- **Service worker privacy**: responses marked `no-store`/`private`, anything
  that varies on `Cookie`, `/api/` paths, and requests with an `Authorization`
  header are never written to the offline cache.

## Deployment checklist

- [ ] `APP_KEY` set, unique per environment, not in version control
- [ ] `NODE_ENV=production` — enables HSTS and disables stack traces
- [ ] HTTPS terminated in front of the app, so `Secure` cookies work
- [ ] `trustProxy: true` **only** behind a proxy you control
- [ ] `cors.origins` lists exactly the origins you expect
- [ ] Database credentials in environment variables
- [ ] Rate limits appropriate for your traffic
- [ ] `.env` in `.gitignore`

Check the headers on a running app:

```bash
curl -sI https://example.com | grep -i "content-security-policy\|strict-transport\|x-content-type"
```

## Reporting a vulnerability

This is an experimental framework and has not had an external audit. Do not
report security issues in a public issue tracker.

## Standards used as the baseline

- [OWASP API Security Top 10 (2023)](https://owasp.org/API-Security/editions/2023/en/0x11-t10/) — particularly object/function authorization, authentication, resource consumption, configuration, inventory, and safe upstream API use.
- [NIST SP 800-63B-4 (2025)](https://pages.nist.gov/800-63-4/sp800-63b.html) — authentication, password verifier, reauthentication, inactivity, and overall session requirements.
- [PCI DSS v4.0.1 document library](https://www.pcisecuritystandards.org/document_library/?class=pcidss&doc=pci_dss) — the active payment-card security standard; applicability and validation require qualified assessment.
