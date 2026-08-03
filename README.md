# Noderyx Framework

[GitHub source](https://github.com/webscepts123/Noderyx-Framework) · [Issues](https://github.com/webscepts123/Noderyx-Framework/issues)

Releases publish to npm through GitHub OIDC with no long-lived npm token. See
the [trusted publishing guide](https://github.com/webscepts123/Noderyx-Framework/blob/main/docs/PUBLISHING.md).

> Editor icons: after installation, run `npx noderyx editor:install` and reload
> VS Code. Use `--editor=cursor` or `--editor=vscodium` for those editors. Both
> `.noderframe` and `.mnoderframe` then share the Noderyx file icon.

Noderyx Framework is an experimental frontend-first web language and Node.js framework.
It has four parts:

- `.noderframe`: indentation-based Noderyx pages that compile to HTML.
- `cool.css`: a lightweight responsive CSS design system.
- `NoderyxApp`: a dependency-light Node.js server with routing, rendering, static
  files, JSON APIs, and database adapters.
- **Android and iOS**: the same views build into installable mobile apps.

## Noderyx project architecture

Noderyx uses a framework-first layout that keeps application code separate from
the engine and generated platform targets:

```text
app/                  Application controllers, models, middleware, and commands
database/
  migrations/         Ordered database changes
  seeders/            Development and initial data
framework/            Noderyx runtime, compiler, renderers, and command tool
platforms/
  mobile/             Generated Capacitor web application
  native/             Generated React Native application
packages/              Auto-discovered local Noderyx packages
public/                Browser assets and static build output
resources/views/       Source .noderframe pages
routes/                Web, API, and system route registration
tests/                 Node.js test suite
tooling/editors/       Bundled editor integrations
deployment/            Hosting recipes
```

Published applications continue to import from `noderyx-framework`; the
internal `framework/` directory is not part of an application's import path.
Legacy `views`, `mobile`, and `native` defaults remain supported so existing
Node.js applications are not broken by the new project structure.

### Where users write code

Write pages only in `resources/views`. A page can be as small as:

```text
h1 "Hello world"
p "My first Noderyx page"
```

Files below `platforms/`, including `.mnoderframe` files, are generated build
output and should not be edited. VS Code hides that output by default so the
Explorer stays focused on application source.

Security is built in rather than bolted on: security headers, a nonce-based
Content-Security-Policy, signed sessions, CSRF protection, rate limiting, and
request size limits are on from the first line of code.

Optional AI features use a server-only, dependency-free Responses API client and
the framework service container. See [AI setup and configuration](https://github.com/webscepts123/Noderyx-Framework/blob/main/docs/AI.md).

## Brand palette

Noderyx uses a dark-first identity built into Cool.css:

- **Noderyx Violet** `#7C5CFF` — primary actions and framework identity.
- **Runtime Cyan** `#22D3EE` — gradients, code functions, and runtime energy.
- **Signal Lime** `#B7F34A` — live, healthy, and successful states.
- **Kernel Night** `#090B14` — the primary application background.

The CSS tokens are available as `--noderyx-violet`, `--runtime-cyan`,
`--signal-lime`, and `--kernel-night`.

## Start

Use Node.js 20 or newer:

```bash
npm install
npm start
```

Open `http://localhost:3000`. During development, use `npm run dev`.

For explicit live refresh and a custom port:

```bash
npm run live -- 8080
npm run live -- auto
```

See [live development and custom ports](https://github.com/webscepts123/Noderyx-Framework/blob/main/docs/LIVE-DEVELOPMENT.md).

Create a complete new project:

```powershell
npx.cmd noderyx-framework@latest new my-website
cd my-website
npm.cmd run dev
```

Choose an optimized starting point with `--profile=saas`, `trading`, `blog`,
`ecommerce`, `static`, or `enterprise`. For example:

```powershell
npx.cmd noderyx-framework@latest new shop --profile=ecommerce
```

See [installation and project scaffolding](https://github.com/webscepts123/Noderyx-Framework/blob/main/docs/INSTALLATION.md).

Run the built-in lightweight QA audit at any time:

```powershell
npm run qa
```

It reports template, accessibility, responsive, link, configuration, and native
compatibility issues without starting the server. See [QA checks](https://github.com/webscepts123/Noderyx-Framework/blob/main/docs/QA.md).

High-security deployments can opt into bounded requests, strict sessions,
HTTPS enforcement, hardened headers, scoped API keys, request correlation, and
structured audit hooks:

```js
security: securityProfile("banking")
```

This is a hardened baseline—not a substitute for an independent audit or
regulatory assessment. See the [security guide](https://github.com/webscepts123/Noderyx-Framework/blob/main/docs/SECURITY.md).

Configure application mode, debugging, databases, cache, email, sessions,
security, and mobile variables using `.env` and `noderyx.config.js`. See the
complete [configuration guide](https://github.com/webscepts123/Noderyx-Framework/blob/main/docs/CONFIGURATION.md).

## Safely update an existing project

From an application created with Noderyx, update the framework with:

```bash
npm run framework:update
```

Or select an exact release or npm tag:

```bash
npx noderyx update 0.2.1
npx noderyx update next
```

The updater changes only the `noderyx-framework` dependency. It runs existing
tests before and after installation, verifies the new package can be imported,
and restores the previous manifest, lockfile, and dependency state if
verification fails. Controllers, models, routes, views, configuration, public
assets, and database files are never rewritten.

Use `npx noderyx update --dry-run` to inspect the operation. Projects without a
test script still receive the import check; `--no-test` explicitly skips project
tests when necessary. Recovery manifests are retained under
`.noderyx/update-backups/`.

See the complete [updating and upgrading guide](https://github.com/webscepts123/Noderyx-Framework/blob/main/docs/UPGRADING.md) for local
framework updates, rollback recovery, and the recommended production workflow.

The production entry point is `server.js`. It respects the host's `PORT`,
listens on `0.0.0.0`, exposes `/health`, and shuts down cleanly.

## Security

A new app is protected before you write a route. Every response carries a
Content-Security-Policy with a per-request nonce, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`, and HSTS in production. Sessions and
CSRF tokens are signed with your `APP_KEY`, bodies are capped at 1 MB, and
requests are rate limited.

```bash
noderyx spark:key       # forge APP_KEY into .env
noderyx hash "secret"   # scrypt hash for storing a password
```

```js
const app = noderyx({
  views: "./views",
  security: {
    trustProxy: true,
    rateLimit: { windowMs: 60_000, max: 300 },
    cors: { origins: ["capacitor://localhost"], credentials: true }
  }
});

app.post("/users", async ({ validate, session, json, abort }) => {
  const { valid, values, errors } = validate({
    email: "required|email|max:255",
    password: "required|min:12"
  });
  if (!valid) return abort(422, Object.values(errors)[0]);

  const user = await User.create({
    email: values.email,
    password: await hashPassword(values.password)
  });
  session.userId = user.id;
  return json({ id: user.id }, 201);
});
```

Forms post a token that is signed and bound to the session:

```text
form method="post" action="/users"
  input type="hidden" name="_csrf" value="{{csrfToken}}"
```

Because the policy has no `unsafe-inline`, inline `onclick` handlers do not run.
Use `data-noderyx="back"`, `"reload"`, `"share"`, or `"install"` instead.

See [security](https://github.com/webscepts123/Noderyx-Framework/blob/main/docs/SECURITY.md) for every option and the deployment checklist.

## Android and iOS

The same views that serve your website compile into a real native app. Screens
draw platform widgets — **no WebView, no HTML, no CSS on the device.**

```bash
npm run native:init          # Compile the views and scaffold the app
npm run native:android       # Build and launch on a device or emulator
npm run native:ios           # The same on macOS
```

Everything is resolved while you build, not while the user waits. Element
mapping, `{{placeholders}}`, loop variables, and styles are all compiled away:

```text
list post in posts
  article.cool-card
    h3 "{{post.title}}"
```

```jsx
<FlatList data={items(read(data, "posts"))} keyExtractor={keyFor} removeClippedSubviews
  renderItem={({ item: post }) => (
    <View style={s.articleCoolCard}>
      <Text style={s.h3}>{`${str(post?.title)}`}</Text>
    </View>
  )} />
```

`post?.title` is direct property access — the compiler tracked the scope, so
nothing is looked up by name at runtime. Style combinations are flattened once
when the module loads, so a re-render allocates nothing. `list` virtualizes, so
only the rows on screen are mounted. Screens and components are memoized.

Navigation, the theme, and the native bridge are generated too — a stack
navigator with animated transitions and no dependencies, and one API for camera,
location, storage, sharing, notifications, and haptics.

```js
await native.camera();
await native.storage.set("token", value);
const me = await native.api("/api/me");
```

See [native Android and iOS](https://github.com/webscepts123/Noderyx-Framework/blob/main/docs/NATIVE.md).

The website is separately installable as a PWA: the server serves
`/manifest.webmanifest` and `/sw.js` and adds the mobile head tags to every
page, so visitors can add it to the home screen and use it offline. Pass
`pwa: false` to `noderyx()` to opt out. A WebView-packaged build is also
available — see [packaged web app](https://github.com/webscepts123/Noderyx-Framework/blob/main/docs/MOBILE.md).

## Framework commands

Noderyx Framework includes its own command tool, similar to Laravel Artisan. Inside this
repository, call it through npm:

```bash
npm run noderyx -- serve --watch
npm run noderyx -- serve --port=8080
npm run noderyx -- make:controller UserController
npm run noderyx -- make:view dashboards/admin
npm run noderyx -- make:model User --table=users
npm run noderyx -- make:migration create_users
npm run noderyx -- make:middleware Authenticate
npm run noderyx -- make:observer UserObserver
npm run noderyx -- make:command SendReports --signature=reports:send
npm run noderyx -- make:seeder UserSeeder
npm run noderyx -- native:init --app-id=com.example.app
npm run noderyx -- native:run android
npm run noderyx -- build:native
npm run noderyx -- migrate
npm run noderyx -- migrate:status
npm run noderyx -- migrate:rollback
npm run noderyx -- db:seed
npm run noderyx -- run reports:send
```

After publishing/installing the package globally, the shorter form is
`noderyx serve`, `noderyx migrate`, and so on. Generated project scripts use
the local `noderyx-framework` executable, so `npm run dev` does not require a
global installation.

See [backend controllers, models, migrations, and seeders](https://github.com/webscepts123/Noderyx-Framework/blob/main/docs/BACKEND.md).

## Packages and plugins

Create a reusable local package with:

```bash
npx noderyx make:package hello-world
```

Packages can register routes, middleware, error handling, and asynchronous boot
logic. Local packages under `packages/` are discovered automatically; published
npm packages are enabled explicitly in `noderyx.config.js`.

See [creating Noderyx packages](https://github.com/webscepts123/Noderyx-Framework/blob/main/docs/PACKAGES.md) for the provider API,
configuration, testing, compatibility, and npm publishing workflow.

## Error pages

Noderyx renders `views/errors/403.noderframe`, `404.noderframe`,
`500.noderframe`, or `502.noderframe` automatically. Explicitly stop a request
from a controller with:

```js
this.abort(403, "Admins only");
```

Route handlers can use `abort(403)`. Unmatched routes render 404, application
errors render 500, and recognized database connection failures render 502.
JSON API requests receive the same status as structured JSON. Error details and
stack traces are included only outside production.

For logging or a completely custom response, register `app.onError(handler)`.
Return `true` after sending a response; return `false` to continue to Noderyx's
default error page.

## The `.noderframe` language

Two spaces create nesting. A tag may have an ID, CSS classes, attributes, text,
and escaped `{{variables}}`.

```text
html lang="en"
  head
    link rel="stylesheet" href="/public/cool.css"
  body
    main#app.cool-container
      h1 "Hello {{user.name}}"
      a.cool-btn href="/docs" "Read docs"
```

This becomes standard HTML. The language intentionally stays small so browsers
still receive accessible, debuggable HTML.

### Conditions, loops, and components

```text
component PostCard(post)
  article.cool-card
    h3 "{{post.title}}"
    p.cool-muted "{{post.excerpt}}"

main.cool-container
  if user.name
    p "Welcome back, {{user.name}}."
  else if guest
    p "Browsing as a guest."
  else
    a.cool-btn href="/login" "Sign in"

  if !posts
    p.cool-muted "Nothing published yet."

  list post in posts
    PostCard post="{{post}}"

  for tag, position in tags
    span.cool-badge "{{position}}: {{tag}}"
```

A condition is a path, optionally negated (`if !posts`), optionally compared
(`if status == "live"`). Empty arrays are falsy, so `if !posts` is the
empty-state check you want.

`for` renders inline; `list` becomes a virtualized `FlatList` on a device, for
data of any size. A capitalised name is a component, and a prop that is exactly
one placeholder passes the value itself so objects survive.

### One tree, many targets

The compiler is a parser plus pluggable renderers, so the same tree drives the
web and the device:

```js
import { parse, renderHtml, renderNative } from "./framework/index.js";

const tree = parse(source);            // parse once, placeholders intact
renderHtml(tree, { name: "Ada" });     // <p>Hello Ada</p>
renderNative(tree, { route: "home" }); // <Text style={s.p}>...</Text>
```

Pages are compiled to HTML in memory when `render("home")` loads
`views/home.noderframe`; users never need to expose the source template. Nested
views such as `render("dashboards/admin")` load `views/dashboards/admin.noderframe`.
Build all `.noderframe` files into static HTML only when creating a static deployment:

```bash
npm run build
```

## Backend routes

```js
import { noderyx } from "./framework/index.js";

const app = noderyx({ views: "./views", public: "./public" });

app.get("/", ({ render }) => render("home", { name: "Ada" }));
app.post("/users", ({ body, json }) => json({ user: body }, 201));
app.get("/users/:id", ({ params, query, json }) => {
  json({ id: params.id, filter: query.filter });
});

app.listen(3000);
```

### Interactive JSON explorer

Opening a route that calls `json()` directly in a browser displays Noderyx's
interactive JSON explorer. Objects and arrays can be collapsed, the response
can be copied or refreshed, and tree/raw modes are available. Use `?raw=1` for
the original JSON document. API clients that request `application/json`
continue to receive an unchanged JSON response.

## Databases

Drivers are optional dependencies and are loaded only for the selected database.
Keep credentials in environment variables.

### MySQL

```js
import { mysql } from "./framework/index.js";

const db = await mysql({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

const users = await db.query("SELECT * FROM users WHERE id = ?", [id]);
```

### PostgreSQL

```js
import { postgres } from "./framework/index.js";

const db = await postgres({ connectionString: process.env.DATABASE_URL });
const users = await db.query("SELECT * FROM users WHERE id = $1", [id]);
```

### MongoDB

```js
import { mongo } from "./framework/index.js";

const db = await mongo({
  url: process.env.MONGODB_URL,
  database: process.env.DB_NAME
});

const users = await db.collection("users").find({ active: true }).toArray();
```

## Cool.css

The first component set includes containers, stacks, responsive grids, cards,
buttons, form inputs, badges, heroes, spacing, and automatic dark mode. Override
the CSS variables in `:root` to create a theme.

## Next milestones

This repository is a working foundation, not yet a production 1.0. Strong next
steps are reusable `.noderframe` components, conditionals and loops, middleware,
schema migrations, validation, authentication, hot template reloading, and a
published `create-cool-app` CLI.

Conditionals and loops matter most for the native target: without them, list
screens still have to be assembled outside the view.

## Hosting

- [cPanel deployment](https://github.com/webscepts123/Noderyx-Framework/blob/main/deployment/cpanel/README.md)
- [AWS deployment](https://github.com/webscepts123/Noderyx-Framework/blob/main/deployment/aws/README.md)

The repository includes a root `server.js`, `Procfile`, `Dockerfile`,
`.dockerignore`, and `.env.example`. Do not commit real database passwords.

## SEO and web performance

The starter includes responsive metadata, canonical and social tags,
`robots.txt`, `sitemap.xml`, compression, ETags, production asset caching, and
mobile-first Cool.css utilities. See [SEO, mobile, and performance](https://github.com/webscepts123/Noderyx-Framework/blob/main/docs/SEO-PERFORMANCE.md).
