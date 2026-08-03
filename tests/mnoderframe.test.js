import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileMNodeFrame } from "../framework/mnoderframe.js";
import { loadMNodeFrame } from "../framework/mnoderframe-runner.js";

test("the mnoderframe runner loads and executes compiled mobile pages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mnoderframe-"));
  const file = join(directory, "home.mnoderframe");
  await writeFile(file, compileMNodeFrame("<!doctype html><html><body><main><h1>Mobile</h1></main></body></html>", "home"));
  const page = await loadMNodeFrame(file);
  assert.match(page.generated, /Do not edit/);
  assert.equal(page.route, "home");
  assert.match(page.render(), /<h1>Mobile<\/h1>/);
});
