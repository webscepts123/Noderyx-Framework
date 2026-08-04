#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compile } from "./compiler.js";
import {
  buildCpanel,
  CPANEL_MODES,
  deployPhp,
  doctorPhp,
  installerPhp,
  passengerHtaccess,
  proxyHtaccess,
  staticHtaccess
} from "./cpanel.js";
import { connect } from "./database.js";
import { migrate, migrationStatus, rollback } from "./migrations.js";
import { buildMobile, webDirectory } from "./mobile.js";
import { buildNative, initNativeProject } from "./native.js";
import { solutionProfile, solutionProfiles } from "./profiles.js";
import { formatQaReport, inspectProject } from "./qa.js";
import { generateKey, hashPassword } from "./security.js";
import { runMNodeFrame } from "./mnoderframe-runner.js";
import { runSeeders } from "./seeders.js";

const [, , command = "help", ...args] = process.argv;

function option(name, fallback) {
  const equals = args.find((argument) => argument.startsWith(`--${name}=`));
  if (equals) return equals.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")
    ? args[index + 1]
    : fallback;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function positional() {
  return args.filter((argument, index) => {
    if (argument.startsWith("--")) return false;
    return index === 0 || !args[index - 1]?.startsWith("--");
  });
}

async function loadEnvironment() {
  const envFile = resolve(".env");
  if (existsSync(envFile) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envFile);
  }
}

async function loadConfig() {
  await loadEnvironment();
  const preferredConfig = existsSync(resolve("noderyx.config.js"))
    ? "noderyx.config.js"
    : "untitled.config.js";
  const configFile = resolve(option("config", preferredConfig));
  if (!existsSync(configFile)) {
    throw new Error(`Configuration file not found: ${configFile}`);
  }
  return (await import(`${pathToFileURL(configFile).href}?t=${Date.now()}`)).default;
}

async function loadOptionalConfig() {
  await loadEnvironment();
  for (const candidate of ["noderyx.config.js", "untitled.config.js"]) {
    if (!existsSync(resolve(candidate))) continue;
    return (await import(`${pathToFileURL(resolve(candidate)).href}?t=${Date.now()}`)).default ?? {};
  }
  return {};
}

async function frameworkUpdate() {
  const manifestPath = resolve("package.json");
  const lockPath = resolve("package-lock.json");
  if (!existsSync(manifestPath)) throw new Error("Run this command from a Node.js project directory");

  const manifest = JSON.parse((await readFile(manifestPath, "utf8")).replace(/^\uFEFF/, ""));
  const dependencySections = ["dependencies", "devDependencies", "optionalDependencies"];
  const section = dependencySections.find((name) => manifest[name]?.["noderyx-framework"]);
  if (!section) {
    throw new Error("This project does not declare noderyx-framework in package.json");
  }

  const currentRange = manifest[section]["noderyx-framework"];
  const [requestedVersion] = positional();
  const target = requestedVersion
    ?? (/^(file:|link:)/.test(currentRange) ? currentRange : "latest");
  const runTests = !hasFlag("no-test") && Boolean(manifest.scripts?.test);

  console.log(`Noderyx update: ${currentRange} -> ${target}`);
  console.log("Application source will not be modified.");
  if (hasFlag("dry-run")) {
    console.log(`Would install noderyx-framework@${target} in ${section}.`);
    console.log(runTests ? "Would run tests before and after the update." : "No test script found; would run an import check.");
    return;
  }

  if (runTests) {
    console.log("Running pre-update tests...");
    await run("npm", ["test"]);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = resolve(".noderyx", "update-backups", stamp);
  const hadLock = existsSync(lockPath);
  await mkdir(backup, { recursive: true });
  await copyFile(manifestPath, join(backup, "package.json"));
  if (hadLock) await copyFile(lockPath, join(backup, "package-lock.json"));

  try {
    console.log("Installing the framework update...");
    await run("npm", ["install", `noderyx-framework@${target}`, "--save-exact"]);
    await run(process.execPath, [
      "--input-type=module",
      "-e",
      "import('noderyx-framework').then(m=>{if(typeof m.noderyx!=='function')process.exit(1)})"
    ]);

    if (runTests) {
      console.log("Running post-update tests...");
      await run("npm", ["test"]);
    }

    const updated = JSON.parse((await readFile(manifestPath, "utf8")).replace(/^\uFEFF/, ""));
    console.log(`Updated safely to ${updated[section]?.["noderyx-framework"] ?? target}.`);
    console.log(`Recovery backup: ${backup}`);
  } catch (error) {
    console.error(`Update verification failed: ${error.message}`);
    console.log("Restoring the previous dependency files...");
    await copyFile(join(backup, "package.json"), manifestPath);
    if (hadLock) await copyFile(join(backup, "package-lock.json"), lockPath);
    else await rm(lockPath, { force: true });

    try {
      await run("npm", ["install", "--ignore-scripts"]);
    } catch (restoreError) {
      throw new Error(`Update failed and dependency reinstall also failed. Backup: ${backup}. ${restoreError.message}`);
    }
    throw new Error(`Update failed; the previous framework was restored. Backup: ${backup}`);
  }
}

function run(executable, executableArgs, options = {}) {
  const binary = process.platform === "win32" && /^(npm|npx)$/.test(executable)
    ? `${executable}.cmd`
    : executable;

  return new Promise((done, fail) => {
    const child = spawn(binary, executableArgs, { stdio: "inherit", shell: process.platform === "win32", ...options });
    child.on("error", (error) => fail(new Error(`${executable} could not start: ${error.message}`)));
    child.on("exit", (code) => {
      if (code === 0) return done(0);
      fail(new Error(`${executable} ${executableArgs.join(" ")} exited with code ${code}`));
    });
  });
}

const NATIVE_PLATFORMS = new Set(["android", "ios"]);

function requestedPlatforms(fallback = ["android", "ios"]) {
  const requested = positional().filter((value) => NATIVE_PLATFORMS.has(value.toLowerCase()));
  if (!requested.length) return fallback;
  return [...new Set(requested.map((value) => value.toLowerCase()))];
}

const CAPACITOR_PACKAGES = [
  "@capacitor/core",
  "@capacitor/cli",
  "@capacitor/android",
  "@capacitor/ios",
  "@capacitor/app",
  "@capacitor/preferences",
  "@capacitor/share",
  "@capacitor/camera",
  "@capacitor/geolocation",
  "@capacitor/haptics",
  "@capacitor/network",
  "@capacitor/splash-screen",
  "@capacitor/status-bar",
  "@capacitor/keyboard",
  "@capacitor/local-notifications",
  "@capacitor/browser"
];

async function buildMobileBundle(overrides = {}) {
  const config = await loadOptionalConfig();
  return buildMobile(config, {
    ...(option("app-id") ? { appId: option("app-id") } : {}),
    ...(option("app-name") ? { appName: option("app-name") } : {}),
    ...(option("entry") ? { entry: option("entry") } : {}),
    ...(option("views") ? { views: option("views") } : {}),
    ...(option("out") ? { out: option("out") } : {}),
    ...(option("api-url") ? { apiUrl: option("api-url") } : {}),
    ...(option("live-reload") ? { liveReloadUrl: option("live-reload") } : {}),
    ...overrides
  });
}

function nativeScreenTemplate(name, title) {
  const home = name === "home";
  return `html lang="en" data-theme="dark"
  head
    meta charset="utf-8"
    meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"
    title "${title}"
    link rel="stylesheet" href="/public/cool.css"
  body.cool-mobile-body
    div.cool-mobile-shell
      header.cool-appbar.cool-safe-top
        strong "${title}"
        button.cool-icon-btn type="button" aria-label="Open notifications" "!"
      main.cool-mobile-content
        section.cool-stack
          span.cool-eyebrow "Mobile workspace"
          h1 "${home ? "Your mobile UI is independent." : title}"
          p.cool-muted "Edit resources/mobile/${name}.noderframe without changing the website."
          div.cool-mobile-grid
            article.cool-card
              strong "Fast"
              p.cool-caption "Responsive, touch-friendly components."
            article.cool-card
              strong "Native ready"
              p.cool-caption "Safe areas and device navigation are included."
      nav.cool-tabbar aria-label="Main navigation"
        a href="/"${home ? ' aria-current="page"' : ""}
          span.cool-tabbar-icon "⌂"
          span "Home"
        a href="/settings"${name === "settings" ? ' aria-current="page"' : ""}
          span.cool-tabbar-icon "⚙"
          span "Settings"
`;
}

async function makeMobileView() {
  const [requested = "home"] = positional();
  const normalized = requested.replaceAll("\\", "/").replace(/\.(noderframe|untitled)$/i, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(normalized) || normalized.includes("..")) {
    throw new Error("Mobile view name may contain letters, numbers, slashes, hyphens, and underscores");
  }
  const title = option("title", basename(normalized).replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()));
  await generate(resolve(option("views", "resources/mobile")), `${normalized}.noderframe`, nativeScreenTemplate(normalized, title));
  console.log("Compile native widgets with: noderyx build:native");
}

async function initMobileUi() {
  const directory = resolve(option("views", "resources/mobile"));
  await mkdir(directory, { recursive: true });
  for (const [name, title] of [["home", "Mobile Home"], ["settings", "Settings"]]) {
    const target = join(directory, `${name}.noderframe`);
    if (!existsSync(target)) await writeFile(target, nativeScreenTemplate(name, title), { flag: "wx" });
  }
  console.log(`Standalone native UI source is ready at ${directory}`);
  console.log('Set native.views to "resources/mobile", then run: noderyx mobile:builder');
}

async function mobileBuilder() {
  await initMobileUi();
  const config = await loadOptionalConfig();
  const overrides = { ...nativeOverrides(), views: option("views", "resources/mobile") };
  const { root } = await initNativeProject(config, overrides);
  if (!hasFlag("no-install")) {
    console.log("\nInstalling standalone React Native dependencies...");
    await run("npm", ["install"], { cwd: root });
  }
  console.log("No WebView is used. Screens were compiled to React Native platform widgets.");
}

async function runMobileFrame() {
  const [file = "platforms/mobile/www/home.mnoderframe"] = positional();
  if (!existsSync(resolve(file))) throw new Error(`Mobile frame not found: ${resolve(file)}`);
  const port = Number(option("port", 4173));
  const host = option("host", "127.0.0.1");
  runMNodeFrame(file, { port, host });
  console.log(`Running ${file} at http://${host}:${port}`);
}

async function qaCheck() {
  const report = await inspectProject(await loadOptionalConfig());
  console.log(hasFlag("json") ? JSON.stringify(report, null, 2) : formatQaReport(report));
  if (!report.ok || (hasFlag("strict") && report.counts.warnings)) process.exitCode = 1;
}

async function copyTree(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.isFile()) await copyFile(from, to);
  }
}

async function installEditorSupport() {
  const editor = option("editor", "vscode").toLowerCase();
  const folders = {
    vscode: ".vscode/extensions",
    cursor: ".cursor/extensions",
    vscodium: ".vscode-oss/extensions"
  };
  if (!folders[editor]) throw new Error("Editor must be vscode, cursor, or vscodium");

  const source = resolve(fileURLToPath(new URL("../tooling/editors/vscode", import.meta.url)));
  if (!existsSync(source)) throw new Error(`Bundled editor support not found: ${source}`);
  const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  const target = join(
    homedir(),
    folders[editor],
    `${manifest.publisher}.${manifest.name}-${manifest.version}`
  );
  await copyTree(source, target);
  console.log(`Installed Noderyx icons and language support for ${editor}: ${target}`);
  console.log("Reload the editor window to activate .noderframe and .mnoderframe support.");
}

/**
 * Write a fresh APP_KEY into .env. Every signature the framework produces â€”
 * sessions, CSRF tokens, signed cookies â€” depends on it.
 */
async function sparkKey() {
  const key = generateKey();
  const target = resolve(option("env", ".env"));

  if (hasFlag("show")) {
    console.log(`APP_KEY=${key}`);
    return;
  }

  if (!existsSync(target)) {
    const example = resolve(`${target}.example`);
    const contents = existsSync(example) ? await readFile(example, "utf8") : "";
    const updated = /^APP_KEY=.*$/m.test(contents)
      ? contents.replace(/^APP_KEY=.*$/m, `APP_KEY=${key}`)
      : `${contents.replace(/\n*$/, "\n")}APP_KEY=${key}\n`;
    await writeFile(target, updated);
    console.log(`Created ${basename(target)} and wrote a secure APP_KEY`);
    return;
  }

  const contents = await readFile(target, "utf8");
  if (/^APP_KEY=.+$/m.test(contents) && !hasFlag("force")) {
    throw new Error(`APP_KEY already exists in ${basename(target)}. Use --force to replace it, which signs out every user.`);
  }

  const updated = /^APP_KEY=.*$/m.test(contents)
    ? contents.replace(/^APP_KEY=.*$/m, `APP_KEY=${key}`)
    : `${contents.replace(/\n*$/, "\n")}APP_KEY=${key}\n`;
  await writeFile(target, updated);
  console.log(`Wrote a new APP_KEY to ${basename(target)}`);
}

/** Hash a password with the same scrypt settings the framework verifies with. */
async function hashCommand() {
  const [password] = positional();
  if (!password) throw new Error("Example: noderyx hash \"correct horse battery staple\"");
  console.log(await hashPassword(password));
}

function nativeOverrides() {
  return {
    views: option("views"),
    out: option("out"),
    entry: option("entry"),
    appId: option("app-id"),
    appName: option("app-name"),
    apiUrl: option("api-url")
  };
}

async function buildNativeScreens() {
  await buildNative(await loadOptionalConfig(), nativeOverrides());
}

async function nativeInit() {
  const { root } = await initNativeProject(await loadOptionalConfig(), nativeOverrides());
  if (hasFlag("no-install")) return;

  console.log("\nInstalling React Native dependencies...");
  await run("npm", ["install"], { cwd: root });
}

/** Build the screens, then hand off to Expo to compile and launch the app. */
async function nativeRun() {
  const [platform] = requestedPlatforms(["android"]);
  const { out } = await buildNative(await loadOptionalConfig(), nativeOverrides());

  if (!existsSync(join(out, "package.json"))) {
    throw new Error(`No native project yet. Run: noderyx native:init`);
  }
  if (platform === "ios" && process.platform !== "darwin") {
    throw new Error("Building for iOS requires macOS and Xcode");
  }
  await run("npx", ["expo", `run:${platform}`], { cwd: out });
}

async function nativeStart() {
  const { out } = await buildNative(await loadOptionalConfig(), nativeOverrides());
  if (!existsSync(join(out, "package.json"))) {
    throw new Error(`No native project yet. Run: noderyx native:init`);
  }
  await run("npx", ["expo", "start", ...(hasFlag("clear") ? ["--clear"] : [])], { cwd: out });
}

async function mobileInit() {
  const { options } = await buildMobileBundle();
  const platforms = requestedPlatforms();

  if (!hasFlag("no-install")) {
    console.log(`Installing Capacitor for ${platforms.join(" and ")}...`);
    await run("npm", ["install", ...CAPACITOR_PACKAGES]);
  }

  for (const platform of platforms) {
    if (existsSync(resolve(platform))) {
      console.log(`Skipping ${platform}: the ${platform}/ project already exists.`);
      continue;
    }
    if (platform === "ios" && process.platform !== "darwin") {
      console.log("Adding the iOS project on Windows. Building an .ipa still requires macOS and Xcode.");
    }
    await run("npx", ["cap", "add", platform]);
  }

  console.log(`
Mobile projects are ready.

  noderyx mobile:run android     Build, sync, and launch on a device or emulator
  noderyx mobile:open ios        Open the Xcode project (macOS)
  noderyx mobile:sync            Re-copy the web build after changing views

App ID: ${options.appId}   Web directory: ${webDirectory(options)}`);
}

async function mobileAdd() {
  const platforms = requestedPlatforms([]);
  if (!platforms.length) throw new Error("Example: noderyx mobile:add android");
  await buildMobileBundle();
  for (const platform of platforms) await run("npx", ["cap", "add", platform]);
}

async function mobileSync() {
  await buildMobileBundle();
  const platforms = requestedPlatforms([]).filter((platform) => existsSync(resolve(platform)));
  await run("npx", ["cap", "sync", ...platforms]);
}

async function mobileOpen() {
  const [platform] = requestedPlatforms([]);
  if (!platform) throw new Error("Example: noderyx mobile:open android");
  await run("npx", ["cap", "open", platform]);
}

async function mobileRun() {
  const [platform] = requestedPlatforms([]);
  if (!platform) throw new Error("Example: noderyx mobile:run android");
  if (!existsSync(resolve(platform))) {
    throw new Error(`No ${platform}/ project yet. Run: noderyx mobile:init ${platform}`);
  }
  await buildMobileBundle();
  await run("npx", ["cap", "sync", platform]);
  const target = option("target");
  await run("npx", ["cap", "run", platform, ...(target ? ["--target", target] : [])]);
}

function portAvailable(port, host) {
  return new Promise((done, fail) => {
    const probe = createNetServer();
    probe.unref();
    probe.once("error", (error) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") return done(false);
      fail(error);
    });
    probe.listen(port, host, () => probe.close(() => done(true)));
  });
}

async function selectPort(requested, host, strict = false) {
  const automatic = String(requested).toLowerCase() === "auto";
  let port = automatic ? 3000 : Number(requested);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be a number from 1 to 65535, or auto");
  }
  for (let attempts = 0; attempts < 100; attempts += 1, port += 1) {
    if (await portAvailable(port, host)) return port;
    if (strict && !automatic) throw new Error(`Port ${port} is already in use`);
  }
  throw new Error(`No available port found starting at ${automatic ? 3000 : requested}`);
}

async function checkPort() {
  const [positionalPort] = positional();
  const requested = option("port", positionalPort ?? process.env.PORT ?? "3000");
  const host = option("host", process.env.HOST ?? "0.0.0.0");
  const port = Number(requested);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Provide a port from 1 to 65535");
  const available = await portAvailable(port, host);
  console.log(`Port ${port} on ${host} is ${available ? "available" : "in use"}.`);
  if (!available) process.exitCode = 1;
}

async function serve(forceWatch = false) {
  const [positionalPort] = positional();
  const requestedPort = option("port", positionalPort ?? process.env.PORT ?? "3000");
  const host = option("host", process.env.HOST ?? "0.0.0.0");
  const port = await selectPort(requestedPort, host, hasFlag("strict-port"));
  const entry = resolve(option("entry", "server.js"));
  const watch = forceWatch || hasFlag("watch");
  const nodeArgs = [];

  if (watch) {
    for (const watchTarget of [
      "server.js",
      "noderyx.config.js",
      "untitled.config.js",
      ".env",
      "app",
      "database",
      "packages",
      "framework",
      "resources",
      "public",
      "database/migrations"
    ]) {
      if (existsSync(resolve(watchTarget))) nodeArgs.push(`--watch-path=${watchTarget}`);
    }
  }

  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  console.log(`${watch ? "Live development" : "Noderyx server"}: http://${displayHost}:${port}`);
  if (Number(requestedPort) !== port) console.log(`Requested port was unavailable; selected ${port}.`);
  console.log(`Watching: ${watch ? "enabled" : "disabled"}`);

  nodeArgs.push(entry);
  const child = spawn(process.execPath, nodeArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port),
      NODE_ENV: process.env.NODE_ENV ?? "development"
    }
  });

  child.on("error", (error) => {
    console.error(`Unable to start Noderyx server: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 0;
  });
}

async function build() {
  const [input = "resources/views", output = "public/generated"] = positional();
  const inputPath = resolve(input);
  const outputPath = resolve(output);
  await mkdir(outputPath, { recursive: true });

  async function collect(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await collect(path));
      else if (entry.isFile() && /\.(noderframe|untitled)$/.test(entry.name)) files.push(path);
    }
    return files;
  }

  const files = await collect(inputPath);
  const preferred = new Set(files
    .filter((file) => file.endsWith(".noderframe"))
    .map((file) => file.slice(0, -".noderframe".length)));

  for (const file of files) {
    const extension = file.endsWith(".noderframe") ? ".noderframe" : ".untitled";
    if (extension === ".untitled" && preferred.has(file.slice(0, -extension.length))) continue;
    const source = await readFile(file, "utf8");
    const sourceRelative = relative(inputPath, file);
    const target = join(outputPath, `${sourceRelative.slice(0, -extension.length)}.html`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, compile(source));
    console.log(`Built ${target}`);
  }
}

function cpanelSettings() {
  return {
    out: option("out", "platforms/cpanel"),
    mode: option("mode", "passenger"),
    user: option("user"),
    directory: option("dir", "public_html"),
    appRoot: option("app-root"),
    baseUri: option("base-uri", "/"),
    nodeBinary: option("node"),
    startupFile: option("startup", "app.js"),
    environment: option("env", "production"),
    port: Number(option("port", 3000)),
    host: option("host", "127.0.0.1"),
    views: option("views", "resources/views"),
    public: option("public", "public"),
    repository: option("repo"),
    branch: option("branch", "main"),
    withModules: hasFlag("with-modules")
  };
}

async function cpanelBuild() {
  const result = await buildCpanel(cpanelSettings());
  console.log(`Built the ${result.mode} bundle in ${relative(process.cwd(), result.out) || "."}`);
  if (result.mode !== "static") console.log(`Application root: ${result.appRoot}`);
  console.log(`Files: ${result.files.length}`);
  for (const note of result.notes) console.log(`  - ${note}`);
  console.log("\nUpload the contents of that folder into public_html, then read README-CPANEL.md.");
}

/** Print a single artefact so an existing deployment can be patched by hand. */
async function cpanelFile() {
  const [what = "htaccess"] = positional();
  const settings = cpanelSettings();
  if (what === "htaccess") {
    if (!CPANEL_MODES.includes(settings.mode)) {
      throw new Error(`Unknown cPanel mode: ${settings.mode}. Use ${CPANEL_MODES.join(", ")}.`);
    }
    const writers = { passenger: passengerHtaccess, proxy: proxyHtaccess, static: staticHtaccess };
    console.log(writers[settings.mode](settings));
    return;
  }
  if (what === "check" || what === "doctor") {
    console.log(doctorPhp(settings));
    return;
  }
  if (what === "install" || what === "installer") {
    console.log(installerPhp(settings));
    return;
  }
  if (what === "deploy" || what === "panel") {
    console.log(deployPhp(settings));
    return;
  }
  throw new Error("Example: noderyx cpanel:file install --user=myaccount > noderyx-install.php");
}

async function withDatabase(action) {
  const config = await loadConfig();
  const db = await connect(config.database);
  try {
    return await action(
      db,
      resolve(config.migrations ?? "database/migrations"),
      resolve(config.seeders ?? "database/seeders")
    );
  } finally {
    await db.close();
  }
}

function className(value) {
  const result = value
    .replace(/\.(js|mjs)$/i, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
  if (!result || !/^[A-Za-z]/.test(result)) throw new Error(`Invalid class name: ${value}`);
  return result;
}

async function generate(directory, fileName, contents) {
  await mkdir(directory, { recursive: true });
  const target = join(directory, fileName);
  await writeFile(target, contents, { flag: "wx" });
  console.log(`Created ${target}`);
}

async function scaffoldProject() {
  const [requested] = positional();
  if (!requested) throw new Error("Example: noderyx new my-project");
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(requested)) {
    throw new Error("Project name may contain letters, numbers, hyphens, and underscores");
  }

  const target = resolve(requested);
  if (existsSync(target) && (await readdir(target)).length) {
    throw new Error(`Target directory is not empty: ${target}`);
  }

  const database = option("database", "mysql").toLowerCase();
  if (!["mysql", "postgres", "postgresql", "mongo", "mongodb"].includes(database)) {
    throw new Error("Database must be mysql, postgres, or mongo");
  }
  const profile = solutionProfile(option("profile", "saas"));

  const folders = [
    ".vscode",
    "app/Controllers",
    "app/Commands",
    "app/Middleware",
    "app/Models",
    "app/Observers",
    "database/seeders",
    "database/migrations",
    "packages",
    "public",
    "resources/views",
    "resources/mobile",
    "resources/views/errors"
  ];
  for (const folder of folders) await mkdir(join(target, folder), { recursive: true });

  const errorView = (status, label) => `html lang="en"
  head
    meta charset="utf-8"
    meta name="viewport" content="width=device-width, initial-scale=1"
    meta name="robots" content="noindex"
    title "${status} â€” {{title}} | Noderyx"
    link rel="stylesheet" href="/public/cool.css"
  body
    main.cool-error-page
      section.cool-error-card
        a.cool-brand href="/"
          span.cool-brand-mark "N"
          span "Noderyx"
        span.cool-error-code "${status}"
        span.cool-eyebrow "${label}"
        h1 "{{title}}"
        p.cool-error-message "{{message}}"
        div.cool-row.cool-error-actions
          a.cool-btn href="/" "Back home"
          button.cool-btn.secondary type="button" data-noderyx="back" "Go back"
        code.cool-error-details "{{details}}"
      div.cool-error-decoration aria-hidden="true"
        span "${status}"
`;

  const frameworkRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const localFramework = hasFlag("local") || !frameworkRoot.toLowerCase().includes("node_modules");
  const frameworkDependency = localFramework
    ? `file:${frameworkRoot.replaceAll("\\", "/")}`
    : "^0.1.0";

  const files = {
    ".vscode/extensions.json": `${JSON.stringify({
      recommendations: ["noderyx.noderyx-language-support"]
    }, null, 2)}\n`,
    ".vscode/settings.json": `${JSON.stringify({
      "files.exclude": {
        "**/node_modules": true,
        "platforms/mobile/www": true,
        "platforms/native": true,
        "public/generated": true
      }
    }, null, 2)}\n`,
    "package.json": JSON.stringify({
      name: requested.toLowerCase(),
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "noderyx-framework serve --watch",
        live: "noderyx-framework live",
        start: "node server.js",
        "framework:update": "noderyx-framework update",
        qa: "noderyx-framework qa",
        build: "noderyx-framework build resources/views public/generated",
        "cpanel:build": "noderyx-framework cpanel:build",
        "build:native": "noderyx-framework build:native --views=resources/mobile",
        "mobile:builder": "noderyx-framework mobile:builder",
        "native:init": "noderyx-framework native:init",
        "native:android": "noderyx-framework native:run android",
        "native:ios": "noderyx-framework native:run ios",
        "native:start": "noderyx-framework native:start",
        "build:mobile": "noderyx-framework build:mobile",
        "mobile:init": "noderyx-framework mobile:init",
        "mobile:android": "noderyx-framework mobile:run android",
        "mobile:ios": "noderyx-framework mobile:run ios",
        "editor:install": "noderyx-framework editor:install",
        migrate: "noderyx-framework migrate",
        seed: "noderyx-framework db:seed"
      },
      dependencies: {
        "noderyx-framework": frameworkDependency
      },
      engines: { node: ">=20" }
    }, null, 2) + "\n",
    "server.js": `import { ai, loadEnvironment, loadPackages, noderyx } from "noderyx-framework";
import { fileURLToPath } from "node:url";
import { HomeController } from "./app/Controllers/HomeController.js";

loadEnvironment();
const { default: config } = await import("./noderyx.config.js");

const app = noderyx({
  requireAppKey: true,
  name: config.app.name,
  environment: config.app.environment,
  debug: config.app.debug,
  cache: config.cache,
  views: fileURLToPath(new URL("./resources/views", import.meta.url)),
  public: fileURLToPath(new URL("./public", import.meta.url)),
  security: {
    ...config.security,
    cors: config.security.cors.length
      ? { origins: config.security.cors, credentials: true }
      : null
  }
});

app.provide("ai", ai(config.ai));

app.get("/", HomeController.handle("index"));
app.get("/health", HomeController.handle("health"));
await loadPackages(app, config.packages, { config });

// Phusion Passenger (cPanel) may hand the application a unix socket path in
// PORT instead of a number, so only treat a numeric value as a TCP port.
const requestedPort = String(process.env.PORT ?? 3000);
const socketPath = /^\\d+$/.test(requestedPort) ? null : requestedPort;
const host = process.env.HOST ?? "0.0.0.0";

if (socketPath) app.listen(socketPath, () => console.log(\`Listening on \${socketPath}\`));
else app.listen(Number(requestedPort), host, () => console.log(\`Running at http://localhost:\${requestedPort}\`));
`,
    "app/Controllers/HomeController.js": `import { Controller } from "noderyx-framework";

export class HomeController extends Controller {
  async index() {
    return this.render("home", {
      siteName: process.env.SITE_NAME ?? "${requested}",
      siteUrl: process.env.SITE_URL ?? "http://localhost:3000",
      description: process.env.SITE_DESCRIPTION ?? "Built with Noderyx Framework."
    });
  }

  async health() {
    return this.json({ status: "ok", runtime: "Node.js" });
  }
}
`,
    "resources/views/home.noderframe": `html lang="en"
  head
    meta charset="utf-8"
    meta name="viewport" content="width=device-width, initial-scale=1"
    meta name="description" content="{{description}}"
    link rel="canonical" href="{{siteUrl}}"
    title "{{siteName}}"
    link rel="stylesheet" href="/public/cool.css"
  body
    main.cool-container.cool-welcome.cool-stack
      span.cool-badge "Noderyx Framework"
      h1 "{{siteName}}"
      p.cool-muted "{{description}}"
    script src="/public/untitled-live.js" defer
`,
    "resources/mobile/home.noderframe": nativeScreenTemplate("home", "Mobile Home"),
    "resources/mobile/settings.noderframe": nativeScreenTemplate("settings", "Settings"),
    "resources/views/errors/403.noderframe": errorView(403, "Permission required"),
    "resources/views/errors/404.noderframe": errorView(404, "Lost in the routes"),
    "resources/views/errors/500.noderframe": errorView(500, "Application error"),
    "resources/views/errors/502.noderframe": errorView(502, "Connection error"),
    "noderyx.config.js": `import { envBoolean, envList, envNumber, securityProfile, solutionProfile } from "noderyx-framework";

const type = (process.env.DB_TYPE ?? "${database}").toLowerCase();
const profile = solutionProfile(process.env.APP_PROFILE ?? "${profile.name}");
const aiProviderName = (process.env.AI_PROVIDER ?? "openai").toLowerCase();
const aiProvider = aiProviderName === "claude" ? "anthropic" : aiProviderName;
const usingClaude = aiProvider === "anthropic";

export default {
  app: {
    name: process.env.APP_NAME ?? "${requested}",
    environment: process.env.NODE_ENV ?? "development",
    debug: envBoolean("APP_DEBUG", process.env.NODE_ENV !== "production"),
    url: process.env.APP_URL ?? "http://localhost:3000",
    timezone: process.env.APP_TIMEZONE ?? "UTC",
    locale: process.env.APP_LOCALE ?? "en",
    logLevel: process.env.LOG_LEVEL ?? "info",
    profile: profile.name
  },
  // Local packages under packages/ load automatically. Add published packages here.
  packages: [],
  ai: {
    provider: aiProvider,
    enabled: envBoolean("AI_ENABLED", false),
    apiKey: usingClaude ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY,
    baseURL: usingClaude
      ? process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1"
      : process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    model: usingClaude
      ? process.env.ANTHROPIC_MODEL ?? "claude-opus-5"
      : process.env.OPENAI_MODEL ?? "gpt-5.6-sol",
    reasoningEffort: process.env.AI_REASONING_EFFORT ?? "medium",
    verbosity: process.env.AI_VERBOSITY ?? "medium",
    maxOutputTokens: envNumber("AI_MAX_OUTPUT_TOKENS", usingClaude ? 4000 : 1200),
    inputLimit: envNumber("AI_INPUT_LIMIT", 8000),
    timeoutMs: envNumber("AI_TIMEOUT_MS", usingClaude ? 60000 : 30000),
    store: envBoolean("AI_STORE", false),
    fallbacks: envBoolean("ANTHROPIC_FALLBACKS", true),
    instructions: process.env.AI_INSTRUCTIONS ?? "Be practical, concise, and honest."
  },
  database: type.startsWith("post")
    ? { type: "postgres", connectionString: process.env.DATABASE_URL }
    : type.startsWith("mongo")
      ? { type: "mongo", url: process.env.MONGODB_URL, database: process.env.DB_NAME }
      : {
          type: "mysql",
          host: process.env.DB_HOST,
          port: envNumber("DB_PORT", 3306),
          user: process.env.DB_USER ?? "root",
          password: process.env.DB_PASSWORD ?? "",
          database: process.env.DB_NAME,
          connectionLimit: envNumber("DB_POOL_MAX", 10)
        },
  migrations: "database/migrations",
  seeders: "database/seeders",

  cache: {
    driver: process.env.CACHE_DRIVER ?? "memory",
    prefix: process.env.CACHE_PREFIX ?? "noderyx",
    ttl: envNumber("CACHE_TTL", profile.cache.ttl),
    maxItems: envNumber("CACHE_MAX_ITEMS", profile.cache.maxItems),
    staticMaxAge: envNumber("CACHE_STATIC_MAX_AGE", profile.cache.staticMaxAge),
    staleWhileRevalidate: envNumber("CACHE_STALE_WHILE_REVALIDATE", profile.cache.staleWhileRevalidate)
  },

  mail: {
    driver: process.env.MAIL_DRIVER ?? "log",
    host: process.env.MAIL_HOST ?? "127.0.0.1",
    port: envNumber("MAIL_PORT", 1025),
    secure: envBoolean("MAIL_SECURE", false),
    username: process.env.MAIL_USERNAME ?? null,
    password: process.env.MAIL_PASSWORD ?? null,
    from: {
      address: process.env.MAIL_FROM_ADDRESS ?? "hello@example.com",
      name: process.env.MAIL_FROM_NAME ?? process.env.APP_NAME ?? "${requested}"
    }
  },

  security: {
    ...securityProfile(process.env.SECURITY_PROFILE ?? "standard"),
    appKey: process.env.APP_KEY,
    trustProxy: envBoolean("TRUST_PROXY", false),
    bodyLimit: envNumber("REQUEST_BODY_LIMIT", profile.security.bodyLimit),
    cors: envList("CORS_ORIGINS"),
    rateLimit: {
      windowMs: envNumber("RATE_LIMIT_WINDOW_MS", 60000),
      max: envNumber("RATE_LIMIT_MAX", profile.security.rateLimitMax)
    },
    session: {
      name: process.env.SESSION_COOKIE ?? "noderyx_session",
      maxAge: envNumber("SESSION_MAX_AGE", 604800),
      sameSite: process.env.SESSION_SAME_SITE ?? "Lax",
      secure: envBoolean("SESSION_SECURE", process.env.NODE_ENV === "production")
    }
  },

  // Android and iOS builds: noderyx mobile:init
  mobile: {
    appId: process.env.MOBILE_APP_ID ?? "com.example.${requested.toLowerCase().replaceAll("-", "")}",
    appName: process.env.MOBILE_APP_NAME ?? "${requested}",
    views: "resources/views",
    public: "public",
    entry: "home",
    out: "platforms/mobile",
    // The packaged app has no server of its own, so point it at your API.
    apiUrl: process.env.MOBILE_API_URL ?? null,
    data: {
      siteName: process.env.SITE_NAME ?? "${requested}",
      siteUrl: process.env.SITE_URL ?? "http://localhost:3000",
      description: process.env.SITE_DESCRIPTION ?? "Built with Noderyx Framework."
    }
  },

  // Native Android and iOS: noderyx native:init
  // Screens draw real platform widgets. There is no WebView.
  native: {
    appId: process.env.MOBILE_APP_ID ?? "com.example.${requested.toLowerCase().replaceAll("-", "")}",
    appName: process.env.MOBILE_APP_NAME ?? "${requested}",
    views: "resources/mobile",
    out: "platforms/native",
    entry: "home",
    // The app has no server of its own, so point it at yours.
    apiUrl: process.env.MOBILE_API_URL ?? null
  }
};
`,
    ".env.example": `# Application
NODE_ENV=development
APP_PROFILE=${profile.name}
APP_DEBUG=true
APP_KEY=
APP_NAME="${requested}"
APP_URL=http://localhost:3000
APP_TIMEZONE=UTC
APP_LOCALE=en
LOG_LEVEL=debug
SITE_NAME="${requested}"
SITE_URL=http://localhost:3000
SITE_DESCRIPTION="${profile.description}"
HOST=0.0.0.0
PORT=3000

# AI (optional; keep the API key server-side)
# AI_PROVIDER selects which credential block is used: openai or anthropic (claude).
AI_ENABLED=false
AI_PROVIDER=openai

# Used when AI_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-sol
OPENAI_BASE_URL=https://api.openai.com/v1

# Used when AI_PROVIDER=anthropic (Claude)
# Thinking tokens count toward AI_MAX_OUTPUT_TOKENS: raise it to 4000 or more,
# or set AI_REASONING_EFFORT=none, to avoid truncated answers.
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-opus-5
ANTHROPIC_BASE_URL=https://api.anthropic.com/v1
ANTHROPIC_FALLBACKS=true

AI_REASONING_EFFORT=medium
AI_VERBOSITY=medium
AI_MAX_OUTPUT_TOKENS=1200
AI_INPUT_LIMIT=8000
AI_TIMEOUT_MS=30000
AI_STORE=false
AI_INSTRUCTIONS="Be practical, concise, and honest."

# Database
DB_TYPE=${database}
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=${requested.replaceAll("-", "_")}
DB_POOL_MIN=0
DB_POOL_MAX=10
DATABASE_URL=postgresql://user:password@localhost:5432/database
MONGODB_URL=mongodb://localhost:27017

# Cache
CACHE_DRIVER=memory
CACHE_PREFIX=noderyx
CACHE_TTL=${profile.cache.ttl}
CACHE_MAX_ITEMS=${profile.cache.maxItems}
CACHE_STATIC_MAX_AGE=${profile.cache.staticMaxAge}
CACHE_STALE_WHILE_REVALIDATE=${profile.cache.staleWhileRevalidate}

# Email (log is safe for development; SMTP packages consume these settings)
MAIL_DRIVER=log
MAIL_HOST=127.0.0.1
MAIL_PORT=1025
MAIL_SECURE=false
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_FROM_ADDRESS=hello@example.com
MAIL_FROM_NAME="${requested}"

# Security and sessions
SECURITY_PROFILE=standard
TRUST_PROXY=false
CORS_ORIGINS=
REQUEST_BODY_LIMIT=${profile.security.bodyLimit}
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=${profile.security.rateLimitMax}
SESSION_COOKIE=noderyx_session
SESSION_MAX_AGE=604800
SESSION_SAME_SITE=Lax
SESSION_SECURE=false

# Mobile and native
MOBILE_APP_ID=com.example.${requested.toLowerCase().replaceAll("-", "")}
MOBILE_APP_NAME="${requested}"
MOBILE_API_URL=
`,
    ".gitignore": `# Dependencies and package-manager caches
node_modules/
.npm/
.pnpm-store/
.yarn/cache/
.yarn/unplugged/

# Environment files and local secrets
.env
.env.*
!.env.example
*.pem
*.key
*.p12
*.pfx
*.jks
*.keystore
*.mobileprovision
google-services.json
GoogleService-Info.plist

# Logs, diagnostics, tests, and coverage
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
logs/
coverage/
.nyc_output/
test-results/
playwright-report/
qa-results/

# Noderyx generated output and local recovery data
.noderyx/
public/generated/
platforms/mobile/www/
platforms/native/

# General build output and temporary files
dist/
build/
out/
tmp/
temp/
.cache/
*.tmp
*.temp
*.tsbuildinfo

# Expo and React Native
.expo/
.expo-shared/
web-build/
metro-cache/
react-native-packager-cache-*

# Android/Gradle output (keep Android source and project settings)
.gradle/
android/.gradle/
android/local.properties
android/**/build/
android/captures/
android/.idea/
*.hprof

# iOS/Xcode output (keep iOS source and project files)
ios/Pods/
ios/build/
ios/DerivedData/
ios/**/xcuserdata/
ios/**/*.xcuserstate
ios/.symlinks/
DerivedData/

# IDE and operating-system state
.idea/
*.iml
.vscode/*.local.json
.vscode/.ropeproject/
.DS_Store
.AppleDouble
.LSOverride
Thumbs.db
Desktop.ini
$RECYCLE.BIN/
`,
    "Procfile": "web: node server.js\n",
    "Dockerfile": `FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
USER node
CMD ["node", "server.js"]
`,
    "README.md": `# ${requested}

Generated with the Noderyx **${profile.label}** profile.

\`\`\`powershell
npm install
npm run dev
\`\`\`
`
  };

  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(target, name), contents, { flag: "wx" });
  }

  // A project starts with its own signing key, so nothing is ever signed with
  // a shared or example value.
  await writeFile(
    join(target, ".env"),
    files[".env.example"].replace(/^APP_KEY=$/m, `APP_KEY=${generateKey()}`),
    { flag: "wx" }
  );

  await writeFile(
    join(target, "public/cool.css"),
    await readFile(join(frameworkRoot, "public/cool.css"))
  );
  await writeFile(
    join(target, "public/json-viewer.js"),
    await readFile(join(frameworkRoot, "public/json-viewer.js"))
  );
  await writeFile(
    join(target, "public/noderyx-native.js"),
    await readFile(join(frameworkRoot, "public/noderyx-native.js"))
  );
  await writeFile(
    join(target, "public/untitled-live.js"),
    await readFile(join(frameworkRoot, "public/untitled-live.js"))
  );
  for (const placeholder of [
    "app/Controllers/.gitkeep",
    "app/Commands/.gitkeep",
    "app/Middleware/.gitkeep",
    "app/Models/.gitkeep",
    "app/Observers/.gitkeep",
    "database/seeders/.gitkeep",
    "database/migrations/.gitkeep",
    "packages/.gitkeep"
  ]) await writeFile(join(target, placeholder), "");

  console.log(`Created Noderyx project at ${target}`);

  if (!hasFlag("no-install")) {
    console.log("Installing npm dependencies...");
    const installer = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(installer, ["install"], { cwd: target, stdio: "inherit" });
    const code = await new Promise((done) => child.on("exit", done));
    if (code !== 0) throw new Error("npm install failed; the project files were still created");
  }

  console.log(`\nNext:\n  cd ${requested}\n  npm run dev\n\nFor Android and iOS:\n  npm run mobile:init\n  npm run mobile:android\n\nA .env with its own APP_KEY was created. Keep it out of version control.`);
}

async function makeController() {
  const [requested] = positional();
  if (!requested) throw new Error("Example: noderyx make:controller UserController");
  const name = className(requested).replace(/Controller$/, "") + "Controller";
  await generate(resolve("app/Controllers"), `${name}.js`, `import { Controller } from "noderyx-framework";

export class ${name} extends Controller {
  async index() {
    return this.json({ message: "${name}.index" });
  }

  async show() {
    return this.json({ id: this.params.id });
  }

  async store() {
    return this.json({ data: this.body }, 201);
  }
}

`);
}

async function makePackage() {
  const [requested] = positional();
  if (!requested) throw new Error("Example: noderyx make:package hello-world");
  const slug = requested.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) throw new Error("Package name must contain letters or numbers");
  const target = resolve("packages", slug);
  if (existsSync(target)) throw new Error(`Package already exists: ${target}`);
  const npmName = option("package-name", slug);
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(npmName)) throw new Error("Invalid npm package name");

  await mkdir(join(target, "src"), { recursive: true });
  await writeFile(join(target, "package.json"), `${JSON.stringify({
    name: npmName,
    version: "0.1.0",
    private: true,
    type: "module",
    main: "src/index.js",
    peerDependencies: { "noderyx-framework": ">=0.1.0" },
    keywords: ["noderyx", "noderyx-package"]
  }, null, 2)}\n`, { flag: "wx" });
  await writeFile(join(target, "src", "index.js"), `import { definePackage } from "noderyx-framework";

export default definePackage({
  name: "${npmName}",

  register({ app, options }) {
    app.get("/${slug}", ({ json }) => json({
      package: "${npmName}",
      message: options.message ?? "${slug} package is working"
    }));
  },

  async boot({ name }) {
    // Connect services or warm caches after all packages are registered.
    console.log(\`Loaded Noderyx package: \${name}\`);
  }
});
`, { flag: "wx" });
  await writeFile(join(target, "README.md"), `# ${npmName}

Local package generated by Noderyx.

- Provider: \`src/index.js\`
- Example route: \`/${slug}\`
- Package guide: \`docs/PACKAGES.md\` in the framework repository

Local packages are discovered automatically. Restart \`npm run dev\` after
creating the package.
`, { flag: "wx" });
  console.log(`Created Noderyx package at ${target}`);
  console.log(`Route available after restart: /${slug}`);
}

async function makeView() {
  const [requested] = positional();
  if (!requested) throw new Error("Example: noderyx make:view dashboards/admin");
  const normalized = requested.replaceAll("\\", "/").replace(/\.(noderframe|untitled)$/i, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(normalized) || normalized.includes("..")) {
    throw new Error("View name may contain letters, numbers, slashes, hyphens, and underscores");
  }
  const target = resolve("resources/views", `${normalized}.noderframe`);
  await generate(dirname(target), basename(target), `html lang="en"
  head
    meta charset="utf-8"
    meta name="viewport" content="width=device-width, initial-scale=1"
    title "${basename(normalized)}"
    link rel="stylesheet" href="/public/cool.css"
  body
    main.cool-container.cool-hero
      h1 "${basename(normalized)}"
      p.cool-muted "Built with Noderyx Framework."
`);
}

async function makeModel() {
  const [requested] = positional();
  if (!requested) throw new Error("Example: noderyx make:model User");
  const name = className(requested);
  const table = option("table", `${name.toLowerCase()}s`);
  await generate(resolve("app/Models"), `${name}.js`, `import { Model } from "noderyx-framework";

export class ${name} extends Model {
  static table = "${table}";
  static primaryKey = "id";
  static fillable = [];
}
`);
}

async function makeMiddleware() {
  const [requested] = positional();
  if (!requested) throw new Error("Example: noderyx make:middleware Authenticate");
  const name = className(requested).replace(/Middleware$/, "") + "Middleware";
  await generate(resolve("app/Middleware"), `${name}.js`, `export class ${name} {
  async handle(context, next) {
    // Inspect context.request, context.params, context.body, or context.query here.
    return next();
  }
}
`);
}

async function makeObserver() {
  const [requested] = positional();
  if (!requested) throw new Error("Example: noderyx make:observer UserObserver");
  const name = className(requested).replace(/Observer$/, "") + "Observer";
  await generate(resolve("app/Observers"), `${name}.js`, `export class ${name} {
  async creating(values) {}
  async created(model) {}
  async updating(payload) {}
  async updated(model) {}
  async deleting(id) {}
  async deleted(id) {}
}
`);
}

async function makeCommand() {
  const [requested] = positional();
  if (!requested) throw new Error("Example: noderyx make:command SendReports");
  const name = className(requested).replace(/Command$/, "") + "Command";
  const signature = option("signature", requested
    .replace(/Command$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1:$2")
    .toLowerCase());
  await generate(resolve("app/Commands"), `${name}.js`, `export default {
  name: "${signature}",
  description: "Describe what this command does",
  async run(args) {
    console.log("Running ${signature}", args);
  }
};
`);
}

async function runCustomCommand() {
  const [requested, ...commandArgs] = positional();
  if (!requested) throw new Error("Example: noderyx run reports:send");
  const directory = resolve("app/Commands");
  if (!existsSync(directory)) throw new Error("No app/Commands directory found");
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const definition = (await import(`${pathToFileURL(join(directory, entry.name)).href}?t=${Date.now()}`)).default;
    if (definition?.name !== requested) continue;
    if (typeof definition.run !== "function") throw new Error(`${entry.name} must define run(args)`);
    await definition.run(commandArgs);
    return;
  }
  throw new Error(`Command not found: ${requested}`);
}

async function makeSeeder() {
  const [requested] = positional();
  if (!requested) throw new Error("Example: noderyx make:seeder UserSeeder");
  const name = className(requested).replace(/Seeder$/, "") + "Seeder";
  const config = await loadConfig();
  await generate(resolve(config.seeders ?? "database/seeders"), `${name}.js`, `export async function run(db) {
  // SQL: await db.query("INSERT INTO users (email) VALUES (?)", ["admin@example.com"]);
  // MongoDB: await db.collection("users").insertOne({ email: "admin@example.com" });
  console.log("Running ${name} on", db.kind);
}
`);
}

async function makeMigration() {
  const [name] = positional();
  if (!name) throw new Error("Provide a migration name, for example: noderyx make:migration create_users");
  const config = await loadConfig();
  const directory = resolve(config.migrations ?? "database/migrations");
  await mkdir(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const target = join(directory, `${timestamp}_${safeName}.js`);
  const inferredTable = safeName.replace(/^(create|add|alter)_/, "").replace(/_table$/, "") || "records";
  const table = option("table", inferredTable);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error("Invalid table name");
  const template = `export async function up(db) {
  if (db.kind === "mongo") {
    await db.createCollection("${table}").catch(() => {});
    return;
  }

  await db.query(\`
    CREATE TABLE ${table} (
      id INTEGER PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  \`);
}

export async function down(db) {
  if (db.kind === "mongo") {
    await db.collection("${table}").drop().catch(() => {});
    return;
  }

  await db.query("DROP TABLE ${table}");
}
`;
  await writeFile(target, template, { flag: "wx" });
  console.log(`Created ${target}`);
}

function help() {
  console.log(`
Noderyx Framework CLI

  noderyx new <project> [--profile=${solutionProfiles.join("|")}] [--database=mysql] [--local] [--no-install]
  noderyx serve [--watch] [--port=3000] [--host=0.0.0.0]
  noderyx live [port|auto] [--host=0.0.0.0] [--strict-port]
  noderyx port:check [port] [--host=0.0.0.0]
  noderyx build [views-directory] [output-directory]
  noderyx update [version|tag] [--dry-run] [--no-test]
  noderyx qa [--json] [--strict]

  Shared hosting (cPanel, runs from public_html without Setup Node.js App)
  noderyx cpanel:build [--mode=passenger|proxy|static] [--user=account] [--dir=public_html]
                       [--with-modules] [--repo=owner/name] [--branch=main]
                       [--node=/opt/alt/alt-nodejs20/root/usr/bin/node] [--port=3000] [--out=platforms/cpanel]
  noderyx cpanel:file <htaccess|check|install|deploy> [--mode=passenger] [--user=account]

  Native Android and iOS (real platform widgets, no WebView)
  noderyx native:init [--app-id=com.example.app] [--app-name=Name] [--no-install]
  noderyx native:run <android|ios>
  noderyx native:start [--clear]
  noderyx build:native [--views=views] [--out=native] [--entry=home]
  noderyx mobile:builder [--views=resources/mobile] [--no-install]  # standalone; no WebView
  noderyx mobile:make <name> [--title=Title]                       # native screen

  Packaged web build (Cool.css in a native shell)
  noderyx build:mobile [--app-id=com.example.app] [--app-name=Name] [--entry=home]
  noderyx mobile:ui:init [--views=resources/mobile]                # source only
  noderyx make:mobile-view <name> [--title=Title] [--views=resources/mobile]
  noderyx mnoderframe:run [file] [--port=4173] [--host=127.0.0.1]
  noderyx editor:install [--editor=vscode|cursor|vscodium]
  noderyx mobile:init [android] [ios] [--no-install]
  noderyx mobile:add <android|ios>
  noderyx mobile:sync [android] [ios]
  noderyx mobile:open <android|ios>
  noderyx mobile:run <android|ios> [--target=<device>] [--live-reload=http://192.168.1.10:3000]

  noderyx spark:key [--show] [--force]
  noderyx hash <password>

  noderyx make:controller <name>
  noderyx make:package <name> [--package-name=@scope/name]
  noderyx make:view <name>
  noderyx make:model <name> [--table=users]
  noderyx make:migration <name> [--table=users]
  noderyx make:middleware <name>
  noderyx make:observer <name>
  noderyx make:command <name> [--signature=reports:send]
  noderyx make:seeder <name>
  noderyx run <command> [...arguments]
  noderyx migrate
  noderyx migrate:status
  noderyx migrate:rollback [--steps=1]
  noderyx db:seed [--class=UserSeeder]
  noderyx help

From this repository use: npm run noderyx -- <command>
`);
}

try {
  if (command === "new" || command === "create") await scaffoldProject();
  else if (command === "update" || command === "self:update" || command === "framework:update") await frameworkUpdate();
  else if (command === "serve") await serve();
  else if (command === "live") await serve(true);
  else if (command === "port:check" || command === "port:status") await checkPort();
  else if (command === "build") await build();
  else if (command === "qa" || command === "check") await qaCheck();
  else if (command === "cpanel:build" || command === "build:cpanel" || command === "deploy:cpanel") await cpanelBuild();
  else if (command === "cpanel:file" || command === "cpanel:htaccess") await cpanelFile();
  else if (command === "build:mobile" || command === "mobile:build") await buildMobileBundle();
  else if (command === "mnoderframe:run" || command === "mobile:preview") await runMobileFrame();
  else if (command === "editor:install") await installEditorSupport();
  else if (command === "build:native") await buildNativeScreens();
  else if (command === "native:init") await nativeInit();
  else if (command === "native:run") await nativeRun();
  else if (command === "native:start") await nativeStart();
  else if (command === "spark:key") await sparkKey();
  else if (command === "key:generate") {
    console.warn("[Noderyx] key:generate is deprecated; use the Noderyx command spark:key.");
    await sparkKey();
  }
  else if (command === "hash") await hashCommand();
  else if (command === "mobile:init") await mobileInit();
  else if (command === "mobile:add") await mobileAdd();
  else if (command === "mobile:sync") await mobileSync();
  else if (command === "mobile:open") await mobileOpen();
  else if (command === "mobile:run") await mobileRun();
  else if (command === "mobile:ui:init") await initMobileUi();
  else if (command === "mobile:builder") await mobileBuilder();
  else if (command === "make:mobile-view" || command === "mobile:make") await makeMobileView();
  else if (command === "make:controller") await makeController();
  else if (command === "make:package" || command === "package:make") await makePackage();
  else if (command === "make:view" || command === "make:page") await makeView();
  else if (command === "make:model") await makeModel();
  else if (command === "make:migration") await makeMigration();
  else if (command === "make:middleware") await makeMiddleware();
  else if (command === "make:observer") await makeObserver();
  else if (command === "make:command") await makeCommand();
  else if (command === "make:seeder") await makeSeeder();
  else if (command === "run") await runCustomCommand();
  else if (command === "migrate") {
    await withDatabase(async (db, directory) => {
      const applied = await migrate(db, directory);
      console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Nothing to migrate.");
    });
  } else if (command === "migrate:status") {
    await withDatabase(async (db, directory) => {
      for (const item of await migrationStatus(db, directory)) {
        console.log(`${item.applied ? "Ran    " : "Pending"} ${item.name}`);
      }
    });
  } else if (command === "migrate:rollback") {
    await withDatabase(async (db, directory) => {
      const reverted = await rollback(db, directory, Number(option("steps", 1)));
      console.log(reverted.length ? `Rolled back: ${reverted.join(", ")}` : "Nothing to roll back.");
    });
  } else if (command === "db:seed") {
    await withDatabase(async (db, _migrations, seeders) => {
      const completed = await runSeeders(db, seeders, option("class"));
      console.log(completed.length ? `Seeded: ${completed.join(", ")}` : "No seeders found.");
    });
  } else if (command === "help" || command === "--help" || command === "-h") {
    help();
  } else {
    console.error(`Unknown command: ${command}`);
    help();
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Noderyx error: ${error.message}`);
  process.exitCode = 1;
}
