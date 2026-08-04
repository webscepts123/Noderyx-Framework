import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
