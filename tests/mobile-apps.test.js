import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noderyx } from "../framework/app.js";
import { buildMobile, capacitorConfig, mobileAppConfig, mobileApps, mobileOptions, platformDirectory } from "../framework/mobile.js";
import { buildNative } from "../framework/native.js";
import {
  bearerToken,
  fileSettingsStore,
  mobileUiManifest,
  nativeThemeStyles,
  registerMobileUi,
  themeCss,
  validateSettings
} from "../framework/mobile-ui.js";
import { CSRF_COOKIE, parseCookies } from "../framework/security.js";

const KEY = "test-application-key-that-is-long-enough";
const TOKEN = "studio-token-for-tests-123";

const SCREEN = (title) => `html lang="en" data-theme="dark"
  head
    meta charset="utf-8"
    title "${title}"
    link rel="stylesheet" href="/public/cool.css"
  body.cool-mobile-body
    main.cool-mobile-content
      h1 "{{headline}}"
      p.cool-muted "${title}"
      a href="/settings" "Settings"
`;

const CONFIG = {
  app: { name: "Acme", environment: "test" },
  mobile: {
    appId: "com.acme",
    appName: "Acme",
    apiUrl: "https://api.acme.test/",
    data: { headline: "Welcome" },
    apps: {
      customer: { appId: "com.acme.customer", appName: "Acme" },
      admin: { appId: "com.acme.admin", appName: "Acme Admin", data: { headline: "Dashboard" } },
      partner: {}
    }
  },
  native: { scroll: true }
};

async function inProject(t) {
  const project = await mkdtemp(join(tmpdir(), "noderyx-apps-"));
  const previous = process.cwd();
  process.chdir(project);
  t.after(async () => {
    process.chdir(previous);
    await rm(project, { recursive: true, force: true });
  });
  for (const app of ["customer", "admin", "partner"]) {
    await mkdir(join(project, `resources/mobile/${app}`), { recursive: true });
    await writeFile(join(project, `resources/mobile/${app}/home.noderframe`), SCREEN(`${app} home`));
    await writeFile(join(project, `resources/mobile/${app}/settings.noderframe`), SCREEN(`${app} settings`));
  }
  await mkdir(join(project, "public"), { recursive: true });
  await writeFile(join(project, "public/cool.css"), ":root { color-scheme: dark; }\n");
  return project;
}

test("each app resolves to its own id, views, output, and platform folders", () => {
  assert.deepEqual(mobileApps(CONFIG), ["customer", "admin", "partner"]);

  const admin = mobileOptions(mobileAppConfig(CONFIG, "admin"));
  assert.equal(admin.app, "admin");
  assert.equal(admin.appId, "com.acme.admin");
  assert.equal(admin.views, "resources/mobile/admin");
  assert.equal(admin.out, "platforms/mobile/admin");
  assert.equal(admin.apiUrl, "https://api.acme.test");
  assert.deepEqual(admin.data, { headline: "Dashboard" });
  assert.equal(platformDirectory(admin, "android").replaceAll("\\", "/"), "platforms/mobile/admin/android");

  // Unset fields derive from the shared block.
  const partner = mobileOptions(mobileAppConfig(CONFIG, "partner"));
  assert.equal(partner.appId, "com.acme.partner");
  assert.equal(partner.appName, "Acme Partner");
  assert.deepEqual(partner.data, { headline: "Welcome" });

  const native = mobileAppConfig(CONFIG, "admin").native;
  assert.equal(native.out, "platforms/native/admin");
  assert.equal(native.views, "resources/mobile/admin");
  assert.equal(native.appId, "com.acme.admin");
  assert.equal(native.scroll, true);

  assert.throws(() => mobileAppConfig(CONFIG, "vendor"), /Unknown mobile app: vendor \(configured: customer, admin, partner\)/);
  assert.throws(() => mobileAppConfig(CONFIG, "../x"), /Invalid mobile app name/);
  // A single-app project is untouched.
  assert.equal(mobileAppConfig({ mobile: { appId: "com.x.y" } }, null).mobile.appId, "com.x.y");
  assert.equal(platformDirectory(mobileOptions({ mobile: { appId: "com.x.y" } }), "ios"), "ios");
});

test("capacitor keeps each app's android and ios projects apart", () => {
  const config = capacitorConfig(mobileOptions(mobileAppConfig(CONFIG, "customer")));
  assert.equal(config.appId, "com.acme.customer");
  assert.equal(config.webDir, "platforms/mobile/customer/www");
  assert.equal(config.android.path, "platforms/mobile/customer/android");
  assert.equal(config.ios.path, "platforms/mobile/customer/ios");

  const single = capacitorConfig(mobileOptions({ mobile: { appId: "com.x.y" } }));
  assert.equal(single.android.path, undefined);
});

test("apps build side by side with their own screens and boot settings", async (t) => {
  const project = await inProject(t);
  for (const app of ["customer", "admin"]) {
    await buildMobile(mobileAppConfig(CONFIG, app), {}, () => {});
  }

  const adminHome = await readFile(join(project, "platforms/mobile/admin/www/home.mnoderframe"), "utf8");
  assert.match(adminHome, /Dashboard/);
  assert.match(adminHome, /admin home/);
  const customerHome = await readFile(join(project, "platforms/mobile/customer/www/home.mnoderframe"), "utf8");
  assert.match(customerHome, /Welcome/);

  const boot = await readFile(join(project, "platforms/mobile/admin/www/public/noderyx-boot.js"), "utf8");
  assert.match(boot, /NODERYX_APP = "admin"/);
  assert.match(boot, /NODERYX_REMOTE_UI = true/);
  assert.match(boot, /NODERYX_API_BASE = "https:\/\/api\.acme\.test"/);

  // The last build points Capacitor at its own app.
  const capacitor = JSON.parse(await readFile(join(project, "capacitor.config.json"), "utf8"));
  assert.equal(capacitor.appId, "com.acme.admin");
});

test("native builds per app fetch their published theme", async (t) => {
  const project = await inProject(t);
  const result = await buildNative(mobileAppConfig(CONFIG, "partner"), {}, () => {});
  assert.equal(result.out, join(project, "platforms/native/partner"));

  const app = await readFile(join(result.out, "App.jsx"), "utf8");
  assert.match(app, /export const APP = "partner"/);
  assert.match(app, /const REMOTE_UI = true/);
  assert.match(app, /\/api\/mobile\/\$\{encodeURIComponent\(APP\)\}\/ui\?target=native/);
  assert.match(app, /AppState\.addEventListener/);

  const styles = await readFile(join(result.out, "styles.js"), "utf8");
  assert.match(styles, /export function applyTheme/);
  assert.match(styles, /const PARTS = \{/);
});

test("settings are validated before they reach devices", () => {
  const clean = validateSettings({
    theme: { primary: "#ff3366", surface: "rgb(10, 20, 30)", radius: "12", mode: "light", text: "" },
    data: { headline: "Hello", count: 3 },
    flags: { promo: true, beta: "false" }
  });
  assert.deepEqual(clean, {
    theme: { primary: "#ff3366", surface: "rgb(10, 20, 30)", radius: 12, mode: "light" },
    data: { headline: "Hello", count: 3 },
    flags: { promo: true, beta: false }
  });

  assert.throws(() => validateSettings({ theme: { primary: "red;}body{display:none" } }), /theme.primary must be a color/);
  assert.throws(() => validateSettings({ theme: { shadow: "#000" } }), /Unknown theme token/);
  assert.throws(() => validateSettings({ data: { "bad key": "x" } }), /simple identifier/);
  assert.throws(() => validateSettings({ data: { nested: { a: 1 } } }), /must be text/);
  assert.throws(() => validateSettings([]), /must be an object/);
});

test("theme tokens become Cool.css variables and native styles", () => {
  const css = themeCss({ primary: "#ff3366", background: "#000000", radius: 8 });
  assert.match(css, /^:root,:root:root\[data-theme\]\{/);
  assert.match(css, /--cool-primary:#ff3366/);
  assert.match(css, /--cool-bg:#000000/);
  assert.match(css, /--cool-radius:8px/);
  assert.equal(themeCss({}), "");

  const styles = nativeThemeStyles({ primary: "#ff3366", surface: "#111111", radius: 6 });
  assert.equal(styles.coolBtn.backgroundColor, "#ff3366");
  assert.equal(styles.coolCard.backgroundColor, "#111111");
  assert.equal(styles.coolCard.borderRadius, 6);
});

test("the manifest carries pages compiled with published text and a stable version", async (t) => {
  await inProject(t);
  const settings = { theme: { primary: "#ff3366" }, data: { headline: "Spring sale" }, flags: { promo: true } };
  const first = await mobileUiManifest(CONFIG, "customer", { settings });
  const again = await mobileUiManifest(CONFIG, "customer", { settings });

  assert.equal(first.version, again.version);
  assert.deepEqual(first.routes.sort(), ["home", "settings"]);
  assert.match(first.pages.home, /^MNF1\n/);
  assert.match(first.pages.home, /Spring sale/);
  assert.match(first.css, /--cool-primary:#ff3366/);
  assert.deepEqual(first.flags, { promo: true });

  const changed = await mobileUiManifest(CONFIG, "customer", { settings: { ...settings, data: { headline: "Summer" } } });
  assert.notEqual(changed.version, first.version);

  const native = await mobileUiManifest(CONFIG, "customer", { settings, target: "native" });
  assert.equal(native.pages, undefined);
  assert.equal(native.nativeStyles.coolBtn.backgroundColor, "#ff3366");
});

test("bearer tokens must be long and compare exactly", () => {
  assert.throws(() => bearerToken("short"), /at least 16/);
  const authorize = bearerToken(TOKEN);
  assert.equal(authorize({ request: { headers: { authorization: `Bearer ${TOKEN}` } } }), true);
  assert.equal(authorize({ request: { headers: { authorization: `Bearer ${TOKEN}x` } } }), false);
  assert.equal(authorize({ request: { headers: {} } }), false);
});

async function withServer(t, options, run) {
  const project = await inProject(t);
  const previousKey = process.env.APP_KEY;
  process.env.APP_KEY = KEY;
  const app = noderyx({ views: "resources/views", public: "public" });
  registerMobileUi(app, CONFIG, { store: fileSettingsStore(join(project, "storage/mobile-ui")), ...options });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((ready) => server.once("listening", ready));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(base, project);
  } finally {
    server.close();
    if (previousKey === undefined) delete process.env.APP_KEY;
    else process.env.APP_KEY = previousKey;
  }
}

async function session(base) {
  const first = await fetch(`${base}/mobile-studio`);
  assert.equal(first.status, 200);
  const html = await first.text();
  const jar = first.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
  const token = parseCookies(jar)[CSRF_COOKIE];
  assert.ok(html.includes(`content="${token}"`), "the studio page carries the CSRF token");
  return { jar, token };
}

test("installed apps read their UI publicly and skip unchanged versions", async (t) => {
  await withServer(t, {}, async (base) => {
    const listing = await (await fetch(`${base}/api/mobile/apps`, { headers: { accept: "application/json" } })).json();
    assert.deepEqual(listing.apps.map((app) => app.name), ["customer", "admin", "partner"]);
    assert.equal(listing.editable, false);

    const response = await fetch(`${base}/api/mobile/admin/ui`, { headers: { accept: "application/json", origin: "https://localhost" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    const ui = await response.json();
    assert.equal(ui.app, "admin");
    assert.match(ui.pages.home, /Dashboard/);

    const unchanged = await fetch(`${base}/api/mobile/admin/ui?since=${ui.version}`);
    assert.equal(unchanged.status, 204);

    const missing = await fetch(`${base}/api/mobile/vendor/ui`, { headers: { accept: "application/json" } });
    assert.equal(missing.status, 404);
  });
});

test("Mobile Studio is read-only without an authorize hook", async (t) => {
  await withServer(t, {}, async (base) => {
    const { jar, token } = await session(base);
    const response = await fetch(`${base}/api/mobile/admin/settings`, {
      method: "PUT",
      headers: { accept: "application/json", "content-type": "application/json", cookie: jar, "x-csrf-token": token },
      body: JSON.stringify({ theme: { primary: "#ff0000" } })
    });
    assert.equal(response.status, 403);
  });
});

test("an authorized change in Mobile Studio reaches the app's next fetch", async (t) => {
  await withServer(t, { authorize: bearerToken(TOKEN) }, async (base, project) => {
    const before = await (await fetch(`${base}/api/mobile/customer/ui`, { headers: { accept: "application/json" } })).json();
    const { jar, token } = await session(base);
    const put = (authorization, body) => fetch(`${base}/api/mobile/customer/settings`, {
      method: "PUT",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        cookie: jar,
        "x-csrf-token": token,
        ...(authorization ? { authorization } : {})
      },
      body: JSON.stringify(body)
    });

    assert.equal((await put(null, { theme: { primary: "#ff0000" } })).status, 401);
    assert.equal((await put(`Bearer ${TOKEN}`, { theme: { primary: "nope" } })).status, 422);

    const saved = await put(`Bearer ${TOKEN}`, {
      theme: { primary: "#ff0000" },
      data: { headline: "Flash sale" },
      flags: { promo: true }
    });
    assert.equal(saved.status, 200);
    const result = await saved.json();
    assert.notEqual(result.version, before.version);

    const stored = JSON.parse(await readFile(join(project, "storage/mobile-ui/customer.json"), "utf8"));
    assert.equal(stored.theme.primary, "#ff0000");

    const after = await (await fetch(`${base}/api/mobile/customer/ui?since=${before.version}`, { headers: { accept: "application/json" } })).json();
    assert.equal(after.version, result.version);
    assert.match(after.pages.home, /Flash sale/);
    assert.match(after.css, /--cool-primary:#ff0000/);

    // Other apps are unaffected.
    const admin = await (await fetch(`${base}/api/mobile/admin/ui`, { headers: { accept: "application/json" } })).json();
    assert.match(admin.pages.home, /Dashboard/);
    assert.equal(admin.css, "");
  });
});

test("the studio ships its script and styles as same-origin files", async (t) => {
  await withServer(t, {}, async (base) => {
    const page = await (await fetch(`${base}/mobile-studio`)).text();
    assert.match(page, /src="\/mobile-studio\/studio\.js"/);
    assert.doesNotMatch(page, /<script>|style="|onclick=/);
    const script = await fetch(`${base}/mobile-studio/studio.js`);
    assert.match(script.headers.get("content-type"), /javascript/);
    new Function(await script.text()); // parses
    const css = await fetch(`${base}/mobile-studio/studio.css`);
    assert.match(css.headers.get("content-type"), /text\/css/);
  });
});
