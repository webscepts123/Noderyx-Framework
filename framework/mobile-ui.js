import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { HttpError } from "./errors.js";
import { compileMobilePages, mobileAppConfig, mobileApps, mobileOptions } from "./mobile.js";
import { STUDIO_CSS, STUDIO_FRAME, STUDIO_JS, studioPage } from "./mobile-studio.js";

/**
 * Server-driven mobile UI.
 *
 * The web server compiles each app's screens and serves them, with the theme,
 * text, and feature flags edited in Mobile Studio, at /api/mobile/<app>/ui.
 * Installed apps fetch it at launch and on resume, so a change made in the web
 * app reaches every phone without a store release.
 */

const COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/]+\))$/i;
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const LIMITS = { keys: 200, text: 5000 };

// Theme token → Cool.css custom properties.
export const THEME_TOKENS = {
  primary: ["--cool-primary", "--noderyx-violet"],
  accent: ["--cool-accent", "--runtime-cyan"],
  background: ["--cool-bg", "--kernel-night"],
  surface: ["--cool-surface", "--cool-surface-solid"],
  text: ["--cool-text"],
  muted: ["--cool-muted"],
  border: ["--cool-border"]
};

// Theme token → React Native style keys and properties for build:native apps.
const NATIVE_TOKENS = {
  primary: [["coolBtn", "backgroundColor"], ["linkText", "color"]],
  accent: [["coolEyebrow", "color"], ["code", "color"], ["coolGradientText", "color"]],
  background: [["screen", "backgroundColor"]],
  surface: [["coolCard", "backgroundColor"], ["input", "backgroundColor"], ["coolIconBtn", "backgroundColor"]],
  text: [["text", "color"], ["h1", "color"], ["h2", "color"], ["h3", "color"], ["span", "color"], ["strong", "color"], ["buttonText", "color"], ["input", "color"]],
  muted: [["coolMuted", "color"], ["label", "color"], ["coolCaption", "color"], ["placeholder", "color"]],
  border: [["coolCard", "borderColor"], ["input", "borderColor"]]
};

export const EMPTY_SETTINGS = Object.freeze({ theme: {}, data: {}, flags: {}, updatedAt: null });

/** Check settings sent from Mobile Studio (or any client) and keep only what is valid. */
export function validateSettings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(422, "Settings must be an object");
  }
  const errors = [];
  const theme = {};
  for (const [name, value] of Object.entries(input.theme ?? {})) {
    if (value === "" || value == null) continue;
    if (THEME_TOKENS[name]) {
      if (typeof value === "string" && COLOR.test(value.trim())) theme[name] = value.trim();
      else errors.push(`theme.${name} must be a color such as #7c5cff`);
    } else if (name === "radius") {
      const radius = Number(value);
      if (Number.isFinite(radius) && radius >= 0 && radius <= 64) theme.radius = radius;
      else errors.push("theme.radius must be a number from 0 to 64");
    } else if (name === "mode") {
      if (value === "dark" || value === "light") theme.mode = value;
      else errors.push("theme.mode must be dark or light");
    } else errors.push(`Unknown theme token: ${name}`);
  }

  const data = {};
  const entries = Object.entries(input.data ?? {});
  if (entries.length > LIMITS.keys) errors.push(`data may hold at most ${LIMITS.keys} keys`);
  for (const [name, value] of entries.slice(0, LIMITS.keys)) {
    if (!KEY.test(name)) errors.push(`data key "${name}" must be a simple identifier`);
    else if (["string", "number", "boolean"].includes(typeof value) && String(value).length <= LIMITS.text) data[name] = value;
    else errors.push(`data.${name} must be text, a number, or true/false (up to ${LIMITS.text} characters)`);
  }

  const flags = {};
  for (const [name, value] of Object.entries(input.flags ?? {}).slice(0, LIMITS.keys)) {
    if (!KEY.test(name)) errors.push(`flag "${name}" must be a simple identifier`);
    else flags[name] = value === true || value === "true";
  }

  if (errors.length) {
    const error = new HttpError(422, errors[0]);
    error.details = errors;
    throw error;
  }
  return { theme, data, flags };
}

/** CSS that applies theme tokens on top of Cool.css, in either colour mode. */
export function themeCss(theme = {}) {
  const declarations = [];
  for (const [token, properties] of Object.entries(THEME_TOKENS)) {
    if (!theme[token]) continue;
    for (const property of properties) declarations.push(`${property}:${theme[token]}`);
  }
  if (theme.radius !== undefined) declarations.push(`--cool-radius:${Number(theme.radius)}px`);
  if (!declarations.length) return "";
  // :root:root[data-theme] outranks Cool.css's own :root[data-theme="light"].
  return `:root,:root:root[data-theme]{${declarations.join(";")}}`;
}

/** The same tokens as React Native style overrides. */
export function nativeThemeStyles(theme = {}) {
  const styles = {};
  for (const [token, targets] of Object.entries(NATIVE_TOKENS)) {
    if (!theme[token]) continue;
    for (const [key, property] of targets) {
      styles[key] = { ...(styles[key] ?? {}), [property]: theme[token] };
    }
  }
  if (theme.radius !== undefined) {
    styles.coolCard = { ...(styles.coolCard ?? {}), borderRadius: Number(theme.radius) };
  }
  return styles;
}

/**
 * Per-app settings saved as JSON files. Pass your own `{ get, set }` to keep
 * them in a database instead.
 */
export function fileSettingsStore(directory = "storage/mobile-ui") {
  const root = resolve(directory);
  const file = (app) => join(root, `${app}.json`);
  return {
    async get(app) {
      if (!existsSync(file(app))) return { ...EMPTY_SETTINGS };
      try {
        return { ...EMPTY_SETTINGS, ...JSON.parse(await readFile(file(app), "utf8")) };
      } catch {
        return { ...EMPTY_SETTINGS };
      }
    },
    async set(app, settings) {
      await mkdir(root, { recursive: true });
      const temporary = `${file(app)}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`);
      await rename(temporary, file(app));
    }
  };
}

/** Authorize Mobile Studio with a shared secret sent as `Authorization: Bearer`. */
export function bearerToken(secret) {
  const expected = Buffer.from(String(secret ?? ""));
  if (expected.length < 16) throw new Error("The Mobile Studio token must be at least 16 characters");
  return ({ request }) => {
    const header = String(request.headers.authorization ?? "");
    const supplied = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  };
}

/** The apps a project serves. A single-app project serves one called "default". */
export function mobileUiApps(config = {}) {
  const names = mobileApps(config);
  return names.length ? names : ["default"];
}

function appOptions(config, name) {
  return mobileOptions(name === "default" ? config : mobileAppConfig(config, name));
}

/** Build the payload an installed app downloads. `version` changes whenever the UI does. */
export async function mobileUiManifest(config, name, { settings = EMPTY_SETTINGS, target = "web" } = {}) {
  const options = appOptions(config, name);
  const theme = settings.theme ?? {};
  const body = {
    app: name,
    appName: options.appName,
    target,
    theme,
    flags: settings.flags ?? {},
    data: settings.data ?? {},
    updatedAt: settings.updatedAt ?? null
  };

  if (target === "native") {
    body.nativeStyles = nativeThemeStyles(theme);
  } else {
    // Flags are available to views as {{flags.name}} next to the edited text.
    const { routes, pages } = await compileMobilePages(options, {
      data: { ...body.data, flags: body.flags }
    });
    body.entry = options.entry;
    body.routes = [...routes];
    body.css = themeCss(theme);
    body.pages = Object.fromEntries(pages);
  }

  const version = createHash("sha1").update(JSON.stringify(body)).digest("base64url").slice(0, 16);
  return { version, ...body };
}

/**
 * Serve remote UI for every configured app, plus Mobile Studio.
 *
 *   registerMobileUi(app, config, { authorize: bearerToken(process.env.MOBILE_STUDIO_TOKEN) })
 *
 * Reading the UI is public (installed apps have no session). Changing it calls
 * `authorize(context)`; without one, Mobile Studio is read-only.
 */
export function registerMobileUi(app, config = {}, options = {}) {
  const {
    authorize = null,
    store = fileSettingsStore(options.directory),
    studio = "/mobile-studio",
    cache = config.app?.environment === "production"
  } = options;
  const compiled = new Map();
  const apps = () => mobileUiApps(config);

  const known = (name) => {
    if (!apps().includes(name)) throw new HttpError(404, `Unknown mobile app: ${name}`);
    return name;
  };

  const build = async (name, target) => {
    const key = `${name}:${target}`;
    if (cache && compiled.has(key)) return compiled.get(key);
    let manifest;
    try {
      manifest = await mobileUiManifest(config, name, { settings: await store.get(name), target });
    } catch (error) {
      if (/^(Views directory not found|No \.noderframe views|Entry view not found)/.test(error.message)) {
        throw new HttpError(404, `The ${name} app has no screens to serve: ${error.message}`);
      }
      throw error;
    }
    if (cache) compiled.set(key, manifest);
    return manifest;
  };

  const guard = async (context) => {
    if (!authorize) throw new HttpError(403, "Mobile Studio is read-only. Pass authorize to registerMobileUi to allow changes.");
    if (!(await authorize(context))) throw new HttpError(401, "Not authorized to change the mobile UI");
  };

  app.get("/api/mobile/apps", ({ json }) => json({
    apps: apps().map((name) => {
      const resolved = appOptions(config, name);
      return { name, appName: resolved.appName, appId: resolved.appId, entry: resolved.entry };
    }),
    editable: Boolean(authorize)
  }));

  app.get("/api/mobile/:app/ui", async ({ params, query, response, json, text }) => {
    const name = known(params.app);
    const manifest = await build(name, query.target === "native" ? "native" : "web");
    // Public, credential-free data that packaged apps read from their own origin.
    response.baseHeaders["access-control-allow-origin"] = "*";
    if (query.since && query.since === manifest.version) return text("", 204);
    return json(manifest);
  });

  app.get("/api/mobile/:app/settings", async (context) => {
    await guard(context);
    return context.json(await store.get(known(context.params.app)));
  });

  app.put("/api/mobile/:app/settings", async (context) => {
    await guard(context);
    const name = known(context.params.app);
    const settings = { ...validateSettings(context.body), updatedAt: new Date().toISOString() };
    await store.set(name, settings);
    for (const key of compiled.keys()) if (key.startsWith(`${name}:`)) compiled.delete(key);
    await context.audit?.("mobile.ui.updated", { app: name });
    const manifest = await build(name, "web");
    return context.json({ saved: true, app: name, version: manifest.version, settings });
  });

  // Compile unpublished settings so Mobile Studio can preview text and flags
  // before they reach any device. Nothing is stored.
  app.post("/api/mobile/:app/preview", async (context) => {
    await guard(context);
    const name = known(context.params.app);
    const settings = { ...validateSettings(context.body), updatedAt: null };
    const { entry, routes, pages } = await mobileUiManifest(config, name, { settings });
    return context.json({ entry, routes, pages });
  });

  if (studio) {
    app.get(studio, ({ text, csrfToken }) => text(
      studioPage({ base: studio, csrfToken, appName: config.app?.name ?? "Noderyx" }),
      200,
      "text/html; charset=utf-8"
    ));
    app.get(`${studio}/frame`, ({ text }) => text(STUDIO_FRAME, 200, "text/html; charset=utf-8"));
    app.get(`${studio}/studio.js`, ({ text }) => text(STUDIO_JS, 200, "text/javascript; charset=utf-8"));
    app.get(`${studio}/studio.css`, ({ text }) => text(STUDIO_CSS, 200, "text/css; charset=utf-8"));
  }

  return app;
}
