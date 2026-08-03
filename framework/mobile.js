import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { compile } from "./compiler.js";
import { noderyxIcon, noderyxSplash } from "./icons.js";
import { injectPwa, manifest, pwaOptions, serviceWorker } from "./pwa.js";
import { compileMNodeFrame } from "./mnoderframe.js";

const VIEW_EXTENSIONS = [".noderframe", ".untitled"];

export const MOBILE_DEFAULTS = {
  appId: "com.noderyx.app",
  appName: "Noderyx",
  entry: "home",
  views: "views",
  public: "public",
  out: "mobile",
  data: {},
  pages: {},
  // Absolute URL of the Noderyx server the packaged app calls for JSON APIs.
  // A bundled app has no origin of its own, so relative /api paths are rewritten.
  apiUrl: null,
  exclude: ["generated", "untitled-live.js"],
  liveReloadUrl: null,
  androidScheme: "https",
  splashDuration: 1200
};

export function mobileOptions(config = {}, overrides = {}) {
  const provided = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined)
  );
  const mobile = { ...MOBILE_DEFAULTS, ...(config.mobile ?? {}), ...provided };
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(mobile.appId)) {
    throw new Error(`Invalid mobile.appId: ${mobile.appId} (use reverse domain form, e.g. com.example.app)`);
  }
  if (mobile.apiUrl) mobile.apiUrl = String(mobile.apiUrl).replace(/\/+$/, "");
  mobile.pwa = pwaOptions({
    name: mobile.appName,
    description: mobile.description ?? config.description ?? "Built with Noderyx Framework.",
    ...(config.pwa ?? {}),
    ...(mobile.pwa ?? {}),
    startUrl: `/${mobile.entry}.mnoderframe`,
    scope: "/",
    offlinePath: "/offline.mnoderframe"
  });
  return mobile;
}

export function webDirectory(options) {
  return join(options.out, "www");
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

function offlinePage(options) {
  return `<!doctype html>
<html lang="en" data-theme="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Offline â€” ${options.appName}</title>
<link rel="stylesheet" href="/public/cool.css"></head>
<body><main class="cool-error-page"><section class="cool-error-card">
<span class="cool-error-code">Â·Â·Â·</span>
<span class="cool-eyebrow">No connection</span>
<h1>You are offline</h1>
<p class="cool-error-message">${options.appName} will reconnect as soon as your device is back online.</p>
<div class="cool-row cool-error-actions">
<button class="cool-btn" type="button" onclick="location.reload()">Try again</button>
</div></section></main></body></html>
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
 * Compile the project into a self-contained web bundle that Capacitor ships
 * inside the Android and iOS applications.
 */
export async function buildMobile(config = {}, overrides = {}, log = console.log) {
  const options = mobileOptions(config, overrides);
  const viewsRoot = resolve(options.views);
  const publicRoot = resolve(options.public);
  const www = resolve(webDirectory(options));

  if (!existsSync(viewsRoot)) {
    throw new Error(`Views directory not found: ${viewsRoot}`);
  }

  await mkdir(www, { recursive: true });

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

  // Remove artifacts produced by older builds for the same known routes.
  // Targets are derived only from validated view filenames beneath viewsRoot.
  for (const route of routes) {
    await rm(join(www, `${route}.html`), { force: true });
    await rm(join(www, `${route}.noderframe`), { force: true });
    await rm(join(www, `${route}.mnoderframe`), { force: true });
  }

  const pages = [];
  for (const file of selected) {
    const route = toRoute(file, viewsRoot);
    const data = { ...options.data, ...(options.pages[route] ?? {}) };
    const compiled = compile(await readFile(file, "utf8"), data);
    const bundled = rewriteForBundle(compiled, routes, options.entry, options.apiUrl);
    const csp = `<meta http-equiv="Content-Security-Policy" content="${bundleCsp(options.apiUrl)}">`;

    // The bundle's policy forbids inline scripts, so the boot code that would
    // normally be inlined ships as a file instead.
    const html = injectPwa(bundled, options.pwa)
      .replace(/<head([^>]*)>/i, `<head$1>${csp}`)
      .replace(/<script>if\("serviceWorker"[\s\S]*?<\/script>/i, "")
      .replace(
        `<script src="/public/noderyx-native.js"`,
        `<script src="/public/noderyx-boot.js" defer></script><script src="/public/noderyx-native.js"`
      );

    // Every mobile page uses the dedicated compiled mobile format.
    const target = join(www, `${route}.mnoderframe`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, compileMNodeFrame(html, route));
    pages.push(route);
  }

  const assets = await copyDirectory(publicRoot, join(www, "public"), options.exclude);

  // Projects created before the mobile target may not ship the bridge yet.
  if (!existsSync(join(publicRoot, "noderyx-native.js"))) {
    await mkdir(join(www, "public"), { recursive: true });
    await writeFile(
      join(www, "public/noderyx-native.js"),
      await readFile(new URL("../public/noderyx-native.js", import.meta.url))
    );
  }
  if (!existsSync(join(publicRoot, "noderyx-router.js"))) {
    await mkdir(join(www, "public"), { recursive: true });
    await writeFile(
      join(www, "public/noderyx-router.js"),
      await readFile(new URL("../public/noderyx-router.js", import.meta.url))
    );
  }

  await writeFile(join(www, "public/noderyx-boot.js"), `// Generated by Noderyx build:mobile.
window.NODERYX_API_BASE = ${JSON.stringify(options.apiUrl ?? "")};
window.NODERYX_ROUTES = ${JSON.stringify([...routes])};
window.NODERYX_ENTRY = ${JSON.stringify(options.entry)};
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
`);

  await writeIcons(join(www, "public/icons"));
  await writeFile(join(www, "manifest.webmanifest"), `${JSON.stringify(manifest(options.pwa), null, 2)}\n`);
  await writeFile(join(www, "sw.js"), serviceWorker(options.pwa));
  await writeFile(
    join(www, "offline.mnoderframe"),
    compileMNodeFrame(offlinePage(options), "offline")
  );
  // Remove legacy WebView documents so mobile/www is .mnoderframe-only.
  await rm(join(www, "index.html"), { force: true });
  await rm(join(www, "offline.html"), { force: true });
  await writeFile(
    resolve("capacitor.config.json"),
    `${JSON.stringify(capacitorConfig(options), null, 2)}\n`
  );

  log(`Built ${pages.length} page${pages.length === 1 ? "" : "s"} and ${assets} asset${assets === 1 ? "" : "s"} into ${relative(process.cwd(), www) || www}`);
  log(`Entry: ${options.entry}.mnoderframe   App ID: ${options.appId}`);

  return { www, pages: [...routes], assets, options };
}
