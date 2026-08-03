import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { noderyx } from "../framework/index.js";

async function renderedPage(environment) {
  const root = await mkdtemp(join(tmpdir(), "noderyx-live-"));
  const views = join(root, "views");
  await mkdir(views);
  await writeFile(join(views, "home.noderframe"), "html\n  body\n    h1 \"Live\"\n");
  const app = noderyx({ views, public: join(root, "public"), environment, security: { csrf: false, session: false } });
  app.get("/", ({ render }) => render("home"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((ready) => server.once("listening", ready));
  try {
    return await (await fetch(`http://127.0.0.1:${server.address().port}`)).text();
  } finally {
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  }
}

test("development pages receive the live reload client automatically", async () => {
  assert.match(await renderedPage("development"), /\/public\/untitled-live\.js/);
});

test("production pages do not receive the live reload client", async () => {
  assert.doesNotMatch(await renderedPage("production"), /untitled-live\.js/);
});
