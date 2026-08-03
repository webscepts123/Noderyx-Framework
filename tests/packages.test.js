import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { definePackage, loadPackages } from "../framework/packages.js";

test("definePackage validates package providers", () => {
  assert.equal(definePackage({ name: "demo" }).name, "demo");
  assert.throws(() => definePackage({}), /requires a name/);
  assert.throws(() => definePackage({ name: "demo", register: true }), /register/);
});

test("packages register in order and boot after registration", async () => {
  const events = [];
  const routes = [];
  const app = { get: (path) => routes.push(path) };
  const providers = [
    {
      name: "first",
      register({ app: target, options }) {
        events.push(`register:${options.value}`);
        target.get("/first");
      },
      boot: () => events.push("boot:first")
    },
    {
      name: "second",
      register: () => events.push("register:second"),
      boot: () => events.push("boot:second")
    }
  ];
  const loaded = await loadPackages(app, [
    { provider: providers[0], options: { value: "first" } },
    providers[1]
  ], { discover: false });

  assert.deepEqual(loaded.map((item) => item.name), ["first", "second"]);
  assert.deepEqual(routes, ["/first"]);
  assert.deepEqual(events, ["register:first", "register:second", "boot:first", "boot:second"]);
});

test("local packages are discovered from their package manifests", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "noderyx-packages-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "packages", "local-demo", "src");
  await mkdir(directory, { recursive: true });
  await writeFile(join(root, "packages", "local-demo", "package.json"), JSON.stringify({
    name: "local-demo",
    type: "module",
    main: "src/index.js"
  }));
  await writeFile(join(directory, "index.js"), "export default { name: 'local-demo', register({ app }) { app.get('/local-demo'); } };\n");
  const routes = [];
  const loaded = await loadPackages({ get: (path) => routes.push(path) }, [], { root });
  assert.deepEqual(loaded.map((item) => item.name), ["local-demo"]);
  assert.deepEqual(routes, ["/local-demo"]);
});

test("duplicate and disabled packages are handled safely", async () => {
  const app = { get() {} };
  const provider = { name: "same" };
  await assert.rejects(
    () => loadPackages(app, [provider, provider], { discover: false }),
    /loaded twice/
  );
  assert.deepEqual(
    await loadPackages(app, [{ provider, enabled: false }], { discover: false }),
    []
  );
});
