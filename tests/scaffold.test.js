import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
