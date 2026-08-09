# Deploy Noderyx Framework on cPanel

Pick the route your account supports.

| Your account | Route |
| --- | --- |
| Has **Setup Node.js App** | [Managed application](#managed-application) |
| No **Setup Node.js App** | [Run from public_html](#run-from-public_html) |
| Has **Terminal** or SSH | [One command](#update-from-github-with-one-command), after either of the above |

Not sure which? Build a bundle, upload `noderyx-check.php`, and open it in a
browser. It reports whether Passenger is present and which Node binaries exist.

## Run from public_html

`noderyx cpanel:build` writes a folder whose contents go straight into
`public_html`. No Create Application step is involved, and nothing after the
upload needs a terminal.

    npm run cpanel:build -- --user=youraccount --with-modules --repo=owner/name

The command writes `platforms/cpanel/`. Upload everything inside it, including
the hidden `.htaccess`, then open the installer in a browser.

Use `--with-modules` unless you plan to upload `node_modules` separately. These
accounts have no Run NPM Install button, and `npm` is usually absent from the
shell PATH even when Node is installed, so the ZIP has to arrive complete.

### Set up in a browser

Open `https://your-domain/noderyx-install.php?key=<key printed by the build>`.

The page lists the Node binaries it found, forges `APP_KEY`, writes `.env` and
`.htaccess` with the real absolute paths, and starts the application. It ends
with a button that deletes itself.

### Update from GitHub, also in a browser

Open `https://your-domain/noderyx-deploy.php?key=<same key>`.

Set `owner/repository` and a branch, then press **Deploy latest**. The panel
downloads the branch archive over HTTPS, replaces the application files, and
restarts. `.env`, `.htaccess`, `tmp/`, and `node_modules/` are never touched.

To deploy on every push, add the webhook the page shows under GitHub
**Settings > Webhooks**: payload URL, content type `application/json`, and the
generated secret. Requests are verified with an HMAC-SHA256 signature, and only
the configured repository and branch are accepted.

Pushes cannot install dependencies. If `package.json` changed, upload a fresh
`node_modules` or rebuild the bundle with `--with-modules`.

### Update from GitHub with one command

When the account has cPanel **Terminal** or SSH, this is the better route. It
installs dependencies, which the browser panel cannot do, and it can roll back.

    bash ~/public_html/deployment/deploy.sh init
    bash ~/public_html/deployment/deploy.sh

`init` writes `deployment/deploy.config` with the repository, the branch, and a
token for a private repository. No deploy replaces that file. The deploy itself
fetches with `git`, or with the branch tarball where git is missing, replaces
the application files, runs `npm ci --omit=dev` when `package.json` changed,
restarts, and snapshots the previous state under `~/.noderyx/backups`.

    deploy.sh status     what this account can do, and the last deploy
    deploy.sh rollback   restore the snapshot from before the last deploy
    deploy.sh logs       the last 50 lines of tmp/deploy.log
    deploy.sh cron       the cron line for scheduled deploys

Full reference: [deployment/README.md](../README.md).

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
    --node=/path/node    Node binary; the installer detects this for you
    --with-modules       Bundle node_modules so the upload needs no terminal
    --repo=owner/name    Preload the deploy panel with your GitHub repository
    --branch=main        Branch the deploy panel and webhook follow
    --port=3000          Local port for proxy mode
    --out=platforms/cpanel

Print one file without rebuilding, to add a browser tool to a live deployment:

    npm run noderyx -- cpanel:file install --user=youraccount > noderyx-install.php
    npm run noderyx -- cpanel:file deploy --repo=owner/name > noderyx-deploy.php
    npm run noderyx -- cpanel:file deploy.sh --repo=owner/name > deploy.sh
    npm run noderyx -- cpanel:file workflow --repo=owner/name
    npm run noderyx -- cpanel:file htaccess --mode=passenger --user=youraccount
    npm run noderyx -- cpanel:file check

Write the whole shell deploy route into a repository, so it reaches the server
with the next deploy and stays current afterwards:

    npm run noderyx -- cpanel:deploy-script --repo=owner/name --workflow

### What the bundle contains

    .htaccess            Starts the app and blocks source files from the web
    app.js               Startup file Passenger looks for; loads server.js
    deployment/deploy.sh One-command deploy from GitHub, for accounts with a shell
    noderyx-install.php  Browser installer: .env, .htaccess, APP_KEY
    noderyx-deploy.php   Browser deploy panel and GitHub webhook endpoint
    noderyx-check.php    Read-only environment report, key-protected
    README-CPANEL.md     Upload, configure, and restart steps for the mode
    tmp/restart.txt      Save this file to restart the app (passenger mode)
    index.php            PHP to Node bridge (proxy mode)
    noderyx-start.sh     Cron keepalive and restart script (proxy mode)
    noderyx-stop.sh      Stops the process (proxy mode)

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

### Delete the setup files when you are done

`noderyx-install.php` and `noderyx-check.php` are key-protected, but there is no
reason to leave them online once the site works. The installer's last screen has
a button that deletes both.

Keep `noderyx-deploy.php` only if you want browser or webhook deploys. It writes
files by design, so treat its key and webhook secret as passwords. Delete it if
you would rather deploy by upload.

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

With a shell, `bash ~/public_html/deployment/deploy.sh` does all of this in one
step, including the restart. It works for a managed application too: point it at
the application folder instead of `public_html`.
