import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatQaReport, inspectProject } from "../framework/qa.js";

async function project() {
  const root = await mkdtemp(join(tmpdir(), "noderyx-qa-"));
  await mkdir(join(root, "public"), { recursive: true });
  await mkdir(join(root, "resources/views"), { recursive: true });
  await mkdir(join(root, "resources/mobile"), { recursive: true });
  await writeFile(join(root, "package.json"), "{}");
  await writeFile(join(root, "noderyx.config.js"), "export default {}");
  await writeFile(join(root, "public/cool.css"), "* { box-sizing: border-box }");
  await writeFile(join(root, ".env"), "APP_KEY=test");
  return root;
}

test("QA inspection catches syntax, accessibility, responsive, and link issues", async () => {
  const root = await project();
  await writeFile(join(root, "resources/views/home.noderframe"), `html\n  body\n    img src="/public/photo.png"\n    a href="/missing"`);
  await writeFile(join(root, "resources/mobile/home.noderframe"), `main\n   h1 "Bad indent"`);
  const report = await inspectProject({ native: { views: "resources/mobile" } }, { root });
  const codes = report.issues.map((issue) => issue.code);
  assert.ok(codes.includes("viewport"));
  assert.ok(codes.includes("page-title"));
  assert.ok(codes.includes("image-alt"));
  assert.ok(codes.includes("view-link"));
  assert.ok(codes.includes("template-syntax"));
  assert.equal(report.ok, false);
  assert.match(formatQaReport(report), /Result: \d+ error\(s\), \d+ warning\(s\)/);
});

test("QA inspection accepts healthy web and native views", async () => {
  const root = await project();
  await writeFile(join(root, "resources/views/home.noderframe"), `html\n  head\n    meta name="viewport" content="width=device-width, initial-scale=1"\n    title "Home"\n  body\n    main\n      h1 "Home"`);
  await writeFile(join(root, "resources/mobile/home.noderframe"), `main.cool-mobile-content\n  h1 "Mobile"`);
  const report = await inspectProject({ native: { views: "resources/mobile" } }, { root });
  assert.equal(report.ok, true);
  assert.deepEqual(report.counts, { errors: 0, warnings: 0 });
});
