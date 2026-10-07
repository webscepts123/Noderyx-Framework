import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { compile } from "./compiler.js";
import { noderyxIcon, noderyxSplash } from "./icons.js";
import { injectPwa, manifest, pwaOptions, serviceWorker } from "./pwa.js";
import { compileMNodeFrame } from "./mnoderframe.js";

const VIEW_EXTENSIONS = [".noderframe", ".untitled"];
const APP_NAME = /^[a-z][a-z0-9-]*$/;

export const MOBILE_DEFAULTS = {
  appId: "com.noderyx.app",
  appName: "Noderyx",
  // Name of the app inside `mobile.apps`. Null for a single-app project.
  app: null,
  entry: "home",
  views: "views",
  public: "public",
  out: "mobile",
  data: {},
  pages: {},
  // Absolute URL of the Noderyx server the packaged app calls for JSON APIs.
  // A bundled app has no origin of its own, so relative /api paths are rewritten.
  apiUrl: null,
  // Fetch screens, theme, and flags from apiUrl at launch, so the web app can
  // change the mobile UI without a store release. Needs apiUrl.
  remoteUi: true,
  exclude: ["generated", "untitled-live.js"],
  liveReloadUrl: null,
  androidScheme: "https",
  splashDuration: 1200
};

function titleCase(name) {
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Names of the apps declared in `mobile.apps`, in declaration order. */
export function mobileApps(config = {}) {
  return Object.keys(config.mobile?.apps ?? {});
}

/**
 * Resolve one app of a multi-app project into an ordinary config, so every
 * builder works unchanged. Each app gets its own views, output folder, and
 * Android/iOS projects; anything it does not set is shared from `mobile`.
 *
 *   mobile: { apiUrl, apps: { customer: { appId }, admin: { appId } } }
 */
export function mobileAppConfig(config = {}, name = null) {
  if (!name) return config;
  if (!APP_NAME.test(name)) {
    throw new Error(`Invalid mobile app name: ${name} (use lowercase letters, numbers, and hyphens)`);
  }
  const { apps = {}, ...shared } = config.mobile ?? {};
  const app = apps[name];
  if (!app) {
    const known = Object.keys(apps);
    throw new Error(`Unknown mobile app: ${name} (configured: ${known.length ? known.join(", ") : "none"})`);
  }

  const { native: nativeOwn = {}, ...own } = app;
  const baseId = shared.appId ?? MOBILE_DEFAULTS.appId;
  const mobile = {
    ...shared,
    appId: `${baseId}.${name.replaceAll("-", "_")}`,
    appName: `${shared.appName ?? MOBILE_DEFAULTS.appName} ${titleCase(name)}`,
    views: `resources/mobile/${name}`,
    out: `platforms/mobile/${name}`,
    entry: "home",
    ...own,
    app: name,
    data: { ...(shared.data ?? {}), ...(own.data ?? {}) },
    pages: { ...(shared.pages ?? {}), ...(own.pages ?? {}) }
  };
  const native = {
    ...(config.native ?? {}),
    appId: mobile.appId,
    appName: mobile.appName,
    views: mobile.views,
    entry: mobile.entry,
    apiUrl: mobile.apiUrl ?? config.native?.apiUrl ?? null,
    ...(mobile.remoteUi === undefined ? {} : { remoteUi: mobile.remoteUi }),
    out: `platforms/native/${name}`,
    ...nativeOwn,
    app: name
  };
  return { ...config, mobile, native };
}

export function mobileOptions(config = {}, overrides = {}) {
  const provided = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined)
  );
  const { apps: _apps, ...configured } = config.mobile ?? {};
  const mobile = { ...MOBILE_DEFAULTS, ...configured, ...provided };
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(mobile.appId)) {
    throw new Error(`Invalid mobile.appId: ${mobile.appId} (use reverse domain form, e.g. com.example.app)`);
  }
  if (mobile.apiUrl) mobile.apiUrl = String(mobile.apiUrl).replace(/\/+$/, "");
  mobile.pwa = pwaOptions({
    name: mobile.appName,
    description: mobile.description ?? config.description ?? "Built with Noderyx Framework.",
    ...(config.pwa ?? {}),
    ...(mobile.pwa ?? {}),
    startUrl: "/",
    scope: "/",
    offlinePath: "/offline.html"
  });
  return mobile;
}

export function webDirectory(options) {
  return join(options.out, "www");
}

/**
 * Where the Capacitor platform project lives. A single-app project keeps the
 * Capacitor default (android/ and ios/ at the root); each app of a multi-app
 * project gets its own, so the apps install side by side on one device.
 */
export function platformDirectory(options, platform) {
  return options.app ? join(options.out, platform) : platform;
}

async function collectFiles(directory, filter) {
  if (!existsSync(directory)) return [];
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await collectFiles(path, filter));
    else if (entry.isFile() && filter(path)) found.push(path);
  }
  return found;
}

function toRoute(file, viewsRoot) {
  const relativePath = relative(viewsRoot, file).replaceAll("\\", "/");
  return relativePath.slice(0, -extname(relativePath).length);
}

/**
 * A packaged app has no server to send headers, so its policy travels in the
 * document. `connect-src` must name the API host or every request is blocked.
 */
export function bundleCsp(apiUrl) {
  const remote = apiUrl ? ` ${apiUrl}` : "";
  return [
    "default-src 'self' gap: capacitor: https://localhost",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' https://localhost capacitor://localhost${remote}`
  ].join("; ");
}

/**
 * Keep page links as clean application routes. The navigation runtime maps
 * them to the bundle's private .mnoderframe payloads inside a WebView, so authors
 * and users only ever deal with /about-style URLs.
 */
export function rewriteForBundle(html, routes, entry, apiUrl = null) {
  return html
    .replace(/<script[^>]*untitled-live\.js[^>]*>\s*<\/script>/gi, "")
    .replace(/(href|action|src)="\/(?!\/)([^"#?]*)([^"]*)"/gi, (match, attribute, path, suffix) => {
      if (path === "" || path === entry) return `${attribute}="/${suffix}"`;
      if (path.startsWith("public/")) return match;
      const clean = path.replace(/\/$/, "");
      if (routes.has(clean)) return `${attribute}="/${clean}${suffix}"`;
      // Anything left is a server route; a bundled app must call it absolutely.
      return apiUrl ? `${attribute}="${apiUrl}/${path}${suffix}"` : match;
    });
}

async function copyDirectory(from, to, exclude = []) {
  if (!existsSync(from)) return 0;
  let count = 0;
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (exclude.includes(entry.name)) continue;
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      await mkdir(target, { recursive: true });
      count += await copyDirectory(source, target, exclude);
    } else if (entry.isFile()) {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      count += 1;
    }
  }
  return count;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// The bundle's CSP blocks inline handlers, so "Try again" is a plain link.
function offlinePage(options) {
  const name = escapeHtml(options.appName);
  return `<!doctype html>
<html lang="en" data-theme="dark"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${bundleCsp(options.apiUrl)}">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Offline — ${name}</title>
<link rel="stylesheet" href="/public/cool.css"></head>
<body><main class="cool-error-page"><section class="cool-error-card">
<span class="cool-error-code">···</span>
<span class="cool-eyebrow">No connection</span>
<h1>You are offline</h1>
<p class="cool-error-message">${name} will reconnect as soon as your device is back online.</p>
<div class="cool-row cool-error-actions">
<a class="cool-btn" href="/">Try again</a>
</div></section></main></body></html>
`;
}

/**
 * The document the WebView opens. Capacitor requires an index.html and serves
 * it for every unknown path, so this shell boots the router, which draws the
 * requested route from its .mnoderframe payload (or a newer remote copy).
 */
export function shellPage(options, stylesheets = []) {
  const links = stylesheets.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join("");
  return `<!doctype html>
<html lang="en" data-theme="dark" data-noderyx-shell="true"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${bundleCsp(options.apiUrl)}">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="${escapeHtml(options.pwa.themeColor)}">
<title>${escapeHtml(options.appName)}</title>
<link rel="manifest" href="/manifest.webmanifest">${links}
<script src="/public/noderyx-boot.js"></script>
<script src="/public/noderyx-native.js" defer></script>
<script src="/public/noderyx-router.js" defer></script>
</head><body style="background:${escapeHtml(options.pwa.backgroundColor)}"></body></html>
`;
}

export function capacitorConfig(options) {
  const config = {
    appId: options.appId,
    appName: options.appName,
    webDir: webDirectory(options).replaceAll("\\", "/"),
    android: { allowMixedContent: false },
    ios: { contentInset: "always" },
    server: {
      androidScheme: options.androidScheme,
      iosScheme: "capacitor"
    },
    plugins: {
      SplashScreen: {
        launchShowDuration: options.splashDuration,
        backgroundColor: options.pwa.backgroundColor,
        androidScaleType: "CENTER_CROP",
        showSpinner: false
      },
      StatusBar: {
        style: "DARK",
        backgroundColor: options.pwa.themeColor
      },
      Keyboard: { resize: "native" }
    }
  };

  if (options.app) {
    config.android.path = platformDirectory(options, "android").replaceAll("\\", "/");
    config.ios.path = platformDirectory(options, "ios").replaceAll("\\", "/");
  }
  if (options.liveReloadUrl) {
    config.server.url = options.liveReloadUrl;
    config.server.cleartext = options.liveReloadUrl.startsWith("http://");
  }
  return config;
}

async function writeIcons(directory) {
  await mkdir(directory, { recursive: true });
  const files = {
    "icon-192.png": noderyxIcon(192),
    "icon-512.png": noderyxIcon(512),
    "icon-maskable-512.png": noderyxIcon(512, { maskable: true }),
    "apple-touch-icon.png": noderyxIcon(180),
    "splash.png": noderyxSplash(2048)
  };
  for (const [name, contents] of Object.entries(files)) {
    const target = join(directory, name);
    if (existsSync(target)) continue; // never overwrite artwork the project replaced
    await writeFile(target, contents);
  }
  return Object.keys(files);
}

/**
 * Compile an app's views into `.mnoderframe` payloads. The build writes them
 * into the bundle; the server sends the same payloads as remote UI updates.
 */
export async function compileMobilePages(options, { data = {} } = {}) {
  const viewsRoot = resolve(options.views);
  if (!existsSync(viewsRoot)) {
    throw new Error(`Views directory not found: ${viewsRoot}`);
  }

  const viewFiles = await collectFiles(viewsRoot, (file) => VIEW_EXTENSIONS.includes(extname(file)));
  if (!viewFiles.length) throw new Error(`No .noderframe views found in ${viewsRoot}`);

  // Prefer .noderframe when a legacy .untitled file shares the same name.
  const preferred = new Set(viewFiles
    .filter((file) => file.endsWith(".noderframe"))
    .map((file) => file.slice(0, -".noderframe".length)));
  const selected = viewFiles.filter((file) => !(file.endsWith(".untitled")
    && preferred.has(file.slice(0, -".untitled".length))));

  const routes = new Set(selected.map((file) => toRoute(file, viewsRoot)));
  if (!routes.has(options.entry)) {
    throw new Error(`Entry view not found: ${options.entry} (available: ${[...routes].join(", ")})`);
  }

  const csp = `<meta http-equiv="Content-Security-Policy" content="${bundleCsp(options.apiUrl)}">`;
  const pages = new Map();
  let stylesheets = [];
  for (const file of selected) {
    const route = toRoute(file, viewsRoot);
    const pageData = { ...options.data, ...data, ...(options.pages[route] ?? {}) };
    const compiled = compile(await readFile(file, "utf8"), pageData);
    const bundled = rewriteForBundle(compiled, routes, options.entry, options.apiUrl);

    // The bundle's policy forbids inline scripts, so the boot code that would
    // normally be inlined ships as a file instead.
    const html = injectPwa(bundled, options.pwa)
      .replace(/<head([^>]*)>/i, `<head$1>${csp}`)
      .replace(/<script>if\("serviceWorker"[\s\S]*?<\/script>/i, "")
      .replace(
        `<script src="/public/noderyx-native.js"`,
        `<script src="/public/noderyx-boot.js" defer></script><script src="/public/noderyx-native.js"`
      );

    if (route === options.entry) {
      stylesheets = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/gi)]
        .map(([tag]) => tag.match(/href="([^"]+)"/)?.[1])
        .filter((href) => href?.startsWith("/"));
    }
    pages.set(route, compileMNodeFrame(html, route));
  }
  return { routes, pages, stylesheets };
}

function bootScript(options, routes) {
  return `// Generated by Noderyx build:mobile.
window.NODERYX_API_BASE = ${JSON.stringify(options.apiUrl ?? "")};
window.NODERYX_ROUTES = ${JSON.stringify([...routes])};
window.NODERYX_ENTRY = ${JSON.stringify(options.entry)};
window.NODERYX_APP = ${JSON.stringify(options.app ?? "default")};
window.NODERYX_REMOTE_UI = ${JSON.stringify(Boolean(options.remoteUi && options.apiUrl))};
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
`;
}

/**
 * Compile the project into a self-contained web bundle that Capacitor ships
 * inside the Android and iOS applications.
 */
export async function buildMobile(config = {}, overrides = {}, log = console.log) {
  const options = mobileOptions(config, overrides);
  const publicRoot = resolve(options.public);
  const www = resolve(webDirectory(options));

  const { routes, pages, stylesheets } = await compileMobilePages(options);

  await mkdir(www, { recursive: true });

  // Remove artifacts produced by older builds for the same known routes.
  // Targets are derived only from validated view filenames beneath the views folder.
  for (const route of routes) {
    await rm(join(www, `${route}.html`), { force: true });
    await rm(join(www, `${route}.noderframe`), { force: true });
    await rm(join(www, `${route}.mnoderframe`), { force: true });
  }

  // Every mobile page uses the dedicated compiled mobile format.
  for (const [route, source] of pages) {
    const target = join(www, `${route}.mnoderframe`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
  }

  const assets = await copyDirectory(publicRoot, join(www, "public"), options.exclude);

  // Projects created before the mobile target may not ship the runtime yet.
  // The router is always refreshed: the shell and remote UI depend on it.
  await mkdir(join(www, "public"), { recursive: true });
  if (!existsSync(join(publicRoot, "noderyx-native.js"))) {
    await writeFile(
      join(www, "public/noderyx-native.js"),
      await readFile(new URL("../public/noderyx-native.js", import.meta.url))
    );
  }
  await writeFile(
    join(www, "public/noderyx-router.js"),
    await readFile(new URL("../public/noderyx-router.js", import.meta.url))
  );

  await writeFile(join(www, "public/noderyx-boot.js"), bootScript(options, routes));

  const precache = [
    "/index.html",
    "/public/noderyx-boot.js",
    ...stylesheets,
    ...[...routes].map((route) => `/${route}.mnoderframe`)
  ];
  const pwa = { ...options.pwa, precache: [...new Set([...options.pwa.precache, ...precache])] };

  await writeIcons(join(www, "public/icons"));
  await writeFile(join(www, "manifest.webmanifest"), `${JSON.stringify(manifest(pwa), null, 2)}\n`);
  await writeFile(join(www, "sw.js"), serviceWorker(pwa));
  await writeFile(join(www, "index.html"), shellPage(options, stylesheets));
  await writeFile(join(www, "offline.html"), offlinePage(options));
  // Older builds wrote the offline page as a payload the WebView cannot open.
  await rm(join(www, "offline.mnoderframe"), { force: true });
  await writeFile(
    resolve("capacitor.config.json"),
    `${JSON.stringify(capacitorConfig(options), null, 2)}\n`
  );

  const label = options.app ? ` [${options.app}]` : "";
  log(`Built${label} ${pages.size} page${pages.size === 1 ? "" : "s"} and ${assets} asset${assets === 1 ? "" : "s"} into ${relative(process.cwd(), www) || www}`);
  log(`Entry: ${options.entry}   App ID: ${options.appId}${options.remoteUi && options.apiUrl ? `   Remote UI: ${options.apiUrl}` : ""}`);

  return { www, pages: [...routes], assets, options };
}
