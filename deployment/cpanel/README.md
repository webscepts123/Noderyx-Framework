# Deploy Noderyx Framework on cPanel

Two routes exist. Pick the one your account supports.

| Your account | Route |
| --- | --- |
| Has **Setup Node.js App** | [Managed application](#managed-application) |
| No **Setup Node.js App** | [Run from public_html](#run-from-public_html) |

Not sure which? Build a bundle, upload `noderyx-check.php`, and open it in a
browser. It reports whether Passenger is present and which Node binaries exist.

## Run from public_html

`noderyx cpanel:build` writes a folder whose contents go straight into
`public_html`. No Create Application step is involved.

    npm run cpanel:build -- --user=youraccount

The command writes `platforms/cpanel/`. Upload everything inside it, including
the hidden `.htaccess`, then follow the generated `README-CPANEL.md`.

### Modes

    --mode=passenger   Default. The host runs Phusion Passenger but hides the
                       Setup Node.js App screen. A hand-written .htaccess starts
                       the app from public_html on the first request.

    --mode=proxy       No Passenger, but a Node binary exists. A cron job keeps
                       `node server.js` alive on a local port and index.php
                       forwards every request to it.

    --mode=static      No Node at all. Views compile to plain HTML that Apache
                       serves directly. Backend routes are not available.

### Options

    --user=youraccount   cPanel username; fills in /home/<user>/public_html
    --dir=public_html    Target directory under the home directory
    --app-root=/path     Absolute application root, instead of --user and --dir
    --node=/path/node    Node binary; noderyx-check.php prints the right one
    --port=3000          Local port for proxy mode
    --out=platforms/cpanel

Print one file without rebuilding, to patch a live deployment:

    npm run noderyx -- cpanel:file htaccess --mode=passenger --user=youraccount
    npm run noderyx -- cpanel:file check

### What the bundle contains

    .htaccess            Starts the app and blocks source files from the web
    app.js               Startup file Passenger looks for; loads server.js
    noderyx-check.php    Read-only environment report, key-protected
    README-CPANEL.md     Upload, configure, and restart steps for the mode
    tmp/restart.txt      Save this file to restart the app (passenger mode)
    index.php            PHP to Node bridge (proxy mode)
    noderyx-start.sh     Cron keepalive and restart script (proxy mode)
    noderyx-stop.sh      Stops the process (proxy mode)

`node_modules` is not copied. Run `npm install --omit=dev` locally and upload
the folder: an account without Setup Node.js App also has no Run NPM Install
button.

### Keeping source private

The application lives inside the document root, so `.htaccess` refuses
`framework/`, `app/`, `routes/`, `database/`, `resources/`, `packages/`, and
`tmp/`, plus `.env`, `server.js`, and `package.json`. Each of those directories
also carries its own deny file. Only paths that exist on disk are refused, so an
application route such as `/app/dashboard` still reaches Node.

Verify after uploading: `https://your-domain/.env` and
`https://your-domain/framework/app.js` must both return 403.

To keep source out of the document root entirely, put the application in
`~/noderyx-app`, upload only `.htaccess` and your assets into `public_html`, and
build with `--app-root=/home/youraccount/noderyx-app`.

### Delete the check file

`noderyx-check.php` reports paths and installed binaries. It requires the key
printed by the build, but delete it once the site works.

## Managed application

When **Setup Node.js App** is available, use it; Passenger is then configured
for you.

1. Create a ZIP of this project, excluding `.git`, `.env`, and `node_modules`.
2. In cPanel File Manager, create an application folder such as `cool-app`,
   upload the ZIP there, and extract it.
3. Open **Setup Node.js App** and select **Create Application**.
4. Select production mode and Node.js 20 or newer.
5. Set the application root to `cool-app`.
6. Select the domain or subdomain URL.
7. Set the startup file to `server.js`.
8. Add `NODE_ENV=production`, `APP_KEY`, and `SITE_NAME=Your Site` under
   environment variables. Do not add `PORT`; cPanel supplies it.
9. Click **Run NPM Install**, then **Restart**.

## Database settings

For cPanel MySQL, create the database and user in **MySQL Databases**, grant the
user privileges, and set `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`.
Managed applications take these from the Node.js application's environment
variables; a public_html deployment reads them from `.env`.

PostgreSQL is usable only when the hosting plan offers it. Remote MongoDB
(including MongoDB Atlas) requires outbound network access from the host.

A managed application keeps its files outside the document root, so use cPanel's
environment-variable fields rather than a `.env` file. A public_html deployment
has no such fields and needs `.env`, which the generated `.htaccess` blocks from
the web.

## Verify

Open `/health`. A successful deployment returns JSON containing `"status":"ok"`.

A 502 in proxy mode means the Node process is down; read `tmp/noderyx.log`.
A Passenger error page in passenger mode usually means `PassengerNodejs` points
at a binary that does not exist on the account.

## Updating

Upload the changed files, upload `node_modules` again only if `package.json`
changed, and restart:

- Managed application: click **Restart Application**.
- Passenger mode: save `tmp/restart.txt`.
- Proxy mode: run `noderyx-stop.sh`, or delete `tmp/noderyx.pid` and wait for
  the next cron tick.
