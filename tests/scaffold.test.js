import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { run, windowsCommand } from "../framework/shell.js";

test("generated npm scripts use the local framework executable", async () => {
  const root = await mkdtemp(join(tmpdir(), "noderyx-scaffold-"));
  try {
    const cli = fileURLToPath(new URL("../framework/cli.js", import.meta.url));
    const result = spawnSync(process.execPath, [cli, "new", "example", "--no-install"], {
      cwd: root,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);

    const manifest = JSON.parse(await readFile(join(root, "example", "package.json"), "utf8"));
    assert.equal(manifest.scripts.dev, "noderyx-framework serve --watch");
    assert.equal(manifest.scripts.qa, "noderyx-framework qa");
    for (const script of Object.values(manifest.scripts)) {
      if (script === "node server.js") continue;
      assert.match(script, /^noderyx-framework\b/);
    }

    const home = await readFile(join(root, "example", "resources", "views", "home.noderframe"), "utf8");
    assert.match(home, /main\.cool-container\.cool-welcome\.cool-stack/);
    assert.doesNotMatch(home, /cool-hero\.cool-stack/);
    const config = await readFile(join(root, "example", "noderyx.config.js"), "utf8");
    assert.match(config, /native:\s*\{[\s\S]*?views: "resources\/mobile"/);
    assert.match(config, /mobile:\s*\{[\s\S]*?views: "resources\/views"/);
    const nativeHome = await readFile(join(root, "example", "resources", "mobile", "home.noderframe"), "utf8");
    assert.match(nativeHome, /body\.cool-mobile-body/);
    const ignore = await readFile(join(root, "example", ".gitignore"), "utf8");
    assert.match(ignore, /^\.env\.\*$/m);
    assert.match(ignore, /^!\.env\.example$/m);
    assert.match(ignore, /^platforms\/native\/$/m);
    assert.match(ignore, /^android\/\*\*\/build\/$/m);
    assert.doesNotMatch(ignore, /^resources\/mobile\/$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated projects deploy to cPanel without Setup Node.js App", async () => {
  const root = await mkdtemp(join(tmpdir(), "noderyx-cpanel-scaffold-"));
  try {
    const cli = fileURLToPath(new URL("../framework/cli.js", import.meta.url));
    const created = spawnSync(process.execPath, [cli, "new", "shop", "--no-install"], {
      cwd: root,
      encoding: "utf8"
    });
    assert.equal(created.status, 0, created.stderr);

    const project = join(root, "shop");
    const manifest = JSON.parse(await readFile(join(project, "package.json"), "utf8"));
    assert.equal(manifest.scripts["cpanel:build"], "noderyx-framework cpanel:build");

    // Passenger can supply a unix socket path in PORT; Number() would give NaN.
    const server = await readFile(join(project, "server.js"), "utf8");
    assert.match(server, /const socketPath = \/\^\\d\+\$\/\.test\(requestedPort\) \? null : requestedPort/);
    assert.match(server, /if \(socketPath\) app\.listen\(socketPath/);
    assert.doesNotMatch(server, /const port = Number\(process\.env\.PORT/);

    // A generated project has no framework/ or routes/ directory: the runtime
    // arrives through node_modules, so the bundle must build without them.
    const built = spawnSync(process.execPath, [cli, "cpanel:build", "--user=shopacct"], {
      cwd: project,
      encoding: "utf8"
    });
    assert.equal(built.status, 0, built.stderr);

    const bundle = join(project, "platforms", "cpanel");
    assert.ok(existsSync(join(bundle, "server.js")));
    assert.ok(existsSync(join(bundle, "app.js")));
    assert.ok(existsSync(join(bundle, ".htaccess")));
    assert.ok(existsSync(join(bundle, "app", "Controllers", "HomeController.js")));
    assert.ok(!existsSync(join(bundle, ".env")), "secrets are created on the server, never bundled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a project installed from npm depends on the version that generated it", async () => {
  // The generated config imports whatever the installed framework exports, so a
  // stale hardcoded range hands every new project a runtime that predates them.
  // Scaffolding has to run from a node_modules copy to take the published path.
  const root = await mkdtemp(join(tmpdir(), "noderyx-published-"));
  try {
    const frameworkRoot = fileURLToPath(new URL("..", import.meta.url));
    const installed = join(root, "node_modules", "noderyx-framework");
    await mkdir(installed, { recursive: true });
    await cp(join(frameworkRoot, "framework"), join(installed, "framework"), { recursive: true });
    await cp(join(frameworkRoot, "package.json"), join(installed, "package.json"));
    // package.json ships public/*.css and public/*.js; scaffolding copies them.
    await cp(join(frameworkRoot, "public"), join(installed, "public"), {
      recursive: true,
      filter: (source) => !source.endsWith(`${sep}generated`)
    });

    const work = join(root, "work");
    await mkdir(work);
    const result = spawnSync(process.execPath, [join(installed, "framework", "cli.js"), "new", "example", "--no-install"], {
      cwd: work,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);

    const { version } = JSON.parse(await readFile(join(frameworkRoot, "package.json"), "utf8"));
    const manifest = JSON.parse(await readFile(join(work, "example", "package.json"), "utf8"));
    const range = manifest.dependencies["noderyx-framework"];
    assert.doesNotMatch(range, /^(file|link):/, "a published project cannot point at a local path");
    // A caret on a 0.x version stops at the next minor, stranding the project.
    assert.equal(range, `>=${version} <1.0.0`);

    // Every name the config imports has to exist in that runtime.
    const config = await readFile(join(work, "example", "noderyx.config.js"), "utf8");
    const [, imported] = config.match(/import \{([^}]+)\} from "noderyx-framework"/) ?? [];
    assert.ok(imported, "the generated config imports from noderyx-framework");
    const framework = await import(new URL("../framework/index.js", import.meta.url));
    for (const name of imported.split(",").map((entry) => entry.trim()).filter(Boolean)) {
      assert.ok(name in framework, `the framework does not export ${name}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the Windows command line targets the shim without quoting its name", () => {
  // A bare .cmd name must stay unquoted: wrapping it makes cmd.exe resolve
  // %~dp0 inside the shim against the cwd, and npm then looks for npm-cli.js
  // in the project being installed instead of its own directory.
  assert.equal(windowsCommand("npm", ["install"]), 'npm.cmd "install"');
  assert.equal(windowsCommand("npx", ["cap", "add", "android"]), 'npx.cmd "cap" "add" "android"');

  // Arguments are quoted so spaces and cmd metacharacters stay inert.
  assert.equal(windowsCommand("npm", ["install", "a b"]), 'npm.cmd "install" "a b"');
  assert.equal(windowsCommand("npm", ["run", "x&calc"]), 'npm.cmd "run" "x&calc"');

  // An executable that is a real path does need quoting.
  assert.equal(windowsCommand("C:\\Program Files\\git\\git.exe", ["log"]), '"C:\\Program Files\\git\\git.exe" "log"');
});

test("run installs through npm from a directory whose path has spaces", async () => {
  // Reproduces the two failures this path has hit on Windows: spawning the
  // npm.cmd shim without a shell (EINVAL), and losing %~dp0 to a quoted name.
  const root = await mkdtemp(join(tmpdir(), "noderyx run "));
  try {
    const cwd = join(root, "a project");
    await mkdir(cwd);
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "probe", version: "1.0.0", private: true }));
    // --version needs no registry, but still executes the shim end to end.
    await run("npm", ["--version"], { cwd, stdio: "ignore" });
    await run("npm", ["install", "--no-audit", "--no-fund", "--offline"], { cwd, stdio: "ignore" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project profiles tune generated production defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "noderyx-profile-"));
  try {
    const cli = fileURLToPath(new URL("../framework/cli.js", import.meta.url));
    const result = spawnSync(process.execPath, [cli, "new", "market", "--profile=trading", "--no-install"], {
      cwd: root,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    const environment = await readFile(join(root, "market", ".env.example"), "utf8");
    assert.match(environment, /^APP_PROFILE=trading$/m);
    assert.match(environment, /^CACHE_MAX_ITEMS=4096$/m);
    assert.match(environment, /^RATE_LIMIT_MAX=1200$/m);
    const readme = await readFile(join(root, "market", "README.md"), "utf8");
    assert.match(readme, /Trading platform/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
