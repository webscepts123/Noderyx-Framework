import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { compile } from "./compiler.js";

/**
 * cPanel deployment builder.
 *
 * Shared cPanel accounts fall into three groups and each needs a different
 * bundle inside public_html:
 *
 *   passenger  The host runs Phusion Passenger but hides "Setup Node.js App".
 *              A hand-written .htaccess starts the app straight from
 *              public_html, so no Create Application step is required.
 *   proxy      No Passenger, but a Node binary exists. A cron job keeps
 *              `node server.js` alive on a local port and a small PHP bridge
 *              in public_html forwards every request to it.
 *   static     No Node at all. Views are compiled to plain HTML files that
 *              Apache serves directly. Backend routes are not available.
 */

export const CPANEL_MODES = ["passenger", "proxy", "static"];

/** Application directories copied into the bundle, in upload order. */
const SOURCE_DIRECTORIES = ["framework", "app", "routes", "database", "resources", "packages", "public"];

/** Project files copied into the bundle when they exist. */
const SOURCE_FILES = [
  "server.js",
  "package.json",
  "package-lock.json",
  "noderyx.config.js",
  "untitled.config.js",
  ".env.example"
];

/** Directories that must never be readable over HTTP, even inside public_html. */
const PROTECTED_DIRECTORIES = [
  "app",
  "database",
  "framework",
  "node_modules",
  "packages",
  "resources",
  "routes",
  "tests",
  "tmp"
];

/** Files that must never be readable over HTTP. */
const PROTECTED_FILES = [
  "app.js",
  "server.js",
  "noderyx.config.js",
  "untitled.config.js",
  "package.json",
  "package-lock.json",
  "noderyx-start.sh",
  "noderyx-stop.sh"
];

/** Node binaries commonly present on CloudLinux and cPanel hosts. */
export const NODE_CANDIDATES = [
  "/opt/alt/alt-nodejs22/root/usr/bin/node",
  "/opt/alt/alt-nodejs20/root/usr/bin/node",
  "/opt/cpanel/ea-nodejs22/bin/node",
  "/opt/cpanel/ea-nodejs20/bin/node",
  "/usr/local/bin/node",
  "/usr/bin/node"
];

const NOT_COPIED = new Set([".git", ".github", "node_modules", "platforms", "tests", ".vscode"]);

export function cpanelOptions(overrides = {}) {
  const mode = String(overrides.mode ?? "passenger").toLowerCase();
  if (!CPANEL_MODES.includes(mode)) {
    throw new Error(`Unknown cPanel mode: ${mode}. Use ${CPANEL_MODES.join(", ")}.`);
  }
  const user = overrides.user ?? null;
  const directory = trimSlashes(overrides.directory ?? "public_html");
  const port = Number(overrides.port ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${overrides.port}`);
  }
  return {
    root: resolve(overrides.root ?? process.cwd()),
    out: overrides.out ?? "platforms/cpanel",
    mode,
    user,
    directory,
    appRoot: overrides.appRoot ?? `/home/${user ?? "CPANEL_USERNAME"}/${directory}`,
    baseUri: overrides.baseUri ?? "/",
    nodeBinary: overrides.nodeBinary ?? null,
    startupFile: overrides.startupFile ?? "app.js",
    environment: overrides.environment ?? "production",
    port,
    host: overrides.host ?? "127.0.0.1",
    views: overrides.views ?? "resources/views",
    public: overrides.public ?? "public",
    token: overrides.token ?? randomBytes(12).toString("hex")
  };
}

function trimSlashes(value) {
  return String(value).replace(/^\/+|\/+$/g, "");
}

/** Apache 2.2 and 2.4 both understand this pair; only one block ever applies. */
function denyBlock(indent = "") {
  return [
    `${indent}<IfModule mod_authz_core.c>`,
    `${indent}  Require all denied`,
    `${indent}</IfModule>`,
    `${indent}<IfModule !mod_authz_core.c>`,
    `${indent}  Order allow,deny`,
    `${indent}  Deny from all`,
    `${indent}</IfModule>`
  ].join("\n");
}

export function directoryGuard() {
  return `# Noderyx Framework: application source, never web content.\n${denyBlock()}\n`;
}

/**
 * Rules that keep the application source private while it sits in public_html.
 * Only paths that exist on disk are refused, so an application route such as
 * /app/dashboard still reaches Node.
 */
function sourceGuardRules() {
  return `<IfModule mod_rewrite.c>
  RewriteEngine On

  # Refuse real files and directories that hold application source.
  RewriteCond %{REQUEST_FILENAME} -f [OR]
  RewriteCond %{REQUEST_FILENAME} -d
  RewriteRule ^(${PROTECTED_DIRECTORIES.join("|")})(/|$) - [F,L]
  RewriteRule ^(${PROTECTED_FILES.map((file) => file.replace(/\./g, "\\.")).join("|")})$ - [F,L]
  RewriteRule (^|/)\\.(env|git|npmrc|htpasswd) - [F,L]
</IfModule>

<FilesMatch "^\\.env|\\.(env\\..*|log|sqlite|db|sh)$">
${denyBlock("  ")}
</FilesMatch>`;
}

function cacheRules() {
  return `<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/plain text/xml application/javascript application/json image/svg+xml
</IfModule>

<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/css "access plus 1 year"
  ExpiresByType application/javascript "access plus 1 year"
  ExpiresByType image/svg+xml "access plus 1 year"
  ExpiresByType image/webp "access plus 1 year"
  ExpiresByType text/html "access plus 0 seconds"
</IfModule>`;
}

export function passengerHtaccess(options) {
  const { appRoot, baseUri, startupFile, environment, nodeBinary } = cpanelOptions(options);
  const nodeLine = nodeBinary
    ? `  PassengerNodejs "${nodeBinary}"`
    : ["  # Point PassengerNodejs at the Node binary on your account. Common paths:",
        ...NODE_CANDIDATES.map((candidate) => `  #   ${candidate}`),
        "  # Open noderyx-check.php in a browser to see which one exists here.",
        `  # PassengerNodejs "${NODE_CANDIDATES[1]}"`].join("\n");
  const baseUriLine = baseUri === "/" ? "" : `  PassengerBaseURI "${baseUri}"\n`;

  return `# Noderyx Framework: run directly from ${appRoot} without "Setup Node.js App".
# Generated by: noderyx cpanel:build --mode=passenger
#
# Restart the application after an upload by updating tmp/restart.txt
# (File Manager: open the file, add a character, save).

<IfModule mod_passenger.c>
  PassengerEnabled on
  PassengerAppType node
  PassengerAppRoot "${appRoot}"
${baseUriLine}  PassengerStartupFile ${startupFile}
  PassengerAppEnv ${environment}
  PassengerFriendlyErrorPages off
${nodeLine}
</IfModule>

<IfModule !mod_passenger.c>
  # Passenger is missing on this host. Rebuild with --mode=proxy or --mode=static.
  ErrorDocument 503 "Passenger is not available on this account. See deployment/cpanel/README.md."
</IfModule>

${sourceGuardRules()}

${cacheRules()}
`;
}

export function proxyHtaccess(options) {
  const { port, host } = cpanelOptions(options);
  return `# Noderyx Framework: PHP bridge to a Node process on ${host}:${port}.
# Generated by: noderyx cpanel:build --mode=proxy
#
# Apache serves real static files; everything else is forwarded to Node by
# index.php. Keep the Node process alive with the cron job described in
# README-CPANEL.md.

${sourceGuardRules()}

<IfModule mod_rewrite.c>
  RewriteEngine On

  # Existing static assets are served straight from disk.
  RewriteCond %{REQUEST_FILENAME} -f
  RewriteCond %{REQUEST_URI} !^/(index|noderyx-check)\\.php$
  RewriteRule ^ - [L]

  # Everything else goes through the bridge.
  RewriteRule ^ index.php [QSA,L]
</IfModule>

${cacheRules()}
`;
}

export function staticHtaccess(options) {
  const { environment } = cpanelOptions(options);
  return `# Noderyx Framework: static build for hosting without Node.js.
# Generated by: noderyx cpanel:build --mode=static (${environment})

DirectoryIndex index.html home.html

<IfModule mod_rewrite.c>
  RewriteEngine On

  # Extensionless URLs resolve to the matching .html file.
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteCond %{REQUEST_FILENAME}.html -f
  RewriteRule ^(.+?)/?$ $1.html [L]
</IfModule>

<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set X-Frame-Options "SAMEORIGIN"
</IfModule>

${cacheRules()}
`;
}

/** Passenger looks for app.js by default; keep server.js as the single entry point. */
export function startupShim() {
  return `/**
 * cPanel startup file.
 *
 * Phusion Passenger loads app.js by default. Everything the application needs
 * already lives in server.js, so this file only hands control over.
 */
import "./server.js";
`;
}

export function phpBridge(options) {
  const { port, host } = cpanelOptions(options);
  return `<?php
/**
 * Noderyx Framework: PHP to Node bridge for cPanel accounts without
 * "Setup Node.js App". Every request that is not a real file arrives here and
 * is forwarded to the Node process started by noderyx-start.sh.
 *
 * Generated by: noderyx cpanel:build --mode=proxy
 */
declare(strict_types=1);

const NODERYX_UPSTREAM = 'http://${host}:${port}';
const NODERYX_TIMEOUT = 60;

/** Headers that describe one hop only and must not be forwarded. */
const NODERYX_SKIP_REQUEST = ['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding', 'upgrade'];
const NODERYX_SKIP_RESPONSE = ['connection', 'content-length', 'content-encoding', 'transfer-encoding', 'keep-alive', 'upgrade'];

if (!function_exists('curl_init')) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    exit("Noderyx bridge: the PHP cURL extension is not enabled on this account.\\n");
}

$requestHeaders = [];
foreach ($_SERVER as $key => $value) {
    if (strpos($key, 'HTTP_') !== 0) {
        continue;
    }
    $name = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($key, 5)))));
    if (in_array(strtolower($name), NODERYX_SKIP_REQUEST, true)) {
        continue;
    }
    $requestHeaders[] = $name . ': ' . $value;
}
if (!empty($_SERVER['CONTENT_TYPE'])) {
    $requestHeaders[] = 'Content-Type: ' . $_SERVER['CONTENT_TYPE'];
}

$secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['SERVER_PORT'] ?? '') === '443');
$requestHeaders[] = 'Host: ' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
$requestHeaders[] = 'X-Forwarded-For: ' . ($_SERVER['REMOTE_ADDR'] ?? '');
$requestHeaders[] = 'X-Forwarded-Proto: ' . ($secure ? 'https' : 'http');
$requestHeaders[] = 'X-Forwarded-Host: ' . ($_SERVER['HTTP_HOST'] ?? '');

$body = file_get_contents('php://input');
$target = rtrim(NODERYX_UPSTREAM, '/') . ($_SERVER['REQUEST_URI'] ?? '/');

$responseHeaders = [];
$curl = curl_init($target);
curl_setopt_array($curl, [
    CURLOPT_CUSTOMREQUEST => $_SERVER['REQUEST_METHOD'] ?? 'GET',
    CURLOPT_HTTPHEADER => $requestHeaders,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_TIMEOUT => NODERYX_TIMEOUT,
    CURLOPT_ENCODING => '',
    CURLOPT_NOBODY => ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD',
    CURLOPT_HEADERFUNCTION => function ($handle, string $line) use (&$responseHeaders): int {
        $trimmed = trim($line);
        if ($trimmed !== '' && strpos($trimmed, 'HTTP/') !== 0) {
            $responseHeaders[] = $trimmed;
        }
        return strlen($line);
    },
]);
if ($body !== '' && $body !== false) {
    curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
}

$responseBody = curl_exec($curl);
if ($responseBody === false) {
    $error = curl_error($curl);
    curl_close($curl);
    http_response_code(502);
    header('Content-Type: text/plain; charset=utf-8');
    header('Retry-After: 10');
    exit("The Noderyx application is not responding.\\n\\n" . $error . "\\n\\nStart it again with the noderyx-start.sh cron job.\\n");
}

$status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
curl_close($curl);

http_response_code($status ?: 502);
foreach ($responseHeaders as $header) {
    $name = strtolower(trim(explode(':', $header, 2)[0]));
    if (in_array($name, NODERYX_SKIP_RESPONSE, true)) {
        continue;
    }
    header($header, $name !== 'set-cookie');
}

echo $responseBody;
`;
}

export function startScript(options) {
  const { port, host, nodeBinary, directory } = cpanelOptions(options);
  return `#!/bin/bash
# Noderyx Framework: start the application and keep it running.
#
# Add this as a cPanel cron job (Cron Jobs > Add New Cron Job), every 5 minutes:
#   */5 * * * * /bin/bash "$HOME/${directory}/noderyx-start.sh" >/dev/null 2>&1
#
# The job is a no-op while the process is alive, so it doubles as a restart
# after a server reboot or an out-of-memory kill.

set -u

APP_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$APP_DIR/tmp/noderyx.pid"
LOG_FILE="$APP_DIR/tmp/noderyx.log"
NODE_BIN="\${NODERYX_NODE:-${nodeBinary ?? ""}}"

mkdir -p "$APP_DIR/tmp"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
  exit 0
fi

if [ ! -x "$NODE_BIN" ]; then
  for candidate in ${NODE_CANDIDATES.map((candidate) => `"${candidate}"`).join(" ")}; do
    if [ -x "$candidate" ]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
if [ -z "$NODE_BIN" ]; then
  echo "$(date '+%F %T') no Node binary found; open noderyx-check.php" >> "$LOG_FILE"
  exit 1
fi

cd "$APP_DIR" || exit 1

export NODE_ENV=production
export HOST="\${HOST:-${host}}"
export PORT="\${PORT:-${port}}"

nohup "$NODE_BIN" server.js >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "$(date '+%F %T') started pid $(cat "$PID_FILE") on $HOST:$PORT" >> "$LOG_FILE"
`;
}

export function stopScript() {
  return `#!/bin/bash
# Noderyx Framework: stop the application started by noderyx-start.sh.
set -u

APP_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$APP_DIR/tmp/noderyx.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "Not running."
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "Stopped $PID."
else
  echo "Stale pid file removed."
fi
rm -f "$PID_FILE"
`;
}

/**
 * Read-only diagnostics page. Accounts without "Setup Node.js App" often have
 * no SSH either, so this reports the absolute application path, the available
 * Node binaries, and a ready-to-paste .htaccess from inside the browser.
 */
export function doctorPhp(options) {
  const { token, port, host, startupFile, environment } = cpanelOptions(options);
  const candidates = NODE_CANDIDATES.map((candidate) => `    '${candidate}',`).join("\n");
  return `<?php
/**
 * Noderyx Framework: cPanel environment check.
 *
 * Open https://your-domain/noderyx-check.php?key=${token}
 * DELETE THIS FILE once the site is running.
 *
 * The page only reads information. It never changes a setting.
 */
declare(strict_types=1);

const NODERYX_KEY = '${token}';

if (!hash_equals(NODERYX_KEY, (string) ($_GET['key'] ?? ''))) {
    http_response_code(404);
    exit;
}

header('Content-Type: text/plain; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');

function noderyx_section(string $title): void {
    echo "\\n== " . $title . " ==\\n";
}

function noderyx_shell(string $command): ?string {
    $disabled = array_map('trim', explode(',', (string) ini_get('disable_functions')));
    if (in_array('shell_exec', $disabled, true) || !function_exists('shell_exec')) {
        return null;
    }
    $output = @shell_exec($command . ' 2>/dev/null');
    return $output === null ? null : trim($output);
}

$appRoot = __DIR__;

noderyx_section('Paths');
echo "PassengerAppRoot   " . $appRoot . "\\n";
echo "Document root      " . ($_SERVER['DOCUMENT_ROOT'] ?? 'unknown') . "\\n";
echo "Home               " . (getenv('HOME') ?: dirname($appRoot)) . "\\n";

noderyx_section('PHP');
echo "Version            " . PHP_VERSION . "\\n";
echo "SAPI               " . php_sapi_name() . "\\n";
echo "cURL extension     " . (function_exists('curl_init') ? 'yes' : 'no  (proxy mode will not work)') . "\\n";
echo "shell_exec         " . (noderyx_shell('echo ok') === 'ok' ? 'yes' : 'no  (cron may still work)') . "\\n";

noderyx_section('Passenger');
$modules = function_exists('apache_get_modules') ? apache_get_modules() : [];
$passenger = in_array('mod_passenger', $modules, true)
    || isset($_SERVER['PASSENGER_APP_ENV'])
    || is_dir('/usr/lib/passenger')
    || is_dir('/opt/cpanel/ea-ruby27/root/usr/share/passenger');
echo "Detected           " . ($passenger ? 'yes  -> use --mode=passenger' : 'not detected  -> try --mode=proxy') . "\\n";
if ($modules) {
    echo "mod_rewrite        " . (in_array('mod_rewrite', $modules, true) ? 'yes' : 'no') . "\\n";
}

noderyx_section('Node binaries');
$candidates = [
${candidates}
];
foreach (glob('/opt/alt/alt-nodejs*/root/usr/bin/node') ?: [] as $found) {
    $candidates[] = $found;
}
foreach (glob((getenv('HOME') ?: dirname($appRoot)) . '/nodevenv/*/*/bin/node') ?: [] as $found) {
    $candidates[] = $found;
}
$available = [];
foreach (array_unique($candidates) as $candidate) {
    if (!is_file($candidate)) {
        continue;
    }
    $version = noderyx_shell(escapeshellarg($candidate) . ' --version') ?? '(version unavailable)';
    $available[] = $candidate;
    echo str_pad($candidate, 52) . $version . "\\n";
}
if (!$available) {
    echo "None found. This account cannot run Node; rebuild with --mode=static.\\n";
}

noderyx_section('Application port ${host}:${port}');
$socket = @fsockopen('${host}', ${port}, $errno, $errstr, 2);
if ($socket) {
    fclose($socket);
    echo "Reachable          yes\\n";
} else {
    echo "Reachable          no  (" . $errstr . ")\\n";
}

noderyx_section('.htaccess for this account');
$node = $available[0] ?? '/opt/alt/alt-nodejs20/root/usr/bin/node';
echo "<IfModule mod_passenger.c>\\n";
echo "  PassengerEnabled on\\n";
echo "  PassengerAppType node\\n";
echo "  PassengerAppRoot \\"" . $appRoot . "\\"\\n";
echo "  PassengerStartupFile ${startupFile}\\n";
echo "  PassengerAppEnv ${environment}\\n";
echo "  PassengerFriendlyErrorPages off\\n";
echo "  PassengerNodejs \\"" . $node . "\\"\\n";
echo "</IfModule>\\n";

noderyx_section('Next step');
echo "Copy the block above over the matching block in .htaccess, then delete this file.\\n";
`;
}

export function deployReadme(options) {
  const settings = cpanelOptions(options);
  const { mode, appRoot, port, host, token, user } = settings;
  const userNote = user
    ? ""
    : "\n> `.htaccess` contains the placeholder `CPANEL_USERNAME`. Replace it with your\n> real cPanel username, or rebuild with `--user=yourname`. Opening\n> `noderyx-check.php` prints the exact path.\n";

  if (mode === "static") {
    return `# Noderyx Framework: static upload for cPanel

This folder is a plain website. Every file here belongs directly inside
\`public_html\`; no Node.js, no "Setup Node.js App", no Create Application.

## Upload

1. Select everything in this folder and create a ZIP.
2. cPanel > File Manager > \`public_html\` > Upload the ZIP.
3. Select the ZIP and choose Extract.
4. Confirm \`.htaccess\` is present. File Manager hides dotfiles until you enable
   Settings > Show Hidden Files.

## What works and what does not

Pages, styles, scripts, and images work. Routes in \`routes/\`, database access,
sessions, and the AI helpers do not: they need a running Node process. Point the
frontend at an API hosted elsewhere, or rebuild with \`--mode=proxy\` if the
account has a Node binary.

Rebuild after changing a view:

    npm run cpanel:build -- --mode=static
`;
  }

  const passengerSteps = `## Upload

1. Run \`npm install --omit=dev\` locally, then copy the resulting
   \`node_modules\` folder into this bundle. Shared cPanel accounts without
   "Setup Node.js App" also have no Run NPM Install button.
2. Select everything in this folder and create a ZIP.
3. cPanel > File Manager > \`${appRoot}\` > Upload the ZIP, then Extract.
4. Enable Settings > Show Hidden Files so \`.htaccess\` and \`.env\` are visible.
${userNote}
## Configure

1. Copy \`.env.example\` to \`.env\` in the same folder.
2. Set \`APP_KEY\`. Generate it locally with \`npm run noderyx -- spark:key\` and
   paste the value.
3. Set \`NODE_ENV=production\`, \`APP_URL=https://your-domain\`, and the \`DB_*\`
   values from cPanel > MySQL Databases.
4. \`.env\` is already blocked from the web by \`.htaccess\`. Verify by opening
   \`https://your-domain/.env\`; a 403 is correct.

## Check the account

Open \`https://your-domain/noderyx-check.php?key=${token}\`.

It reports the absolute application path, whether Passenger is present, and
which Node binaries exist. Paste the \`.htaccess\` block it prints over the
matching block in \`.htaccess\`. **Delete \`noderyx-check.php\` afterwards.**

## Start and restart

Passenger starts the app on the first request. To restart after an upload,
edit \`tmp/restart.txt\` in File Manager and save it.

Open \`https://your-domain/health\`; a working deployment returns JSON
containing \`"status":"ok"\`.

## If it returns 503 or a Passenger error page

Passenger is missing on this account. Rebuild in proxy mode:

    npm run cpanel:build -- --mode=proxy --port=${port}
`;

  const proxySteps = `## Upload

1. Run \`npm install --omit=dev\` locally and copy \`node_modules\` into this
   bundle.
2. Select everything here, create a ZIP, and extract it inside
   \`${appRoot}\` using cPanel File Manager.
3. Enable Settings > Show Hidden Files so \`.htaccess\` is visible.
${userNote}
## Configure

Copy \`.env.example\` to \`.env\`, set \`APP_KEY\` (\`npm run noderyx -- spark:key\`),
\`NODE_ENV=production\`, \`TRUST_PROXY=true\`, and the \`DB_*\` values. \`TRUST_PROXY\`
matters here: client addresses arrive through the PHP bridge as
\`X-Forwarded-For\`.

## Keep Node running

cPanel > Cron Jobs > Add New Cron Job, every five minutes:

    */5 * * * * /bin/bash "$HOME/${trimSlashes(settings.directory)}/noderyx-start.sh" >/dev/null 2>&1

The script is a no-op while the process is alive, so it also restarts the app
after a reboot. Logs land in \`tmp/noderyx.log\`.

To apply an update: run \`noderyx-stop.sh\` from the cron editor or wait for the
next cron tick after deleting \`tmp/noderyx.pid\`.

## Check the account

Open \`https://your-domain/noderyx-check.php?key=${token}\` to confirm a Node
binary exists and that \`${host}:${port}\` is reachable. **Delete the file
afterwards.**

## Verify

\`https://your-domain/health\` returns JSON containing \`"status":"ok"\`.

A 502 page means the Node process is not running: check \`tmp/noderyx.log\`.

## If no Node binary exists

The account cannot run this framework. Build a static site instead:

    npm run cpanel:build -- --mode=static
`;

  return `# Noderyx Framework on cPanel (${mode} mode)

Generated by \`noderyx cpanel:build --mode=${mode}\`. This bundle runs from
\`public_html\` directly and does not need cPanel's **Setup Node.js App >
Create Application** screen.

${mode === "passenger" ? passengerSteps : proxySteps}
## Updating later

Upload changed files over the old ones and restart as described above. Rebuild
this bundle with:

    npm run cpanel:build -- --mode=${mode}${user ? ` --user=${user}` : ""}
`;
}

/** Skip vendored and local-only folders wherever they appear in the tree. */
function copyable(path) {
  return !path.split(/[\\/]/).some((segment) => NOT_COPIED.has(segment));
}

async function copyProject(root, out) {
  const copied = [];
  for (const name of SOURCE_DIRECTORIES) {
    const source = join(root, name);
    if (!existsSync(source)) continue;
    await cp(source, join(out, name), {
      recursive: true,
      filter: (path) => copyable(relative(root, path))
    });
    copied.push(`${name}/`);
  }
  for (const name of SOURCE_FILES) {
    const source = join(root, name);
    if (!existsSync(source)) continue;
    await cp(source, join(out, name));
    copied.push(name);
  }
  return copied;
}

async function collectViews(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectViews(path));
    else if (entry.isFile() && /\.(noderframe|untitled)$/.test(entry.name)) files.push(path);
  }
  return files;
}

async function buildStaticSite(settings, out) {
  const viewsPath = resolve(settings.root, settings.views);
  const publicPath = resolve(settings.root, settings.public);
  const written = [];

  // Views reference assets as /public/<file>, so keep that prefix on disk.
  if (existsSync(publicPath)) {
    await cp(publicPath, join(out, "public"), { recursive: true });
    written.push("public/");
  }

  if (!existsSync(viewsPath)) return written;

  const files = await collectViews(viewsPath);
  const preferred = new Set(files
    .filter((file) => file.endsWith(".noderframe"))
    .map((file) => file.slice(0, -".noderframe".length)));

  for (const file of files) {
    const extension = file.endsWith(".noderframe") ? ".noderframe" : ".untitled";
    if (extension === ".untitled" && preferred.has(file.slice(0, -extension.length))) continue;
    const target = join(out, `${relative(viewsPath, file).slice(0, -extension.length)}.html`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, compile(await readFile(file, "utf8")));
    written.push(relative(out, target).replace(/\\/g, "/"));
  }
  return written;
}

/**
 * Write a public_html-ready bundle for cPanel.
 * Returns the settings used, the generated files, and any manual follow-up.
 */
export async function buildCpanel(overrides = {}) {
  const settings = cpanelOptions(overrides);
  const out = resolve(settings.root, settings.out);
  const notes = [];
  const files = [];

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  if (settings.mode === "static") {
    files.push(...await buildStaticSite(settings, out));
    await writeFile(join(out, ".htaccess"), staticHtaccess(settings));
    await writeFile(join(out, "README-CPANEL.md"), deployReadme(settings));
    files.push(".htaccess", "README-CPANEL.md");
    notes.push("Static builds have no backend: routes, database access, and sessions are unavailable.");
    return { ...settings, out, files, notes };
  }

  files.push(...await copyProject(settings.root, out));

  await writeFile(join(out, settings.startupFile), startupShim());
  files.push(settings.startupFile);

  for (const name of PROTECTED_DIRECTORIES) {
    const directory = join(out, name);
    if (!existsSync(directory)) continue;
    await writeFile(join(directory, ".htaccess"), directoryGuard());
    files.push(`${name}/.htaccess`);
  }

  await mkdir(join(out, "tmp"), { recursive: true });
  await writeFile(join(out, "tmp", "restart.txt"), "Save this file to restart the application.\n");
  await writeFile(join(out, "tmp", ".htaccess"), directoryGuard());
  files.push("tmp/restart.txt", "tmp/.htaccess");

  if (settings.mode === "passenger") {
    await writeFile(join(out, ".htaccess"), passengerHtaccess(settings));
    files.push(".htaccess");
    if (!settings.nodeBinary) {
      notes.push("PassengerNodejs is commented out; noderyx-check.php prints the path to use.");
    }
  } else {
    await writeFile(join(out, ".htaccess"), proxyHtaccess(settings));
    await writeFile(join(out, "index.php"), phpBridge(settings));
    await writeFile(join(out, "noderyx-start.sh"), startScript(settings));
    await writeFile(join(out, "noderyx-stop.sh"), stopScript());
    await chmod(join(out, "noderyx-start.sh"), 0o755).catch(() => {});
    await chmod(join(out, "noderyx-stop.sh"), 0o755).catch(() => {});
    files.push(".htaccess", "index.php", "noderyx-start.sh", "noderyx-stop.sh");
    notes.push(`Add the cron job from README-CPANEL.md so Node keeps listening on ${settings.host}:${settings.port}.`);
    notes.push("Set TRUST_PROXY=true in .env so client addresses survive the PHP bridge.");
  }

  await writeFile(join(out, "noderyx-check.php"), doctorPhp(settings));
  await writeFile(join(out, "README-CPANEL.md"), deployReadme(settings));
  files.push("noderyx-check.php", "README-CPANEL.md");

  if (!settings.user) {
    notes.push("No --user given: .htaccess contains the placeholder CPANEL_USERNAME.");
  }
  notes.push("node_modules is not copied. Run npm install --omit=dev locally and upload the folder.");
  notes.push(`Delete noderyx-check.php once the site works (key: ${settings.token}).`);

  return { ...settings, out, files, notes };
}
