# Install and create a project

## Create a project

Run the published CLI from the directory where the new project should be
created. You do not need an existing `package.json` or a global installation:

```powershell
npx.cmd noderyx-framework@latest new my-website
cd my-website
Copy-Item .env.example .env
npm.cmd run dev
```

Generated npm scripts invoke the project's local `noderyx-framework`
executable. A global `noderyx` command is not required.

`npm.cmd run noderyx -- ...` is not an installation command. It invokes a
package script in the current directory and fails with `Missing script:
"noderyx"` unless that directory is a Noderyx Framework source checkout.

To generate files without installing project dependencies:

```powershell
npx.cmd noderyx-framework@latest new my-website --no-install
```

Choose a database:

```powershell
npx.cmd noderyx-framework@latest new mysql-app --database=mysql
npx.cmd noderyx-framework@latest new postgres-app --database=postgres
npx.cmd noderyx-framework@latest new mongo-app --database=mongo
```

Choose an optimized solution profile. Each profile supplies production-minded
cache capacity, asset lifetime, request size, rate-limit, metadata, and starter
copy while remaining fully overridable through `.env`:

```powershell
npx.cmd noderyx-framework@latest new product --profile=saas
npx.cmd noderyx-framework@latest new terminal --profile=trading
npx.cmd noderyx-framework@latest new journal --profile=blog
npx.cmd noderyx-framework@latest new shop --profile=ecommerce
npx.cmd noderyx-framework@latest new landing --profile=static
npx.cmd noderyx-framework@latest new operations --profile=enterprise
```

Use `npm run build` for a static profile deployment. Dynamic profiles can use
the same build for pre-rendered pages while continuing to serve APIs through
`server.js`.

## Shared hosting without Setup Node.js App

Many cPanel plans hide **Setup Node.js App > Create Application**. Build a
bundle that runs from `public_html` directly instead:

```powershell
npm.cmd run cpanel:build -- --user=youraccount --with-modules --repo=owner/name
```

Upload the contents of `platforms/cpanel/` into `public_html`, then open
`https://your-domain/noderyx-install.php?key=...` with the key the build prints.
The installer forges `APP_KEY` and writes `.env` and `.htaccess` for you; no
terminal is used on the server. `noderyx-deploy.php` handles later updates from
GitHub, by button or by signed webhook.

Add `--mode=proxy` when the host has no Passenger, or `--mode=static` when it
has no Node.js at all. See [cPanel deployment](../deployment/cpanel/README.md).

## Develop the framework from a source checkout

From the Noderyx Framework repository:

```powershell
npm.cmd install
node framework/cli.js new my-website
cd my-website
Copy-Item .env.example .env
npm.cmd run dev
```

When the generator runs from this source repository, it automatically adds a
local `file:` dependency pointing to the framework. This allows the generated
project to install and run before the framework is published.

To generate files without installing dependencies:

```powershell
node framework/cli.js new my-website --no-install
```

Choose a database:

```powershell
node framework/cli.js new mysql-app --database=mysql
node framework/cli.js new postgres-app --database=postgres
node framework/cli.js new mongo-app --database=mongo
```

## Install the command globally from this repository

Run this inside the framework repository:

```powershell
npm.cmd install -g .
```

Then the shorter terminal command is available:

```powershell
noderyx new my-website --local
cd my-website
npm.cmd run dev
```

Use `--local` with the globally linked development command so the generated
project references this local framework source.

## Optional global installation

Install the published `noderyx-framework` package globally if you prefer the
shorter `noderyx` command:

```powershell
npm.cmd install -g noderyx-framework
noderyx new my-website
```

Or scaffold without a global installation:

```powershell
npx.cmd noderyx-framework@latest new my-website
```

The generated application includes `.noderframe` views, Cool.css, controllers,
models, migrations, seeders, database configuration, Docker support, a cPanel/
AWS-compatible server, and development scripts.
