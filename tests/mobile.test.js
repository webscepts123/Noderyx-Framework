import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMobile, capacitorConfig, mobileOptions, rewriteForBundle } from "../framework/mobile.js";
import { injectPwa, manifest, serviceWorker } from "../framework/pwa.js";
import { noderyxIcon } from "../framework/icons.js";
import { parseMNodeFrame } from "../framework/mnoderframe.js";

test("bundle rewriting points links at static pages and the API server", () => {
  const routes = new Set(["home", "about", "dashboards/admin"]);
  const html = rewriteForBundle(
    `<a href="/">Home</a><a href="/about">About</a><a href="/dashboards/admin">Admin</a>`
    + `<a href="/api/status">API</a><link href="/public/cool.css"><a href="/about#team">Team</a>`
    + `<script src="/public/untitled-live.js" defer="defer"></script>`,
    routes,
    "home",
    "https://api.example.com"
  );

  assert.match(html, /href="\/"/);
  assert.match(html, /href="\/about"/);
  assert.match(html, /href="\/dashboards\/admin"/);
  assert.match(html, /href="\/about#team"/);
  assert.match(html, /href="https:\/\/api\.example\.com\/api\/status"/);
  assert.match(html, /href="\/public\/cool\.css"/);
  assert.doesNotMatch(html, /untitled-live/);
});

test("bundle rewriting leaves server routes alone without an API url", () => {
  const html = rewriteForBundle('<a href="/api/status">API</a>', new Set(["home"]), "home", null);
  assert.match(html, /href="\/api\/status"/);
});

test("injectPwa upgrades the viewport, adds mobile tags, and stays idempotent", () => {
  const source = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>x</title></head><body></body></html>`;
  const once = injectPwa(source, { name: "Demo" });

  assert.match(once, /viewport-fit=cover/);
  assert.match(once, /rel="manifest"/);
  assert.match(once, /apple-mobile-web-app-capable/);
  assert.match(once, /noderyx-native\.js/);
  assert.equal((once.match(/name="viewport"/g) ?? []).length, 1);
  assert.equal(injectPwa(once, { name: "Demo" }), once);
});

test("injectPwa keeps an existing theme-color and skips documents without a head", () => {
  const themed = injectPwa(`<html><head><meta name="theme-color" content="#123456"></head></html>`);
  assert.equal((themed.match(/name="theme-color"/g) ?? []).length, 1);
  assert.match(themed, /content="#123456"/);
  assert.equal(injectPwa("<p>fragment</p>"), "<p>fragment</p>");
});

test("manifest advertises installable icons including a maskable one", () => {
  const result = manifest({ name: "Noderyx Demo" });
  assert.equal(result.name, "Noderyx Demo");
  assert.equal(result.display, "standalone");
  assert.ok(result.icons.some((icon) => icon.purpose === "maskable" && icon.sizes === "512x512"));
  assert.ok(result.icons.some((icon) => icon.sizes === "192x192"));
});

test("the service worker falls back to the offline page for navigations", () => {
  const source = serviceWorker({ version: "7", offlinePath: "/offline.html" });
  assert.match(source, /noderyx-7/);
  assert.match(source, /request\.mode === "navigate"/);
  assert.match(source, /caches\.delete/);
});

test("mobile options reject an application id that is not reverse domain form", () => {
  assert.throws(() => mobileOptions({ mobile: { appId: "noderyx" } }), /appId/);
  assert.equal(mobileOptions({ mobile: { appId: "com.example.app" } }).appId, "com.example.app");
});

test("capacitor config points at the built web directory and supports live reload", () => {
  const options = mobileOptions({ mobile: { appId: "com.example.app", out: "platforms/mobile" } });
  const config = capacitorConfig(options);
  assert.equal(config.webDir, "platforms/mobile/www");
  assert.equal(config.server.androidScheme, "https");
  assert.equal(config.server.url, undefined);

  const live = capacitorConfig(mobileOptions({
    mobile: { appId: "com.example.app", liveReloadUrl: "http://192.168.1.10:3000" }
  }));
  assert.equal(live.server.url, "http://192.168.1.10:3000");
  assert.equal(live.server.cleartext, true);
});

test("generated launcher icons are valid PNG files", () => {
  const png = noderyxIcon(64);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.subarray(12, 16).toString("latin1"), "IHDR");
  assert.equal(png.readUInt32BE(16), 64);
  assert.equal(png.readUInt32BE(20), 64);
  assert.ok(png.includes(Buffer.from("IEND", "latin1")));
});

test("buildMobile produces a self-contained Android and iOS web bundle", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "noderyx-mobile-"));
  const previous = process.cwd();
  process.chdir(project);
  t.after(async () => {
    process.chdir(previous);
    await rm(project, { recursive: true, force: true });
  });

  await mkdir(join(project, "views"), { recursive: true });
  await mkdir(join(project, "public"), { recursive: true });
  await writeFile(join(project, "views/home.noderframe"), `html lang="en"
  head
    meta charset="utf-8"
    title "{{siteName}}"
    link rel="stylesheet" href="/public/cool.css"
  body
    h1 "{{siteName}}"
    a href="/about" "About"
`);
  await writeFile(join(project, "views/about.noderframe"), `html lang="en"
  head
    title "About"
  body
    a href="/" "Home"
`);
  await writeFile(join(project, "public/cool.css"), ":root { color-scheme: dark; }\n");

  const result = await buildMobile(
    { mobile: { appId: "com.example.demo", appName: "Demo", data: { siteName: "Demo App" } } },
    {},
    () => {}
  );

  assert.deepEqual(result.pages.sort(), ["about", "home"]);

  const home = await readFile(join(result.www, "home.mnoderframe"), "utf8");
  assert.match(home, /^MNF1\n/);
  assert.equal(parseMNodeFrame(home).route, "home");

  const about = await readFile(join(result.www, "about.mnoderframe"), "utf8");
  assert.match(about, /^MNF1\n/);
  assert.equal(parseMNodeFrame(about).route, "about");
  await assert.rejects(() => readFile(join(result.www, "home.html")), /ENOENT/);
  await assert.rejects(() => readFile(join(result.www, "about.html")), /ENOENT/);
  await assert.rejects(() => readFile(join(result.www, "home.noderframe")), /ENOENT/);

  for (const file of [
    "manifest.webmanifest",
    "sw.js",
    "offline.mnoderframe",
    "public/cool.css",
    "public/noderyx-native.js",
    "public/noderyx-router.js",
    "public/icons/icon-512.png",
    "public/icons/icon-maskable-512.png"
  ]) {
    const contents = await readFile(join(result.www, file));
    assert.ok(contents.length > 0, `${file} should be written`);
  }
  await assert.rejects(() => readFile(join(result.www, "index.html")), /ENOENT/);
  await assert.rejects(() => readFile(join(result.www, "offline.html")), /ENOENT/);

  const capacitor = JSON.parse(await readFile(join(project, "capacitor.config.json"), "utf8"));
  assert.equal(capacitor.appId, "com.example.demo");
  assert.equal(capacitor.webDir, "mobile/www");
});

test("buildMobile reports a missing entry view instead of shipping an empty app", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "noderyx-mobile-"));
  const previous = process.cwd();
  process.chdir(project);
  t.after(async () => {
    process.chdir(previous);
    await rm(project, { recursive: true, force: true });
  });

  await mkdir(join(project, "views"), { recursive: true });
  await writeFile(join(project, "views/landing.noderframe"), `html\n  body\n    h1 "Hi"\n`);

  await assert.rejects(
    () => buildMobile({ mobile: { appId: "com.example.demo" } }, {}, () => {}),
    /Entry view not found: home/
  );
});
