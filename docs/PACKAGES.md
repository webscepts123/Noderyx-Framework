# Creating Noderyx packages

Noderyx packages are reusable extensions that can register routes, middleware,
error handlers, services, and startup behavior without changing the framework
core or the application's source files.

Packages use ordinary JavaScript modules and npm conventions. There is no
separate plugin runtime or proprietary archive format.

## Create a local package

Run this command from a Noderyx application:

```bash
npx noderyx make:package hello-world
```

The shorter npm-script form can also be used when the project defines it:

```bash
npm run noderyx -- make:package hello-world
```

The command creates:

```text
packages/
  hello-world/
    package.json
    README.md
    src/
      index.js
```

Local packages under `packages/` are discovered automatically when the server
starts. Restart `npm run dev`, then open the example route:

```text
http://localhost:3000/hello-world
```

## Package provider

The generated `src/index.js` exports a provider:

```js
import { definePackage } from "noderyx-framework";

export default definePackage({
  name: "hello-world",

  register({ app, options }) {
    app.get("/hello", ({ json }) => json({
      message: options.message ?? "Hello from the package"
    }));
  },

  async boot({ name }) {
    console.log(`Loaded ${name}`);
  }
});
```

`definePackage()` validates the provider early and returns it unchanged.

## Lifecycle

A package has two optional lifecycle methods:

1. `register(context)` registers routes, middleware, or error handling.
2. `boot(context)` runs after every enabled package has registered.

Both methods may be asynchronous. Registration happens in configured order;
booting happens afterward in the same order.

The context contains:

| Property | Description |
| --- | --- |
| `app` | The active `NoderyxApp` instance |
| `name` | The provider's package name |
| `options` | Application-specific package options |
| `config` | The application's Noderyx configuration |
| `root` | Absolute application root directory |

## Register routes

Packages use the same routing methods as applications:

```js
register({ app }) {
  app.get("/reports", ({ json }) => json({ reports: [] }));
  app.post("/reports", ({ body, json }) => json(body, 201));
  app.put("/reports/:id", ({ params, json }) => json({ id: params.id }));
  app.delete("/reports/:id", ({ params, json }) => json({ deleted: params.id }));
}
```

Use a package-specific route prefix to avoid conflicts with the application or
other packages.

## Register middleware

```js
register({ app }) {
  app.use(async (context, next) => {
    const started = Date.now();
    await next();
    console.log(`${context.request.method} completed in ${Date.now() - started}ms`);
  });
}
```

Do not change global prototypes or undocumented framework properties. Use the
public application methods so packages remain compatible with future releases.

## Package options

Local packages load automatically with an empty options object. Published or
explicit packages can receive options from `noderyx.config.js`:

```js
export default {
  packages: [
    {
      package: "@acme/noderyx-reports",
      options: {
        routePrefix: "/reports",
        pageSize: 25
      }
    }
  ]
};
```

Read and validate options in the provider:

```js
register({ app, options }) {
  const prefix = options.routePrefix ?? "/reports";
  if (!prefix.startsWith("/")) throw new Error("routePrefix must begin with /");
  app.get(prefix, ({ json }) => json({ pageSize: options.pageSize ?? 20 }));
}
```

Set `enabled: false` on a configured entry to disable it:

```js
packages: [
  { package: "@acme/noderyx-reports", enabled: false }
]
```

## Load packages in an application

New projects are configured automatically. The relevant server code is:

```js
import { loadPackages, noderyx } from "noderyx-framework";
import config from "./noderyx.config.js";

const app = noderyx({ views: "./resources/views", public: "./public" });

// Register application routes first so user routes keep priority.
app.get("/", ({ render }) => render("home"));

await loadPackages(app, config.packages, { config });
app.listen(3000);
```

For an older Noderyx project, add `packages: []` to `noderyx.config.js`, import
`loadPackages`, and call it once before `app.listen()`.

Automatic local discovery can be disabled:

```js
await loadPackages(app, config.packages, {
  config,
  discover: false
});
```

A different local package directory can be selected with `directory`.

## Install a published package

Install it with npm:

```bash
npm install @acme/noderyx-reports
```

Then enable it explicitly:

```js
export default {
  packages: ["@acme/noderyx-reports"]
};
```

Explicit activation prevents an unrelated dependency from executing package
startup code merely because it exists in `node_modules`.

## Prepare a package for npm

Change the generated package's `package.json` from private local development to
a publishable package:

```json
{
  "name": "@acme/noderyx-reports",
  "version": "1.0.0",
  "private": false,
  "type": "module",
  "main": "src/index.js",
  "files": ["src", "README.md", "LICENSE"],
  "peerDependencies": {
    "noderyx-framework": ">=0.1.0 <2"
  },
  "keywords": ["noderyx", "noderyx-package"]
}
```

Keep `noderyx-framework` in `peerDependencies`. This lets the application own
one framework version instead of installing a second copy inside the package.

Preview the published archive:

```bash
npm pack --dry-run
```

Publish according to npm's authentication and scope rules:

```bash
npm publish --access public
```

## Test a package

Test providers with Node's test runner and a real Noderyx application:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { loadPackages, noderyx } from "noderyx-framework";
import provider from "../src/index.js";

test("registers the package", async () => {
  const app = noderyx({ views: "./test/fixtures/views" });
  const loaded = await loadPackages(app, [provider], { discover: false });
  assert.equal(loaded[0].name, "hello-world");
});
```

Also test HTTP behavior, invalid options, package startup failures, and every
supported framework version.

## Compatibility and versioning

- Follow semantic versioning for published packages.
- Declare the tested framework range in `peerDependencies`.
- Avoid importing files inside `noderyx-framework/framework/`; use only exports
  from `noderyx-framework`.
- Treat removed routes, renamed options, and response changes as breaking
  package changes.
- Run application tests after package and framework updates.
- Never rewrite application source automatically from a provider.

Use the framework's safe updater for framework releases:

```bash
npm run framework:update
```

See [Updating and upgrading Noderyx](UPGRADING.md) for rollback and production
upgrade guidance.
