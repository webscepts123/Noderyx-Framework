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
const SOURCE_DIRECTORIES = ["framework", "app", "routes", "database", "resources", "packages", "deployment", "public"];

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
  "deployment",
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
    token: overrides.token ?? randomBytes(12).toString("hex"),
    webhookSecret: overrides.webhookSecret ?? randomBytes(16).toString("hex"),
    repository: overrides.repository ?? null,
    branch: overrides.branch ?? "main",
    withModules: overrides.withModules ?? false
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

  # Existing static assets are served straight from disk. The browser tools are
  # PHP and must run here rather than being handed to Node.
  RewriteCond %{REQUEST_FILENAME} -f
  RewriteCond %{REQUEST_URI} !^/(index|noderyx-(check|install|deploy))\\.php$
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

// ---------------------------------------------------------------------------
// Shell deployment: bash ~/public_html/deployment/deploy.sh
// ---------------------------------------------------------------------------

/**
 * Paths a deploy must never replace. They are written by this server rather
 * than by the repository, so a branch that happens to contain them is ignored.
 * Written as rsync patterns anchored to the application root.
 */
export const DEPLOY_PRESERVED = [
  ".env",
  ".htaccess",
  "tmp/",
  "node_modules/",
  "deployment/deploy.config",
  "noderyx-install.php",
  "noderyx-deploy.php",
  "noderyx-check.php",
  "cgi-bin/",
  ".well-known/",
  "storage/",
  "public/uploads/"
];

/** Repository-only paths that have no business inside public_html. */
const DEPLOY_SKIPPED = [".git/", ".github/", ".vscode/", "platforms/"];

/**
 * The deploy script itself.
 *
 * Lives at `<app>/deployment/deploy.sh` and is run as
 * `bash ~/public_html/deployment/deploy.sh` from cPanel > Terminal, an SSH
 * session, a cron job, or a GitHub Actions step. It is the terminal-side twin
 * of noderyx-deploy.php: same source, same preserved files, same log.
 *
 * Unlike the PHP panel it can use git, install dependencies with npm, and roll
 * back, so it is the better route whenever the account has shell access.
 */
export function deployShell(options) {
  const settings = cpanelOptions(options);
  const { mode, repository, branch, directory, nodeBinary, host, port } = settings;
  const candidates = NODE_CANDIDATES.map((candidate) => `"${candidate}"`).join(" ");
  const preserved = DEPLOY_PRESERVED.map((path) => `  "${path}"`).join("\n");
  const skipped = DEPLOY_SKIPPED.map((path) => `  "${path}"`).join("\n");

  return `#!/usr/bin/env bash
# Noderyx Framework: deploy this application from GitHub, on cPanel.
#
#   bash ~/${directory}/deployment/deploy.sh
#
# Fetches the configured branch, replaces the application files, installs
# dependencies when package.json changed, and restarts the application.
#
# Files that belong to this server are never replaced:
#   .env  .htaccess  tmp/  node_modules/  deployment/deploy.config
#   storage/  public/uploads/  and anything added to KEEP in deploy.config.
#
# Commands:
#   deploy      Default. Fetch, sync, install, restart.
#   init        Write deployment/deploy.config so this account keeps its own
#               repository, branch, and token.
#   status      Print what is configured and what the last deploy did.
#   install     Install dependencies only.
#   restart     Restart the application only.
#   rollback    Restore the snapshot taken before the last deploy.
#   logs        Tail tmp/deploy.log.
#   cron        Print the cron line that deploys on a schedule.
#
# Options: --repo=owner/name --branch=name --node=/path/node --mode=${mode}
#          --install --no-install --no-restart --force --quiet --dry-run
#
# Generated by: noderyx cpanel:deploy-script

set -uo pipefail

# A deploy rewrites this file while bash is still reading it, which would make
# the shell resume at a byte offset in the new contents. Run from a copy.
if [ -z "\${NODERYX_RELAUNCHED:-}" ]; then
  __self="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)/$(basename "\${BASH_SOURCE[0]}")"
  __copy="\${TMPDIR:-/tmp}/noderyx-deploy-$$.sh"
  if cp "$__self" "$__copy" 2>/dev/null; then
    NODERYX_RELAUNCHED=1 NODERYX_SELF="$__self" bash "$__copy" "$@"
    __status=$?
    rm -f "$__copy"
    exit $__status
  fi
fi

SELF="\${NODERYX_SELF:-$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)/$(basename "\${BASH_SOURCE[0]}")}"
DEPLOY_DIR="$(cd "$(dirname "$SELF")" && pwd)"
APP_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"
STATE_DIR="\${NODERYX_STATE:-$HOME/.noderyx}"
LOG_FILE="$APP_DIR/tmp/deploy.log"
STAMP="$(date '+%Y%m%d-%H%M%S')"

# Defaults baked in at build time. deploy.config overrides them, the
# environment overrides that, and flags win over everything.
REPOSITORY="${repository ?? ""}"
BRANCH="${branch}"
MODE="${mode}"
NODE_BIN="${nodeBinary ?? ""}"
GITHUB_TOKEN=""
APP_HOST="${host}"
APP_PORT="${port}"
INSTALL="auto"
RESTART=1
QUIET=0
FORCE=0
DRY_RUN=0
BACKUPS=3
KEEP=()

# Server-owned settings. This file is never replaced by a deploy.
if [ -f "$DEPLOY_DIR/deploy.config" ]; then
  # shellcheck source=/dev/null
  . "$DEPLOY_DIR/deploy.config"
fi

REPOSITORY="\${NODERYX_REPOSITORY:-$REPOSITORY}"
BRANCH="\${NODERYX_BRANCH:-$BRANCH}"
GITHUB_TOKEN="\${NODERYX_GITHUB_TOKEN:-$GITHUB_TOKEN}"

PRESERVE=(
${preserved}
)
SKIP=(
${skipped}
)

COMMAND="deploy"
for argument in "$@"; do
  case "$argument" in
    --repo=*) REPOSITORY="\${argument#*=}" ;;
    --branch=*) BRANCH="\${argument#*=}" ;;
    --node=*) NODE_BIN="\${argument#*=}" ;;
    --mode=*) MODE="\${argument#*=}" ;;
    --token=*) GITHUB_TOKEN="\${argument#*=}" ;;
    --install) INSTALL="always" ;;
    --no-install) INSTALL="never" ;;
    --no-restart) RESTART=0 ;;
    --force) FORCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --quiet|-q) QUIET=1 ;;
    -h|--help) COMMAND="help" ;;
    --*) echo "Unknown option: $argument" >&2; exit 2 ;;
    *) COMMAND="$argument" ;;
  esac
done

mkdir -p "$APP_DIR/tmp" 2>/dev/null || true
mkdir -p "$STATE_DIR" 2>/dev/null && chmod 700 "$STATE_DIR" 2>/dev/null

say() {
  [ "$QUIET" = "1" ] || printf '%s\\n' "$*"
}

log() {
  printf '%s %s\\n' "$(date '+%F %T')" "$*" >> "$LOG_FILE" 2>/dev/null || true
  say "$*"
}

fail() {
  printf '%s error: %s\\n' "$(date '+%F %T')" "$*" >> "$LOG_FILE" 2>/dev/null || true
  printf 'error: %s\\n' "$*" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

find_node() {
  if [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ]; then
    return 0
  fi
  for candidate in ${candidates}; do
    if [ -x "$candidate" ]; then
      NODE_BIN="$candidate"
      return 0
    fi
  done
  NODE_BIN="$(command -v node 2>/dev/null || true)"
  [ -n "$NODE_BIN" ]
}

# npm is usually absent from the login PATH even where Node exists, so look
# beside the binary before trusting the shell.
find_npm() {
  NPM_BIN=""
  if [ -n "\${NODE_BIN:-}" ] && [ -x "$(dirname "$NODE_BIN")/npm" ]; then
    NPM_BIN="$(dirname "$NODE_BIN")/npm"
    return 0
  fi
  NPM_BIN="$(command -v npm 2>/dev/null || true)"
  [ -n "$NPM_BIN" ]
}

require_repository() {
  if [ -z "$REPOSITORY" ]; then
    fail "No repository set. Run: bash $SELF init"
  fi
  if ! printf '%s' "$REPOSITORY" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'; then
    fail "Repository must be owner/name, not '$REPOSITORY'."
  fi
}

remote_url() {
  if [ -n "$GITHUB_TOKEN" ]; then
    printf 'https://x-access-token:%s@github.com/%s.git' "$GITHUB_TOKEN" "$REPOSITORY"
  else
    printf 'https://github.com/%s.git' "$REPOSITORY"
  fi
}

# One deploy at a time: cron and a hand-run deploy must not interleave.
LOCK_DIR="$STATE_DIR/deploy.lock"
lock() {
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    if [ -f "$LOCK_DIR/pid" ] && ! kill -0 "$(cat "$LOCK_DIR/pid" 2>/dev/null)" 2>/dev/null; then
      rm -rf "$LOCK_DIR"
      mkdir "$LOCK_DIR" 2>/dev/null || fail "Another deploy is running."
    else
      fail "Another deploy is running. Delete $LOCK_DIR if that is wrong."
    fi
  fi
  echo $$ > "$LOCK_DIR/pid"
  trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM
}

# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------

RELEASE_DIR=""
REVISION="unknown"

fetch_with_git() {
  RELEASE_DIR="$STATE_DIR/repo"
  local url
  url="$(remote_url)"

  if [ -d "$RELEASE_DIR/.git" ]; then
    git -C "$RELEASE_DIR" remote set-url origin "$url" 2>/dev/null
    git -C "$RELEASE_DIR" fetch --depth=1 --quiet origin "$BRANCH" || fail "git fetch failed for $REPOSITORY@$BRANCH."
    git -C "$RELEASE_DIR" checkout --quiet -B "$BRANCH" "origin/$BRANCH" || fail "git checkout failed for $BRANCH."
    git -C "$RELEASE_DIR" reset --hard --quiet "origin/$BRANCH"
    git -C "$RELEASE_DIR" clean -qfd
  else
    rm -rf "$RELEASE_DIR"
    git clone --depth=1 --quiet --branch "$BRANCH" "$url" "$RELEASE_DIR" \\
      || fail "git clone failed. Check the repository, the branch, and the token for a private repository."
  fi

  chmod 700 "$RELEASE_DIR" 2>/dev/null
  REVISION="$(git -C "$RELEASE_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
}

# No git on the account: take the branch tarball, the same source the browser
# deploy panel uses.
fetch_with_archive() {
  local work="$STATE_DIR/work-$STAMP"
  local archive="$work/branch.tar.gz"
  local url="https://codeload.github.com/$REPOSITORY/tar.gz/refs/heads/$BRANCH"

  rm -rf "$work"
  mkdir -p "$work" || fail "Cannot write to $STATE_DIR."

  if command -v curl >/dev/null 2>&1; then
    if [ -n "$GITHUB_TOKEN" ]; then
      curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" -o "$archive" "$url" || fail "Download failed: $url"
    else
      curl -fsSL -o "$archive" "$url" || fail "Download failed: $url"
    fi
  elif command -v wget >/dev/null 2>&1; then
    if [ -n "$GITHUB_TOKEN" ]; then
      wget -q --header="Authorization: Bearer $GITHUB_TOKEN" -O "$archive" "$url" || fail "Download failed: $url"
    else
      wget -q -O "$archive" "$url" || fail "Download failed: $url"
    fi
  else
    fail "No git, curl, or wget on this account. Use noderyx-deploy.php in a browser instead."
  fi

  tar -xzf "$archive" -C "$work" || fail "The archive could not be unpacked."
  rm -f "$archive"

  # GitHub wraps the tree in <repo>-<branch>/.
  local inner
  inner="$(find "$work" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  [ -n "$inner" ] || fail "The archive was empty."
  RELEASE_DIR="$inner"
  REVISION="$BRANCH-archive"
}

prepare_release() {
  if command -v git >/dev/null 2>&1; then
    fetch_with_git
  else
    fetch_with_archive
  fi

  if [ ! -f "$RELEASE_DIR/package.json" ] && [ "$FORCE" != "1" ]; then
    fail "$REPOSITORY@$BRANCH has no package.json at its root. Use --force to deploy it anyway."
  fi
}

cleanup_release() {
  case "$RELEASE_DIR" in
    "$STATE_DIR"/work-*) rm -rf "$(dirname "$RELEASE_DIR")" ;;
  esac
  rm -rf "$STATE_DIR"/work-* 2>/dev/null
}

# ---------------------------------------------------------------------------
# Applying
# ---------------------------------------------------------------------------

# Every protected path, as a list of paths relative to the application root.
# KEEP is expanded the long way so an empty array does not trip set -u on the
# bash 4.2 that older CloudLinux images still ship.
protected_paths() {
  printf '%s\\n' "\${PRESERVE[@]}" \${KEEP[@]+"\${KEEP[@]}"} "\${SKIP[@]}"
}

is_preserved() {
  local candidate="$1" path
  while read -r path; do
    [ "\${path%/}" = "$candidate" ] && return 0
  done < <(protected_paths)
  return 1
}

# True when something below this directory is protected, so the directory has
# to be copied entry by entry rather than replaced wholesale.
holds_preserved() {
  local candidate="$1" path
  while read -r path; do
    case "\${path%/}" in "$candidate"/*) return 0 ;; esac
  done < <(protected_paths)
  return 1
}

backup_current() {
  BACKUP_DIR="$STATE_DIR/backups/$STAMP"
  mkdir -p "$BACKUP_DIR" || return 0
  # node_modules is large and reinstallable; tmp/ is runtime state. Neither is
  # copied in the first place: disk I/O is the scarce resource on these plans.
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude=/node_modules/ --exclude=/tmp/ "$APP_DIR/" "$BACKUP_DIR/" 2>/dev/null
  else
    local entry base
    shopt -s dotglob nullglob
    for entry in "$APP_DIR"/*; do
      base="$(basename "$entry")"
      case "$base" in node_modules|tmp) continue ;; esac
      cp -a "$entry" "$BACKUP_DIR/" 2>/dev/null
    done
    shopt -u dotglob nullglob
  fi
  # Keep the newest few so a rollback is possible without filling the quota.
  ls -1dt "$STATE_DIR/backups"/*/ 2>/dev/null | tail -n +$((BACKUPS + 1)) | while read -r old; do
    rm -rf "$old"
  done
}

sync_release() {
  local excludes=() path
  for path in "\${PRESERVE[@]}" \${KEEP[@]+"\${KEEP[@]}"} "\${SKIP[@]}"; do
    excludes+=("--exclude=/$path")
  done
  # A branch without its own deployment/ must not delete this script.
  [ -d "$RELEASE_DIR/deployment" ] || excludes+=("--exclude=/deployment/")

  if command -v rsync >/dev/null 2>&1; then
    local flags=(-a --delete)
    [ "$DRY_RUN" = "1" ] && flags+=(--dry-run --itemize-changes)
    rsync "\${flags[@]}" "\${excludes[@]}" "$RELEASE_DIR/" "$APP_DIR/" \\
      || fail "rsync failed. Check the permissions on $APP_DIR."
    return 0
  fi

  # Without rsync, files deleted from the branch stay behind; everything else
  # is still replaced, so the deploy is applied rather than refused.
  log "rsync is missing: copying instead, so files removed from the branch stay on disk."
  local entry base
  shopt -s dotglob nullglob
  for entry in "$RELEASE_DIR"/*; do
    base="$(basename "$entry")"
    copy_tree "$entry" "$APP_DIR/$base" "$base"
  done
  shopt -u dotglob nullglob
}

# Replace one path, descending only where a protected path sits underneath.
# deployment/ is the case that matters: deploy.sh must follow the branch while
# deploy.config stays exactly as this account wrote it.
copy_tree() {
  local source="$1" destination="$2" path="$3" entry base
  is_preserved "$path" && return 0

  if [ -d "$source" ] && holds_preserved "$path"; then
    mkdir -p "$destination" || fail "Cannot create $destination."
    shopt -s dotglob nullglob
    for entry in "$source"/*; do
      base="$(basename "$entry")"
      copy_tree "$entry" "$destination/$base" "$path/$base"
    done
    shopt -u dotglob nullglob
    return 0
  fi

  if [ "$DRY_RUN" = "1" ]; then
    say "would copy $path"
    return 0
  fi
  rm -rf "$destination"
  cp -a "$source" "$destination" || fail "Cannot write $path into $APP_DIR."
}

# ---------------------------------------------------------------------------
# Dependencies and restart
# ---------------------------------------------------------------------------

dependency_fingerprint() {
  cat "$APP_DIR/package.json" "$APP_DIR/package-lock.json" 2>/dev/null | cksum | awk '{print $1 "-" $2}'
}

install_dependencies() {
  [ -f "$APP_DIR/package.json" ] || return 0
  if [ "$INSTALL" = "never" ]; then
    say "Skipping dependencies (--no-install)."
    return 0
  fi

  local fingerprint stored
  fingerprint="$(dependency_fingerprint)"
  stored="$(cat "$STATE_DIR/dependencies.txt" 2>/dev/null || true)"
  if [ "$INSTALL" != "always" ] && [ "$fingerprint" = "$stored" ] && [ -d "$APP_DIR/node_modules" ]; then
    say "Dependencies unchanged."
    return 0
  fi

  if ! find_node || ! find_npm; then
    log "npm was not found, so dependencies were not installed. Upload node_modules, or set NODE_BIN in deploy.config."
    return 0
  fi

  local command="install"
  [ -f "$APP_DIR/package-lock.json" ] && command="ci"
  say "Running npm $command."
  if [ "$DRY_RUN" = "1" ]; then
    return 0
  fi

  if (cd "$APP_DIR" && PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" "$command" --omit=dev --no-audit --no-fund >> "$LOG_FILE" 2>&1); then
    printf '%s' "$fingerprint" > "$STATE_DIR/dependencies.txt"
    log "Dependencies installed with npm $command."
  else
    # npm ci refuses a lockfile that drifted from package.json; install copes.
    if [ "$command" = "ci" ] && (cd "$APP_DIR" && PATH="$(dirname "$NODE_BIN"):$PATH" "$NPM_BIN" install --omit=dev --no-audit --no-fund >> "$LOG_FILE" 2>&1); then
      printf '%s' "$fingerprint" > "$STATE_DIR/dependencies.txt"
      log "Dependencies installed with npm install after npm ci failed."
    else
      fail "npm $command failed. The last lines of tmp/deploy.log say why."
    fi
  fi
}

restart_app() {
  if [ "$RESTART" != "1" ] || [ "$DRY_RUN" = "1" ]; then
    return 0
  fi
  if [ "$MODE" = "proxy" ]; then
    [ -f "$APP_DIR/noderyx-stop.sh" ] && bash "$APP_DIR/noderyx-stop.sh" >/dev/null 2>&1
    if [ -f "$APP_DIR/noderyx-start.sh" ]; then
      find_node
      NODERYX_NODE="\${NODE_BIN:-}" HOST="$APP_HOST" PORT="$APP_PORT" bash "$APP_DIR/noderyx-start.sh"
      log "Restarted the Node process on $APP_HOST:$APP_PORT."
      return 0
    fi
    log "noderyx-start.sh is missing, so nothing was restarted."
    return 0
  fi
  # Passenger reloads on the next request when this file changes. It is also
  # what "Setup Node.js App" watches, so managed applications restart too.
  mkdir -p "$APP_DIR/tmp"
  date '+%F %T' > "$APP_DIR/tmp/restart.txt"
  log "Touched tmp/restart.txt; the next request reloads the application."
}

run_hook() {
  [ -f "$DEPLOY_DIR/after-deploy.sh" ] || return 0
  [ "$DRY_RUN" = "1" ] && return 0
  say "Running deployment/after-deploy.sh."
  (cd "$APP_DIR" && NODERYX_APP_DIR="$APP_DIR" NODE_BIN="\${NODE_BIN:-}" bash "$DEPLOY_DIR/after-deploy.sh") \\
    || log "after-deploy.sh exited non-zero; the deploy itself succeeded."
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

command_deploy() {
  require_repository
  lock

  log "Deploying $REPOSITORY@$BRANCH into $APP_DIR."
  prepare_release
  log "Fetched $REVISION."

  [ "$DRY_RUN" = "1" ] || backup_current
  sync_release
  cleanup_release

  if [ "$DRY_RUN" = "1" ]; then
    say "Dry run: nothing was written."
    return 0
  fi

  install_dependencies
  restart_app
  run_hook

  printf '%s %s@%s (%s)\\n' "$(date '+%F %T')" "$REPOSITORY" "$BRANCH" "$REVISION" > "$APP_DIR/tmp/last-deploy.txt"
  log "Deployed $REPOSITORY@$BRANCH ($REVISION)."
}

command_init() {
  local target="$DEPLOY_DIR/deploy.config"
  if [ -f "$target" ] && [ "$FORCE" != "1" ]; then
    fail "$target already exists. Edit it, or pass --force to replace it."
  fi
  cat > "$target" <<CONFIG
# Noderyx deploy settings for this account.
# A deploy never replaces this file, so it is the right place for anything
# that belongs to this server rather than to the repository.

REPOSITORY="$REPOSITORY"
BRANCH="$BRANCH"
MODE="$MODE"

# Leave empty to detect the Node binary automatically.
NODE_BIN="\${NODE_BIN:-}"

# Fine-grained personal access token with read access to the repository.
# Only needed for a private repository. Keep this file at chmod 600.
GITHUB_TOKEN=""

# auto installs only when package.json changed; always or never override that.
INSTALL="auto"

# Extra paths this deploy must not replace, relative to the application root.
KEEP=()
CONFIG
  chmod 600 "$target"
  say "Wrote $target. Set REPOSITORY, then run: bash $SELF"
}

command_status() {
  find_node || true
  find_npm || true
  printf 'Application  %s\\n' "$APP_DIR"
  printf 'Repository   %s\\n' "\${REPOSITORY:-(not set)}"
  printf 'Branch       %s\\n' "$BRANCH"
  printf 'Mode         %s\\n' "$MODE"
  printf 'Node         %s\\n' "\${NODE_BIN:-(not found)}"
  printf 'npm          %s\\n' "\${NPM_BIN:-(not found)}"
  printf 'git          %s\\n' "$(command -v git 2>/dev/null || echo '(not found; uses the branch tarball)')"
  printf 'rsync        %s\\n' "$(command -v rsync 2>/dev/null || echo '(not found; copies without deleting)')"
  printf 'Config       %s\\n' "$([ -f "$DEPLOY_DIR/deploy.config" ] && echo "$DEPLOY_DIR/deploy.config" || echo '(none; using built-in defaults)')"
  printf 'Last deploy  %s\\n' "$(cat "$APP_DIR/tmp/last-deploy.txt" 2>/dev/null || echo 'never')"
  printf 'Snapshots    %s\\n' "$(ls -1d "$STATE_DIR/backups"/*/ 2>/dev/null | wc -l | tr -d ' ')"
}

command_rollback() {
  local latest
  latest="$(ls -1dt "$STATE_DIR/backups"/*/ 2>/dev/null | head -n 1)"
  [ -n "$latest" ] || fail "No snapshot to roll back to."
  lock
  log "Rolling back to $latest."
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude=/node_modules/ --exclude=/tmp/ "$latest" "$APP_DIR/" || fail "Rollback failed."
  else
    cp -a "$latest/." "$APP_DIR/" || fail "Rollback failed."
  fi
  restart_app
  log "Rolled back to $latest."
}

command_cron() {
  printf 'cPanel > Cron Jobs > Add New Cron Job, once every 30 minutes:\\n\\n'
  printf '  */30 * * * * /bin/bash "$HOME/${directory}/deployment/deploy.sh" --quiet >/dev/null 2>&1\\n\\n'
  printf 'Deploys only replace files that changed, so a run with nothing new is cheap.\\n'
}

command_help() {
  sed -n '2,40p' "$SELF" | sed 's/^# \\{0,1\\}//'
}

case "$COMMAND" in
  deploy) command_deploy ;;
  init) command_init ;;
  status) command_status ;;
  install) find_node || true; INSTALL="always"; install_dependencies ;;
  restart) restart_app ;;
  rollback) command_rollback ;;
  logs) tail -n 50 "$LOG_FILE" 2>/dev/null || echo "No deploys yet." ;;
  cron) command_cron ;;
  help) command_help ;;
  *) fail "Unknown command: $COMMAND. Try: deploy, init, status, install, restart, rollback, logs, cron." ;;
esac
`;
}

/** Server-owned settings file, written by `deploy.sh init` and never deployed over. */
export function deployConfig(options) {
  const { repository, branch, mode, nodeBinary } = cpanelOptions(options);
  return `# Noderyx deploy settings for this account.
#
# Copy this file to deployment/deploy.config on the server and keep it at
# chmod 600. A deploy never replaces it, so it is the right place for anything
# that belongs to this server rather than to the repository.
#
# On the server, "bash deployment/deploy.sh init" writes it for you.

REPOSITORY="${repository ?? "owner/repository"}"
BRANCH="${branch}"
MODE="${mode}"

# Leave empty to detect the Node binary automatically.
NODE_BIN="${nodeBinary ?? ""}"

# Fine-grained personal access token with read access to the repository.
# Only needed for a private repository.
GITHUB_TOKEN=""

# auto installs only when package.json changed; always or never override that.
INSTALL="auto"

# Extra paths this deploy must not replace, relative to the application root.
KEEP=()
`;
}

/**
 * Workflow that runs the same command over SSH after a push. Deliberately uses
 * plain ssh rather than a marketplace action, so nothing outside GitHub and the
 * host is involved in a deployment.
 */
export function deployWorkflow(options) {
  const { branch, directory } = cpanelOptions(options);
  return `name: Deploy to cPanel

# Runs "bash ~/${directory}/deployment/deploy.sh" on the host after a push.
#
# Repository secrets to add under Settings > Secrets and variables > Actions:
#   CPANEL_HOST  server address, for example server123.web-hosting.com
#   CPANEL_USER  cPanel account name
#   CPANEL_KEY   private SSH key, the whole file including the header lines
#   CPANEL_PORT  optional, defaults to 22
#
# Create the key pair in cPanel > SSH Access > Manage SSH Keys, authorise the
# public key there, and paste the private key into CPANEL_KEY.
#
# No SSH on the account? Delete this file and use the webhook printed by
# noderyx-deploy.php instead.

on:
  push:
    branches: [${branch}]
  workflow_dispatch:

concurrency:
  group: cpanel-deploy
  cancel-in-progress: false

jobs:
  deploy:
    name: Deploy ${directory}
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Authorise the host
        env:
          CPANEL_KEY: \${{ secrets.CPANEL_KEY }}
          CPANEL_HOST: \${{ secrets.CPANEL_HOST }}
          CPANEL_PORT: \${{ secrets.CPANEL_PORT }}
        run: |
          mkdir -p ~/.ssh
          printf '%s\\n' "$CPANEL_KEY" > ~/.ssh/id_deploy
          chmod 600 ~/.ssh/id_deploy
          ssh-keyscan -p "\${CPANEL_PORT:-22}" -H "$CPANEL_HOST" >> ~/.ssh/known_hosts 2>/dev/null

      - name: Run the deploy script
        env:
          CPANEL_HOST: \${{ secrets.CPANEL_HOST }}
          CPANEL_USER: \${{ secrets.CPANEL_USER }}
          CPANEL_PORT: \${{ secrets.CPANEL_PORT }}
        run: |
          ssh -i ~/.ssh/id_deploy -p "\${CPANEL_PORT:-22}" -o BatchMode=yes \\
            "$CPANEL_USER@$CPANEL_HOST" \\
            'bash ~/${directory}/deployment/deploy.sh --branch=${branch}'

      - name: Forget the key
        if: always()
        run: rm -f ~/.ssh/id_deploy
`;
}

/** README that ships next to deploy.sh, in the bundle and in the repository. */
export function deployShellReadme(options) {
  const { directory, mode, repository, branch } = cpanelOptions(options);
  const example = repository ?? "owner/repository";
  return `# Deploy from GitHub with one command

    bash ~/${directory}/deployment/deploy.sh

Run it in cPanel > Terminal, over SSH, from a cron job, or from GitHub Actions.
It fetches the branch, replaces the application files, installs dependencies
when \`package.json\` changed, and restarts the application.

## First run

    bash ~/${directory}/deployment/deploy.sh init

That writes \`deployment/deploy.config\`, which holds this account's repository,
branch, and token. A deploy never replaces it. Set \`REPOSITORY="${example}"\`,
then deploy:

    bash ~/${directory}/deployment/deploy.sh

## Commands

    deploy      Default. Fetch, sync, install, restart.
    init        Write deployment/deploy.config.
    status      What is configured, and what the last deploy did.
    install     Install dependencies only.
    restart     Restart the application only.
    rollback    Restore the snapshot taken before the last deploy.
    logs        Last 50 lines of tmp/deploy.log.
    cron        Print the cron line for scheduled deploys.

Options: \`--repo=owner/name\`, \`--branch=name\`, \`--node=/path/node\`,
\`--mode=${mode}\`, \`--install\`, \`--no-install\`, \`--no-restart\`, \`--force\`,
\`--quiet\`, \`--dry-run\`.

## What is never replaced

\`.env\`, \`.htaccess\`, \`tmp/\`, \`node_modules/\`, \`storage/\`,
\`public/uploads/\`, the \`noderyx-*.php\` browser tools, and
\`deployment/deploy.config\`. Add more in \`KEEP\` inside \`deploy.config\`.

A snapshot of the application, without \`node_modules/\` and \`tmp/\`, is taken
before every deploy and kept under \`~/.noderyx/backups\`. The three newest are
kept; \`rollback\` restores the latest.

## Private repositories

Create a fine-grained personal access token with read access to the repository
and put it in \`deployment/deploy.config\` as \`GITHUB_TOKEN\`. Keep the file at
\`chmod 600\`; \`init\` does that for you.

## Deploy on every push

Add \`.github/workflows/deploy-cpanel.yml\` to the repository:

    npx noderyx cpanel:deploy-script --workflow --branch=${branch}

It runs this same command over SSH using the \`CPANEL_HOST\`, \`CPANEL_USER\`,
and \`CPANEL_KEY\` repository secrets. On an account without SSH, use the
webhook that \`noderyx-deploy.php\` prints instead.

## Scheduled deploys

    */30 * * * * /bin/bash "$HOME/${directory}/deployment/deploy.sh" --quiet >/dev/null 2>&1

A run with nothing new to fetch only touches files that changed.

## After a deploy

Put anything else the site needs in \`deployment/after-deploy.sh\`; the script
runs it from the application root, with \`NODE_BIN\` set. Migrations belong
there:

    "$NODE_BIN" node_modules/.bin/noderyx migrate

Commit that file. It comes from the repository like the rest of the
application, so a change to it reaches the server with the next deploy.

## When it will not work

No \`git\`, \`curl\`, or \`wget\` on the account: use \`noderyx-deploy.php\` in a
browser. No \`rsync\`: files removed from the branch stay on disk, and the
script says so. No \`npm\`: upload \`node_modules\` once, and deploys keep it.
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

/** Shared markup and helpers for the browser tools, kept identical between them. */
function phpUiHelpers(title) {
  return `function noderyx_e(?string $value): string {
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

function noderyx_head(string $heading, string $subheading = ''): void {
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8">';
    echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<meta name="robots" content="noindex, nofollow">';
    echo '<title>' . noderyx_e('${title}') . '</title><style>';
    echo ':root{color-scheme:dark}*{box-sizing:border-box}';
    echo 'body{margin:0;padding:2rem 1rem;background:#0d1117;color:#e6edf3;';
    echo 'font:15px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}';
    echo '.wrap{max-width:820px;margin:0 auto}';
    echo 'h1{font-size:1.5rem;margin:0 0 .25rem}h2{font-size:1.05rem;margin:2rem 0 .75rem}';
    echo '.sub{color:#8b949e;margin:0 0 2rem}';
    echo '.card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:1.25rem;margin:0 0 1rem}';
    echo 'label{display:block;margin:.85rem 0 .3rem;font-weight:600;font-size:.9rem}';
    echo 'input,select{width:100%;padding:.55rem .7rem;border-radius:7px;border:1px solid #30363d;';
    echo 'background:#0d1117;color:#e6edf3;font:inherit;font-size:.92rem}';
    echo 'input:focus,select:focus{outline:2px solid #2f81f7;outline-offset:-1px;border-color:#2f81f7}';
    echo '.hint{color:#8b949e;font-size:.82rem;margin:.3rem 0 0}';
    echo 'button{margin-top:1.5rem;padding:.65rem 1.3rem;border-radius:7px;border:0;';
    echo 'background:#238636;color:#fff;font:inherit;font-weight:600;cursor:pointer}';
    echo 'button:hover{background:#2ea043}button.alt{background:#30363d}button.alt:hover{background:#3c444d}';
    echo 'button.danger{background:#a4251f}button.danger:hover{background:#c9302c}';
    echo 'table{width:100%;border-collapse:collapse;font-size:.9rem}';
    echo 'td{padding:.35rem 0;border-bottom:1px solid #21262d;vertical-align:top}';
    echo 'td:first-child{color:#8b949e;width:42%;padding-right:1rem}';
    echo 'code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.85rem}';
    echo 'pre{background:#0d1117;border:1px solid #30363d;border-radius:7px;padding:.9rem;overflow-x:auto}';
    echo '.ok{color:#3fb950}.bad{color:#f85149}.warn{color:#d29922}';
    echo '.row{display:flex;gap:.75rem;flex-wrap:wrap;align-items:center}';
    echo '.row button{margin-top:0}';
    echo '</style></head><body><div class="wrap">';
    echo '<h1>' . noderyx_e($heading) . '</h1>';
    if ($subheading !== '') {
        echo '<p class="sub">' . noderyx_e($subheading) . '</p>';
    }
}

function noderyx_foot(): void {
    echo '</div></body></html>';
}

/** Node binaries present on this account, best first. */
function noderyx_node_binaries(): array {
    $found = [];
    $candidates = ${JSON.stringify(NODE_CANDIDATES).replace(/"/g, "'")};
    foreach (glob('/opt/alt/alt-nodejs*/root/usr/bin/node') ?: [] as $path) {
        $candidates[] = $path;
    }
    foreach (glob('/opt/cpanel/ea-nodejs*/bin/node') ?: [] as $path) {
        $candidates[] = $path;
    }
    $home = getenv('HOME') ?: dirname(__DIR__);
    foreach (glob($home . '/nodevenv/*/*/bin/node') ?: [] as $path) {
        $candidates[] = $path;
    }
    foreach (array_unique($candidates) as $candidate) {
        if (is_file($candidate)) {
            $found[] = $candidate;
        }
    }
    rsort($found);
    return $found;
}

function noderyx_passenger(): bool {
    $modules = function_exists('apache_get_modules') ? apache_get_modules() : [];
    return in_array('mod_passenger', $modules, true)
        || isset($_SERVER['PASSENGER_APP_ENV'])
        || is_dir('/usr/lib/passenger')
        || (bool) glob('/opt/cpanel/ea-ruby*/root/usr/share/passenger');
}

/** APP_KEY must be 32 random bytes, base64url, matching generateKey(). */
function noderyx_app_key(): string {
    return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
}

function noderyx_restart(): bool {
    @mkdir(__DIR__ . '/tmp', 0755, true);
    return (bool) @file_put_contents(
        __DIR__ . '/tmp/restart.txt',
        "Restarted " . gmdate('c') . "\\n"
    );
}`;
}

/**
 * Browser installer. cPanel accounts without Setup Node.js App usually have no
 * SSH either, and npm is not on the PATH even when Node exists, so the whole
 * first-time setup has to be possible from File Manager plus a browser tab.
 */
export function installerPhp(options) {
  const settings = cpanelOptions(options);
  const { token, port, host, startupFile, environment } = settings;
  const passengerTemplate = Buffer.from(passengerHtaccess({
    ...settings,
    appRoot: "__APP_ROOT__",
    nodeBinary: "__NODE_BINARY__"
  })).toString("base64");
  const proxyTemplate = Buffer.from(proxyHtaccess(settings)).toString("base64");

  return `<?php
/**
 * Noderyx Framework: browser installer for cPanel.
 *
 * Open https://your-domain/noderyx-install.php?key=${token}
 *
 * Writes .env and .htaccess, forges APP_KEY, and starts the application.
 * Delete this file when the site is live; the last screen has a button.
 */
declare(strict_types=1);

const NODERYX_KEY = '${token}';
const NODERYX_LOCK = __DIR__ . '/tmp/install.lock';
const NODERYX_PASSENGER_TEMPLATE = '${passengerTemplate}';
const NODERYX_PROXY_TEMPLATE = '${proxyTemplate}';

if (!hash_equals(NODERYX_KEY, (string) ($_REQUEST['key'] ?? ''))) {
    http_response_code(404);
    exit;
}

header('X-Robots-Tag: noindex, nofollow');

${phpUiHelpers("Install Noderyx")}

/** Merge overrides into .env.example, keeping every other documented line. */
function noderyx_env(array $values): string {
    $example = @file_get_contents(__DIR__ . '/.env.example');
    $lines = $example === false ? [] : preg_split('/\\r\\n|\\r|\\n/', $example);
    $seen = [];
    $out = [];
    foreach ($lines as $line) {
        if (preg_match('/^([A-Z0-9_]+)=/', $line, $match) && array_key_exists($match[1], $values)) {
            $out[] = $match[1] . '=' . $values[$match[1]];
            $seen[$match[1]] = true;
            continue;
        }
        $out[] = $line;
    }
    $extra = [];
    foreach ($values as $name => $value) {
        if (!isset($seen[$name])) {
            $extra[] = $name . '=' . $value;
        }
    }
    if ($extra) {
        $out[] = '';
        $out[] = '# Added by the Noderyx installer';
        $out = array_merge($out, $extra);
    }
    return rtrim(implode("\\n", $out)) . "\\n";
}

function noderyx_delete_self(): void {
    foreach (['noderyx-install.php', 'noderyx-check.php'] as $file) {
        @unlink(__DIR__ . '/' . $file);
    }
}

$binaries = noderyx_node_binaries();
$passenger = noderyx_passenger();
$installed = is_file(NODERYX_LOCK);
$action = (string) ($_POST['action'] ?? '');

if ($action === 'delete') {
    noderyx_delete_self();
    noderyx_head('Installer removed', 'The setup files are gone. Your site keeps running.');
    echo '<div class="card"><p class="ok">noderyx-install.php and noderyx-check.php were deleted.</p>';
    echo '<p class="hint">Manage releases from noderyx-deploy.php.</p></div>';
    noderyx_foot();
    exit;
}

if ($action === 'restart') {
    $ok = noderyx_restart();
    noderyx_head('Restart requested', '');
    echo '<div class="card"><p class="' . ($ok ? 'ok' : 'bad') . '">'
        . ($ok ? 'tmp/restart.txt updated. The next request reloads the application.' : 'Could not write tmp/restart.txt.')
        . '</p><p><a href="?key=' . noderyx_e(NODERYX_KEY) . '">Back</a></p></div>';
    noderyx_foot();
    exit;
}

if ($action === 'install') {
    $errors = [];
    $appUrl = trim((string) ($_POST['app_url'] ?? ''));
    $appName = trim((string) ($_POST['app_name'] ?? 'Noderyx'));
    $node = (string) ($_POST['node_binary'] ?? '');
    $mode = ($_POST['mode'] ?? 'passenger') === 'proxy' ? 'proxy' : 'passenger';

    if ($appUrl === '' || !filter_var($appUrl, FILTER_VALIDATE_URL)) {
        $errors[] = 'Enter the full site address, including https://';
    }
    if ($node !== '' && !in_array($node, $binaries, true)) {
        $errors[] = 'Select a Node binary that exists on this account.';
    }
    if ($mode === 'passenger' && $node === '') {
        $errors[] = 'Passenger mode needs a Node binary. Choose --mode=proxy if none is listed.';
    }

    if (!$errors) {
        $env = noderyx_env([
            'APP_NAME' => $appName,
            'SITE_NAME' => $appName,
            'APP_KEY' => noderyx_app_key(),
            'APP_URL' => $appUrl,
            'SITE_URL' => $appUrl,
            'NODE_ENV' => '${environment}',
            'APP_DEBUG' => 'false',
            'TRUST_PROXY' => $mode === 'proxy' ? 'true' : 'false',
            'SESSION_SECURE' => str_starts_with($appUrl, 'https://') ? 'true' : 'false',
            'DB_TYPE' => (string) ($_POST['db_type'] ?? 'mysql'),
            'DB_HOST' => (string) ($_POST['db_host'] ?? '127.0.0.1'),
            'DB_PORT' => (string) ($_POST['db_port'] ?? '3306'),
            'DB_NAME' => (string) ($_POST['db_name'] ?? ''),
            'DB_USER' => (string) ($_POST['db_user'] ?? ''),
            'DB_PASSWORD' => (string) ($_POST['db_password'] ?? ''),
        ]);

        $htaccess = $mode === 'passenger'
            ? str_replace(
                ['__APP_ROOT__', '__NODE_BINARY__'],
                [__DIR__, $node],
                (string) base64_decode(NODERYX_PASSENGER_TEMPLATE)
            )
            : (string) base64_decode(NODERYX_PROXY_TEMPLATE);

        $wroteEnv = @file_put_contents(__DIR__ . '/.env', $env) !== false;
        if ($wroteEnv) {
            @chmod(__DIR__ . '/.env', 0600);
        } else {
            $errors[] = 'Could not write .env. Set the folder to 755 in File Manager and retry.';
        }
        if (@file_put_contents(__DIR__ . '/.htaccess', $htaccess) === false) {
            $errors[] = 'Could not write .htaccess.';
        }
        if (!$errors) {
            @mkdir(__DIR__ . '/tmp', 0755, true);
            @file_put_contents(NODERYX_LOCK, gmdate('c') . ' ' . $mode . "\\n");
            noderyx_restart();

            noderyx_head('Noderyx is installed', 'Check the site, then remove the installer.');
            echo '<div class="card"><table>';
            echo '<tr><td>.env</td><td class="ok">written, permissions 600</td></tr>';
            echo '<tr><td>APP_KEY</td><td class="ok">forged</td></tr>';
            echo '<tr><td>.htaccess</td><td class="ok">written for ' . noderyx_e($mode) . ' mode</td></tr>';
            if ($mode === 'passenger') {
                echo '<tr><td>Node binary</td><td><code>' . noderyx_e($node) . '</code></td></tr>';
            }
            echo '<tr><td>Application root</td><td><code>' . noderyx_e(__DIR__) . '</code></td></tr>';
            echo '</table></div>';
            echo '<h2>Confirm it works</h2><div class="card">';
            echo '<p>Open <a href="' . noderyx_e(rtrim($appUrl, '/')) . '/health" target="_blank" rel="noopener">'
                . noderyx_e(rtrim($appUrl, '/')) . '/health</a>. It should return JSON containing '
                . '<code>"status":"ok"</code>.</p>';
            if ($mode === 'proxy') {
                echo '<p class="warn">Proxy mode also needs the cron job from README-CPANEL.md so Node keeps running.</p>';
            }
            echo '</div>';
            echo '<h2>Remove the setup files</h2><div class="card">';
            echo '<p>They are protected by a secret key, but there is no reason to leave them online.</p>';
            echo '<form method="post"><input type="hidden" name="key" value="' . noderyx_e(NODERYX_KEY) . '">';
            echo '<input type="hidden" name="action" value="delete">';
            echo '<button class="danger" type="submit">Delete installer and check page</button></form></div>';
            noderyx_foot();
            exit;
        }
    }

    noderyx_head('Could not finish', '');
    echo '<div class="card">';
    foreach ($errors as $error) {
        echo '<p class="bad">' . noderyx_e($error) . '</p>';
    }
    echo '<p><a href="?key=' . noderyx_e(NODERYX_KEY) . '">Back to the form</a></p></div>';
    noderyx_foot();
    exit;
}

noderyx_head('Install Noderyx', 'No terminal needed. This writes .env and .htaccess for you.');

if ($installed) {
    echo '<div class="card"><p class="warn">This site is already installed ('
        . noderyx_e(trim((string) @file_get_contents(NODERYX_LOCK))) . ').</p>';
    echo '<p class="hint">Submitting the form again overwrites .env, which forges a new APP_KEY '
        . 'and signs every existing session out.</p></div>';
}

echo '<h2>This account</h2><div class="card"><table>';
echo '<tr><td>Application root</td><td><code>' . noderyx_e(__DIR__) . '</code></td></tr>';
echo '<tr><td>Passenger</td><td class="' . ($passenger ? 'ok' : 'warn') . '">'
    . ($passenger ? 'available' : 'not detected, use proxy mode') . '</td></tr>';
echo '<tr><td>Node binaries</td><td>' . ($binaries
    ? '<code>' . implode('</code><br><code>', array_map('noderyx_e', $binaries)) . '</code>'
    : '<span class="bad">none found</span>') . '</td></tr>';
echo '<tr><td>node_modules</td><td class="' . (is_dir(__DIR__ . '/node_modules') ? 'ok' : 'bad') . '">'
    . (is_dir(__DIR__ . '/node_modules') ? 'present' : 'missing, upload it before starting') . '</td></tr>';
echo '</table></div>';

echo '<h2>Settings</h2><form method="post"><div class="card">';
echo '<input type="hidden" name="key" value="' . noderyx_e(NODERYX_KEY) . '">';
echo '<input type="hidden" name="action" value="install">';

$guessedUrl = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https://' : 'http://')
    . ($_SERVER['HTTP_HOST'] ?? 'example.com');

echo '<label for="app_name">Site name</label>';
echo '<input id="app_name" name="app_name" value="Noderyx" required>';

echo '<label for="app_url">Site address</label>';
echo '<input id="app_url" name="app_url" type="url" value="' . noderyx_e($guessedUrl) . '" required>';

echo '<label for="mode">How the site runs</label><select id="mode" name="mode">';
echo '<option value="passenger"' . ($passenger ? ' selected' : '') . '>Passenger, started by .htaccess</option>';
echo '<option value="proxy"' . ($passenger ? '' : ' selected') . '>PHP bridge to a Node process on port ${port}</option>';
echo '</select><p class="hint">Passenger is best when available. The bridge needs the cron job from README-CPANEL.md.</p>';

echo '<label for="node_binary">Node binary</label><select id="node_binary" name="node_binary">';
if (!$binaries) {
    echo '<option value="">none found on this account</option>';
}
foreach ($binaries as $binary) {
    echo '<option value="' . noderyx_e($binary) . '">' . noderyx_e($binary) . '</option>';
}
echo '</select>';
echo '</div><div class="card"><p class="hint">Database, from cPanel &gt; MySQL Databases. '
    . 'Leave blank if the site does not use one.</p>';

echo '<label for="db_type">Engine</label><select id="db_type" name="db_type">';
echo '<option value="mysql">MySQL or MariaDB</option><option value="postgres">PostgreSQL</option>';
echo '<option value="mongo">MongoDB</option></select>';
echo '<label for="db_host">Host</label><input id="db_host" name="db_host" value="127.0.0.1">';
echo '<label for="db_port">Port</label><input id="db_port" name="db_port" value="3306">';
echo '<label for="db_name">Database name</label><input id="db_name" name="db_name" placeholder="account_noderyx">';
echo '<label for="db_user">User</label><input id="db_user" name="db_user" placeholder="account_user">';
echo '<label for="db_password">Password</label><input id="db_password" name="db_password" type="password" autocomplete="new-password">';
echo '<button type="submit">Install</button>';
echo '</div></form>';
noderyx_foot();
`;
}

/**
 * Browser deploy panel. Pulls a branch straight from GitHub over HTTPS, so
 * updating a live site is a button press or an automatic reaction to a push.
 * git and npm are never invoked from a shell; neither is on the PATH here.
 */
export function deployPhp(options) {
  const settings = cpanelOptions(options);
  const { token, webhookSecret, repository, branch } = settings;

  return `<?php
/**
 * Noderyx Framework: deploy and update panel for cPanel.
 *
 * Open https://your-domain/noderyx-deploy.php?key=${token}
 *
 * Downloads a branch archive from GitHub, replaces the application files, and
 * restarts. Local files that belong to this server are never overwritten:
 * .env, .htaccess, tmp/, and node_modules/ are preserved.
 */
declare(strict_types=1);

const NODERYX_KEY = '${token}';
const NODERYX_WEBHOOK_SECRET = '${webhookSecret}';
const NODERYX_REPOSITORY = ${repository ? `'${repository}'` : "''"};
const NODERYX_BRANCH = '${branch}';

/** Never replaced by a deploy: these hold server-specific state. */
const NODERYX_PRESERVE = ['.env', '.htaccess', 'tmp', 'node_modules', '.well-known',
    'noderyx-install.php', 'noderyx-deploy.php', 'noderyx-check.php', 'cgi-bin'];

const NODERYX_LOG = __DIR__ . '/tmp/deploy.log';
const NODERYX_MAX_ARCHIVE = 104857600;

function noderyx_log(string $message): void {
    @mkdir(__DIR__ . '/tmp', 0755, true);
    @file_put_contents(NODERYX_LOG, gmdate('c') . ' ' . $message . "\\n", FILE_APPEND);
}

${phpUiHelpers("Deploy Noderyx")}

function noderyx_repository(): string {
    $stored = @file_get_contents(__DIR__ . '/tmp/repository.txt');
    $value = $stored === false ? NODERYX_REPOSITORY : trim($stored);
    return preg_match('#^[\\w.-]+/[\\w.-]+$#', $value) ? $value : '';
}

function noderyx_branch(): string {
    $stored = @file_get_contents(__DIR__ . '/tmp/branch.txt');
    $value = $stored === false ? NODERYX_BRANCH : trim($stored);
    return preg_match('#^[\\w./-]+$#', $value) ? $value : NODERYX_BRANCH;
}

/** Remove a directory tree without following symlinks out of it. */
function noderyx_rmtree(string $path): void {
    if (is_link($path) || is_file($path)) {
        @unlink($path);
        return;
    }
    if (!is_dir($path)) {
        return;
    }
    foreach (scandir($path) ?: [] as $entry) {
        if ($entry !== '.' && $entry !== '..') {
            noderyx_rmtree($path . '/' . $entry);
        }
    }
    @rmdir($path);
}

function noderyx_copy_tree(string $from, string $to, array &$report): void {
    @mkdir($to, 0755, true);
    foreach (scandir($from) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        $source = $from . '/' . $entry;
        $target = $to . '/' . $entry;
        if (is_dir($source)) {
            noderyx_copy_tree($source, $target, $report);
            continue;
        }
        if (@copy($source, $target)) {
            $report['files']++;
        } else {
            $report['failed'][] = $entry;
        }
    }
}

/**
 * Download and unpack a branch. Returns the extracted directory or null.
 * Uses the ZIP archive because ZipArchive is enabled far more often on shared
 * hosting than the phar extension needed for tarballs.
 */
function noderyx_fetch(string $repository, string $branch, array &$messages): ?string {
    if (!class_exists('ZipArchive')) {
        $messages[] = ['bad', 'PHP is missing the zip extension, so archives cannot be unpacked.'];
        return null;
    }
    if (!function_exists('curl_init')) {
        $messages[] = ['bad', 'PHP is missing the cURL extension, so GitHub cannot be reached.'];
        return null;
    }

    $url = 'https://codeload.github.com/' . $repository . '/zip/refs/heads/' . rawurlencode($branch);
    @mkdir(__DIR__ . '/tmp', 0755, true);
    $archive = __DIR__ . '/tmp/deploy-' . bin2hex(random_bytes(4)) . '.zip';

    $handle = @fopen($archive, 'wb');
    if (!$handle) {
        $messages[] = ['bad', 'Cannot write to tmp/. Set it to 755 in File Manager.'];
        return null;
    }

    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_FILE => $handle,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_TIMEOUT => 180,
        CURLOPT_USERAGENT => 'Noderyx-Deploy',
        CURLOPT_FAILONERROR => true,
    ]);
    $ok = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $error = curl_error($curl);
    curl_close($curl);
    fclose($handle);

    if (!$ok) {
        @unlink($archive);
        $messages[] = ['bad', $status === 404
            ? 'GitHub returned 404. Check the repository name and branch, and note that private repositories are not supported here.'
            : 'Download failed: ' . $error];
        return null;
    }
    if (filesize($archive) > NODERYX_MAX_ARCHIVE) {
        @unlink($archive);
        $messages[] = ['bad', 'The archive is larger than 100 MB; deploy it by upload instead.'];
        return null;
    }

    $target = __DIR__ . '/tmp/unpacked-' . bin2hex(random_bytes(4));
    $zip = new ZipArchive();
    if ($zip->open($archive) !== true || !$zip->extractTo($target)) {
        @unlink($archive);
        noderyx_rmtree($target);
        $messages[] = ['bad', 'The archive could not be unpacked.'];
        return null;
    }
    $zip->close();
    @unlink($archive);

    // GitHub wraps everything in <repo>-<branch>/.
    $entries = array_values(array_diff(scandir($target) ?: [], ['.', '..']));
    if (count($entries) === 1 && is_dir($target . '/' . $entries[0])) {
        return $target . '/' . $entries[0];
    }
    return $target;
}

function noderyx_deploy(string $repository, string $branch, array &$messages): bool {
    $source = noderyx_fetch($repository, $branch, $messages);
    if ($source === null) {
        return false;
    }

    $report = ['files' => 0, 'failed' => []];
    $kept = 0;
    foreach (scandir($source) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        if (in_array($entry, NODERYX_PRESERVE, true)) {
            $kept++;
            continue;
        }
        $from = $source . '/' . $entry;
        $to = __DIR__ . '/' . $entry;
        if (is_dir($from)) {
            noderyx_copy_tree($from, $to, $report);
        } elseif (@copy($from, $to)) {
            $report['files']++;
        } else {
            $report['failed'][] = $entry;
        }
    }
    noderyx_rmtree(dirname($source) === __DIR__ . '/tmp' ? $source : dirname($source));

    if ($report['files'] === 0) {
        $messages[] = ['bad', 'Nothing was copied. Check folder permissions in File Manager.'];
        noderyx_log('deploy failed: no files copied');
        return false;
    }

    // $kept counts only collisions. Local files absent from the archive, which
    // is the usual case for .env and tmp/, are never touched in the first place.
    $messages[] = ['ok', $report['files'] . ' files updated from ' . $repository . '@' . $branch . '.'
        . ($kept > 0 ? ' ' . $kept . ' local file(s) kept instead of being overwritten.' : '')];
    if ($report['failed']) {
        $messages[] = ['warn', 'Could not replace: ' . implode(', ', array_slice($report['failed'], 0, 8))];
    }
    if (noderyx_restart()) {
        $messages[] = ['ok', 'Application restarted.'];
    }
    @file_put_contents(__DIR__ . '/tmp/last-deploy.txt', gmdate('c') . ' ' . $repository . '@' . $branch . "\\n");
    noderyx_log('deployed ' . $repository . '@' . $branch . ' (' . $report['files'] . ' files)');
    return true;
}

// ---------------------------------------------------------------------------
// GitHub webhook: fires on every push so the site follows the branch by itself
// ---------------------------------------------------------------------------

if (isset($_GET['webhook'])) {
    header('Content-Type: text/plain; charset=utf-8');
    $payload = file_get_contents('php://input') ?: '';
    $signature = (string) ($_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '');
    $expected = 'sha256=' . hash_hmac('sha256', $payload, NODERYX_WEBHOOK_SECRET);

    if ($signature === '' || !hash_equals($expected, $signature)) {
        http_response_code(401);
        noderyx_log('webhook rejected: bad signature');
        exit("invalid signature\\n");
    }
    if (($_SERVER['HTTP_X_GITHUB_EVENT'] ?? '') === 'ping') {
        exit("pong\\n");
    }

    $event = json_decode($payload, true);
    $branch = noderyx_branch();
    if (!is_array($event) || ($event['ref'] ?? '') !== 'refs/heads/' . $branch) {
        noderyx_log('webhook ignored: ref ' . (is_array($event) ? (string) ($event['ref'] ?? '?') : '?'));
        exit("ignored\\n");
    }

    $repository = (string) ($event['repository']['full_name'] ?? noderyx_repository());
    if ($repository === '' || $repository !== noderyx_repository()) {
        http_response_code(403);
        noderyx_log('webhook refused repository ' . $repository);
        exit("repository not allowed\\n");
    }

    $messages = [];
    $ok = noderyx_deploy($repository, $branch, $messages);
    http_response_code($ok ? 200 : 500);
    foreach ($messages as [$level, $text]) {
        echo $level . ': ' . $text . "\\n";
    }
    exit;
}

if (!hash_equals(NODERYX_KEY, (string) ($_REQUEST['key'] ?? ''))) {
    http_response_code(404);
    exit;
}

header('X-Robots-Tag: noindex, nofollow');

$messages = [];
$action = (string) ($_POST['action'] ?? '');

if ($action === 'save') {
    $repository = trim((string) ($_POST['repository'] ?? ''));
    $branch = trim((string) ($_POST['branch'] ?? 'main'));
    if (!preg_match('#^[\\w.-]+/[\\w.-]+$#', $repository)) {
        $messages[] = ['bad', 'Use the owner/repository form, such as webscepts123/Noderyx-Framework.'];
    } elseif (!preg_match('#^[\\w./-]+$#', $branch)) {
        $messages[] = ['bad', 'That branch name is not valid.'];
    } else {
        @mkdir(__DIR__ . '/tmp', 0755, true);
        @file_put_contents(__DIR__ . '/tmp/repository.txt', $repository);
        @file_put_contents(__DIR__ . '/tmp/branch.txt', $branch);
        $messages[] = ['ok', 'Saved ' . $repository . '@' . $branch . '.'];
    }
} elseif ($action === 'deploy') {
    $repository = noderyx_repository();
    if ($repository === '') {
        $messages[] = ['bad', 'Set the repository first.'];
    } else {
        noderyx_deploy($repository, noderyx_branch(), $messages);
    }
} elseif ($action === 'restart') {
    $messages[] = noderyx_restart()
        ? ['ok', 'tmp/restart.txt updated; the next request reloads the application.']
        : ['bad', 'Could not write tmp/restart.txt.'];
}

$repository = noderyx_repository();
$branch = noderyx_branch();
$last = trim((string) @file_get_contents(__DIR__ . '/tmp/last-deploy.txt'));
$webhookUrl = ((isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https://' : 'http://')
    . ($_SERVER['HTTP_HOST'] ?? 'example.com') . '/noderyx-deploy.php?webhook=1';

noderyx_head('Deploy Noderyx', 'Update the live site from GitHub. No terminal, no git, no npm.');

foreach ($messages as [$level, $text]) {
    echo '<div class="card"><p class="' . noderyx_e($level) . '">' . noderyx_e($text) . '</p></div>';
}

echo '<h2>Source</h2><form method="post"><div class="card">';
echo '<input type="hidden" name="key" value="' . noderyx_e(NODERYX_KEY) . '">';
echo '<input type="hidden" name="action" value="save">';
echo '<label for="repository">GitHub repository</label>';
echo '<input id="repository" name="repository" value="' . noderyx_e($repository) . '" placeholder="owner/repository" required>';
echo '<p class="hint">Must be public. The panel downloads the branch archive over HTTPS.</p>';
echo '<label for="branch">Branch</label>';
echo '<input id="branch" name="branch" value="' . noderyx_e($branch) . '" required>';
echo '<button class="alt" type="submit">Save</button></div></form>';

echo '<h2>Update now</h2><div class="card">';
echo '<p>Downloads <code>' . noderyx_e($repository !== '' ? $repository : 'owner/repository')
    . '@' . noderyx_e($branch) . '</code> and replaces the application files.</p>';
echo '<p class="hint">Kept untouched: <code>.env</code>, <code>.htaccess</code>, <code>tmp/</code>, '
    . '<code>node_modules/</code>. If package.json changed you still need to upload a fresh '
    . 'node_modules, because npm is not available here.</p>';
if ($last !== '') {
    echo '<p class="hint">Last deploy: ' . noderyx_e($last) . '</p>';
}
echo '<form method="post" class="row">';
echo '<input type="hidden" name="key" value="' . noderyx_e(NODERYX_KEY) . '">';
echo '<input type="hidden" name="action" value="deploy">';
echo '<button type="submit"' . ($repository === '' ? ' disabled' : '') . '>Deploy latest</button>';
echo '</form></div>';

echo '<h2>Deploy on every push</h2><div class="card">';
echo '<p>In GitHub: <strong>Settings &gt; Webhooks &gt; Add webhook</strong>.</p><table>';
echo '<tr><td>Payload URL</td><td><code>' . noderyx_e($webhookUrl) . '</code></td></tr>';
echo '<tr><td>Content type</td><td><code>application/json</code></td></tr>';
echo '<tr><td>Secret</td><td><code>' . noderyx_e(NODERYX_WEBHOOK_SECRET) . '</code></td></tr>';
echo '<tr><td>Events</td><td>Just the push event</td></tr>';
echo '</table>';
echo '<p class="hint">Pushes to <code>' . noderyx_e($branch) . '</code> then deploy by themselves. '
    . 'Every request is checked against the secret with an HMAC signature; unsigned calls are refused.</p>';
echo '</div>';

echo '<h2>Restart</h2><div class="card">';
echo '<p>Use this after editing files by hand in File Manager.</p>';
echo '<form method="post" class="row">';
echo '<input type="hidden" name="key" value="' . noderyx_e(NODERYX_KEY) . '">';
echo '<input type="hidden" name="action" value="restart">';
echo '<button class="alt" type="submit">Restart application</button>';
echo '</form></div>';

noderyx_foot();
`;
}

export function deployReadme(options) {
  const settings = cpanelOptions(options);
  const { mode, appRoot, port, host, token, user } = settings;
  const userNote = user
    ? ""
    : "\n> `.htaccess` contains the placeholder `CPANEL_USERNAME`. The browser installer\n> replaces it with the real absolute path, so you can ignore it, or rebuild with\n> `--user=yourname` to fill it in ahead of time.\n";

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

Nothing here needs a terminal on the server. cPanel accounts without "Setup
Node.js App" also have no Run NPM Install button, and \`npm\` is usually missing
from the shell PATH even when Node is installed.

1. Select everything in this folder and create a ZIP.
2. cPanel > File Manager > \`${appRoot}\` > Upload the ZIP, then Extract.
3. Enable Settings > Show Hidden Files so \`.htaccess\` and \`.env\` are visible.

If \`node_modules/\` is missing from this bundle, rebuild with
\`--with-modules\` and upload again. The application cannot start without it.
${userNote}
## Install in the browser

Open \`https://your-domain/noderyx-install.php?key=${token}\`.

The page lists the Node binaries on the account, forges \`APP_KEY\`, writes
\`.env\` and \`.htaccess\` with the correct absolute paths, and starts the
application. Fill in the site address and, if you use one, the database details
from cPanel > MySQL Databases.

The last screen has a button that deletes the installer. Use it.

## Update from GitHub

Open \`https://your-domain/noderyx-deploy.php?key=${token}\`.

Set the repository to \`owner/repository\`, pick the branch, and press
**Deploy latest**. It downloads the branch from GitHub, replaces the application
files, and restarts. \`.env\`, \`.htaccess\`, \`tmp/\`, and \`node_modules/\` are
preserved.

To deploy on every push, add the webhook shown on that page under GitHub
Settings > Webhooks. Requests are verified with an HMAC signature.

## Update from GitHub with one command

If the account has cPanel > Terminal or SSH, this is the better route: it can
install dependencies, and it can roll back.

    bash ~/${trimSlashes(settings.directory)}/deployment/deploy.sh init
    bash ~/${trimSlashes(settings.directory)}/deployment/deploy.sh

The first command writes \`deployment/deploy.config\`, where the repository,
branch, and any token for a private repository live. The second fetches the
branch, replaces the application files, runs \`npm ci --omit=dev\` when
\`package.json\` changed, and restarts. \`deployment/README.md\` has the rest,
including scheduled deploys and \`rollback\`.

## Verify

Open \`https://your-domain/health\`; a working deployment returns JSON
containing \`"status":"ok"\`.

Also open \`https://your-domain/.env\`. A 403 is correct; anything else means
\`.htaccess\` did not upload.

## Restarting later

Passenger reloads when \`tmp/restart.txt\` changes. Use the button on the deploy
page, or edit the file in File Manager and save.

## If it returns 503 or a Passenger error page

Passenger is missing on this account. Rebuild in proxy mode:

    npm run cpanel:build -- --mode=proxy --port=${port} --with-modules
`;

  const proxySteps = `## Upload

1. Select everything here, create a ZIP, and extract it inside
   \`${appRoot}\` using cPanel File Manager.
2. Enable Settings > Show Hidden Files so \`.htaccess\` is visible.

If \`node_modules/\` is missing from this bundle, rebuild with
\`--with-modules\` and upload again.
${userNote}
## Install in the browser

Open \`https://your-domain/noderyx-install.php?key=${token}\`, choose the PHP
bridge option, and fill in the site address and database details. It forges
\`APP_KEY\`, writes \`.env\` and \`.htaccess\`, and sets \`TRUST_PROXY=true\` so
client addresses survive the bridge.

Delete the installer with the button on the last screen.

## Update from GitHub

Open \`https://your-domain/noderyx-deploy.php?key=${token}\` to pull a branch
and restart, or add the webhook it shows so every push deploys by itself.

With Terminal or SSH, one command does the same and can install dependencies:

    bash ~/${trimSlashes(settings.directory)}/deployment/deploy.sh init
    bash ~/${trimSlashes(settings.directory)}/deployment/deploy.sh

It stops and restarts the Node process for you. See \`deployment/README.md\`.

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

/**
 * Write deployment/ into an application root: the deploy script, the settings
 * example, the README, and the guard that keeps all of it off the web.
 *
 * Used both by the bundle builder and by `noderyx cpanel:deploy-script`, which
 * writes the same files into the repository so a deploy keeps them current.
 */
export async function writeDeploymentKit(options, target) {
  const settings = cpanelOptions(options);
  const directory = join(target, "deployment");
  await mkdir(directory, { recursive: true });

  await writeFile(join(directory, "deploy.sh"), deployShell(settings));
  // Not every host honours the mode after a File Manager upload, which is why
  // the documented command is "bash deploy.sh" rather than "./deploy.sh".
  await chmod(join(directory, "deploy.sh"), 0o755).catch(() => {});
  await writeFile(join(directory, "deploy.config.example"), deployConfig(settings));
  await writeFile(join(directory, "README.md"), deployShellReadme(settings));
  await writeFile(join(directory, ".htaccess"), directoryGuard());

  return ["deployment/deploy.sh", "deployment/deploy.config.example", "deployment/README.md", "deployment/.htaccess"];
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

  // The one-command deploy route: bash ~/<dir>/deployment/deploy.sh
  files.push(...await writeDeploymentKit(settings, out));
  notes.push(`Shell deploys: bash ~/${settings.directory}/deployment/deploy.sh (run "init" first).`);

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
  await writeFile(join(out, "noderyx-install.php"), installerPhp(settings));
  await writeFile(join(out, "noderyx-deploy.php"), deployPhp(settings));
  await writeFile(join(out, "README-CPANEL.md"), deployReadme(settings));
  files.push("noderyx-check.php", "noderyx-install.php", "noderyx-deploy.php", "README-CPANEL.md");

  // Shared accounts have no Run NPM Install button and npm is not on the PATH,
  // so the upload has to arrive complete for a terminal-free setup.
  const modules = join(settings.root, "node_modules");
  if (settings.withModules && existsSync(modules)) {
    await cp(modules, join(out, "node_modules"), {
      recursive: true,
      // Only drop repository metadata: every package directory must survive.
      filter: (path) => !relative(settings.root, path).split(/[\\/]/).includes(".git")
    });
    await writeFile(join(out, "node_modules", ".htaccess"), directoryGuard());
    files.push("node_modules/");
  } else if (settings.withModules) {
    notes.push("No node_modules found. Run npm install --omit=dev first, then rebuild with --with-modules.");
  } else {
    notes.push("node_modules is not bundled. Add --with-modules so the upload needs no terminal.");
  }

  if (!settings.user) {
    notes.push("No --user given: .htaccess contains the placeholder CPANEL_USERNAME, and the installer rewrites it.");
  }
  notes.push(`Open noderyx-install.php?key=${settings.token} to finish setup in a browser.`);

  // copyProject and the guard loop can both reach deployment/.htaccess.
  return { ...settings, out, files: [...new Set(files)], notes };
}
