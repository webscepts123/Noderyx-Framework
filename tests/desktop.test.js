import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import {
  buildDesktop,
  builderConfig,
  desktopOptions,
  desktopWorkflow,
  mainProcess,
  preloadScript
} from "../framework/desktop.js";

test("desktop options fall back to the mobile block and validate the app id", () => {
  const options = desktopOptions({
    mobile: { appId: "com.example.shop", appName: "Shop", views: "resources/views", apiUrl: "https://api.example.com/" },
    desktop: { window: { width: 1400 } }
  });
  assert.equal(options.appId, "com.example.shop");
  assert.equal(options.appName, "Shop");
  assert.equal(options.web.views, "resources/views");
  assert.equal(options.web.apiUrl, "https://api.example.com");
  assert.equal(options.web.capacitor, false);
  assert.equal(options.window.width, 1400);
  assert.equal(options.window.minWidth, 720);

  assert.equal(desktopOptions({ mobile: { appId: "com.example.shop" }, desktop: { appId: "com.example.desk" } }).appId, "com.example.desk");
  assert.throws(() => desktopOptions({ desktop: { appId: "shop" } }), /appId/);
  assert.throws(() => desktopOptions({}, { liveReloadUrl: "localhost:3000" }), /liveReloadUrl/);
});

test("electron-builder targets a Windows installer and a macOS disk image", () => {
  const config = builderConfig(desktopOptions({ mobile: { appId: "com.example.app", appName: "Example" } }));
  assert.equal(config.appId, "com.example.app");
  assert.equal(config.productName, "Example");
  assert.deepEqual(config.win.target, ["nsis"]);
  assert.ok(config.mac.target.includes("dmg"));
  assert.deepEqual(config.files, ["main.cjs", "preload.cjs", "www/**/*", "package.json"]);
});

/** Run the generated main process against a stub Electron and return its protocol handler. */
async function loadMainProcess(source, root) {
  const calls = { schemes: [], windows: [] };
  let handler;
  const electron = {
    app: {
      isPackaged: true,
      setAppUserModelId() {},
      requestSingleInstanceLock: () => true,
      quit() {},
      on() {},
      getPath: () => root,
      whenReady: () => Promise.resolve()
    },
    BrowserWindow: class {
      static getAllWindows() { return []; }
      constructor(options) {
        calls.windows.push(options);
        this.webContents = { setWindowOpenHandler() {}, on() {} };
      }
      once() {}
      on() {}
      loadURL(url) { calls.loaded = url; }
    },
    Menu: { buildFromTemplate: (template) => template, setApplicationMenu() {} },
    net: { fetch: async (url) => ({ fetched: url }) },
    protocol: {
      registerSchemesAsPrivileged: (schemes) => calls.schemes.push(...schemes),
      handle: (_scheme, fn) => { handler = fn; }
    },
    screen: { getAllDisplays: () => [] },
    session: { defaultSession: { setPermissionRequestHandler: (fn) => { calls.permissions = fn; } } },
    shell: { openExternal() {} }
  };
  const nodeRequire = (await import("node:module")).createRequire(import.meta.url);
  const require = (name) => (name === "electron" ? electron : nodeRequire(name));
  vm.runInNewContext(source, { require, __dirname: root, process, URL, Response, console });
  await new Promise((done) => setImmediate(done));
  return { handler, calls };
}

test("the generated main process serves the bundle and nothing outside it", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "noderyx-desktop-main-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "www/public"), { recursive: true });
  await writeFile(join(root, "www/index.html"), "<!doctype html>");
  await writeFile(join(root, "www/about.mnoderframe"), "MNF1\n");
  await writeFile(join(root, "www/sw.js"), "");
  await writeFile(join(root, "secret.txt"), "no");

  const options = desktopOptions({ mobile: { appId: "com.example.app", appName: "Example" } });
  const { handler, calls } = await loadMainProcess(mainProcess(options), root);

  assert.equal(calls.schemes[0].scheme, "noderyx");
  assert.equal(calls.schemes[0].privileges.secure, true);
  assert.equal(calls.loaded, "noderyx://app/");
  const { webPreferences } = calls.windows[0];
  assert.equal(webPreferences.contextIsolation, true);
  assert.equal(webPreferences.sandbox, true);
  assert.equal(webPreferences.nodeIntegration, false);
  assert.equal(webPreferences.devTools, false); // packaged

  const serve = (path) => handler({ url: `noderyx://app${path}` });
  assert.match((await serve("/about.mnoderframe")).fetched, /www\/about\.mnoderframe$/);
  assert.match((await serve("/")).fetched, /www\/index\.html$/);
  assert.match((await serve("/settings/account")).fetched, /www\/index\.html$/);
  assert.equal((await serve("/missing.css")).status, 404);
  assert.equal((await serve("/sw.js")).status, 404);
  assert.equal((await serve("/..%2fsecret.txt")).status, 404);
  assert.equal((await serve("/%2e%2e/secret.txt")).status, 404);

  let granted;
  calls.permissions(null, "notifications", (value) => { granted = value; });
  assert.equal(granted, true);
  calls.permissions(null, "media", (value) => { granted = value; });
  assert.equal(granted, false);
});

test("the preload exposes plain values only", () => {
  const source = preloadScript(desktopOptions({ mobile: { appId: "com.example.app", appName: "Example" } }), "2.1.0");
  assert.match(source, /exposeInMainWorld\("NoderyxDesktop"/);
  assert.match(source, /version: "2\.1\.0"/);
  assert.doesNotMatch(source, /ipcRenderer|require\("node:/);
});

test("the workflow packages Windows and macOS on their own runners", () => {
  const yaml = desktopWorkflow(desktopOptions({ mobile: { appId: "com.example.app", appName: "My Shop" } }));
  assert.match(yaml, /windows-latest/);
  assert.match(yaml, /macos-latest/);
  assert.match(yaml, /desktop:package \$\{\{ matrix\.target \}\}/);
  assert.match(yaml, /name: my-shop-\$\{\{ matrix\.target \}\}/);
  assert.match(yaml, /platforms\/desktop\/dist\/\*\.dmg/);
});

test("buildDesktop writes an Electron project around the bundle", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "noderyx-desktop-"));
  const previous = process.cwd();
  process.chdir(project);
  t.after(async () => {
    process.chdir(previous);
    await rm(project, { recursive: true, force: true });
  });

  await mkdir(join(project, "views"), { recursive: true });
  await mkdir(join(project, "platforms/desktop"), { recursive: true });
  await writeFile(join(project, "package.json"), JSON.stringify({ version: "3.4.5" }));
  await writeFile(join(project, "views/home.noderframe"), `html lang="en"\n  head\n    title "Home"\n  body\n    h1 "Hi"\n`);
  // Dependencies the project installed must survive a rebuild.
  await writeFile(join(project, "platforms/desktop/package.json"), JSON.stringify({
    devDependencies: { electron: "^1.0.0" },
    scripts: { custom: "echo" }
  }));

  const result = await buildDesktop({ mobile: { appId: "com.example.demo", appName: "Demo App" } }, {}, () => {});
  assert.equal(result.version, "3.4.5");
  assert.deepEqual(result.pages, ["home"]);

  const desktop = join(project, "platforms/desktop");
  const manifest = JSON.parse(await readFile(join(desktop, "package.json"), "utf8"));
  assert.equal(manifest.name, "demo-app");
  assert.equal(manifest.productName, "Demo App");
  assert.equal(manifest.main, "main.cjs");
  assert.equal(manifest.version, "3.4.5");
  assert.equal(manifest.devDependencies.electron, "^1.0.0");
  assert.equal(manifest.scripts.custom, "echo");
  assert.equal(manifest.build.appId, "com.example.demo");

  for (const file of ["main.cjs", "preload.cjs", "build/icon.png", "www/index.html", "www/home.mnoderframe", "www/public/noderyx-router.js"]) {
    assert.ok((await readFile(join(desktop, file))).length > 0, `${file} should be written`);
  }
  // A desktop build must leave the mobile project's Capacitor config alone.
  await assert.rejects(() => readFile(join(project, "capacitor.config.json")), /ENOENT/);
});
