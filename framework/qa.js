import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { parse } from "./compiler.js";
import { renderNative } from "./renderers/native.js";

const VIEW_EXTENSIONS = new Set([".noderframe", ".untitled"]);

async function filesBelow(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(target));
    else if (entry.isFile() && VIEW_EXTENSIONS.has(extname(target))) files.push(target);
  }
  return files;
}

function routeFor(file, root) {
  const path = relative(root, file).replaceAll("\\", "/");
  const route = path.slice(0, -extname(path).length);
  return route === "home" || route === "index" ? "" : route;
}

function lineOf(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function inspectMarkup(source, file, routes, mobile = false) {
  const issues = [];
  const add = (severity, code, line, message, fix) => issues.push({ severity, code, file, line, message, fix });

  try {
    const tree = parse(source);
    if (mobile) {
      const rendered = renderNative(tree, { route: "qa", scroll: true });
      for (const note of rendered.notes) add("error", "native-unsupported", 1, note, "Use an element supported by the native renderer.");
    }
  } catch (error) {
    const line = Number(error.message.match(/Line (\d+)/)?.[1] ?? 1);
    add("error", "template-syntax", line, error.message, "Correct the template syntax or indentation.");
    return issues;
  }

  if (!mobile) {
    if (!/^\s*meta\s+name="viewport"/m.test(source)) add("warning", "viewport", 1, "Page has no responsive viewport metadata.", "Add meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" inside head.");
    if (!/^\s*title(?:\s|$)/m.test(source)) add("warning", "page-title", 1, "Page has no title.", "Add a meaningful title inside head.");
  }

  for (const match of source.matchAll(/^\s*img\b(.*)$/gm)) {
    if (!/\balt=/.test(match[1])) add("warning", "image-alt", lineOf(source, match.index), "Image has no alt text.", "Add alt=\"...\"; use alt=\"\" for decorative images.");
  }
  for (const match of source.matchAll(/^\s*(?:a|button)\b(.*)$/gm)) {
    if (!/"[^"\n]+"\s*$/.test(match[1]) && !/\baria-label=/.test(match[1])) {
      add("warning", "control-name", lineOf(source, match.index), "Interactive control may have no accessible name.", "Add visible text or aria-label.");
    }
  }
  for (const match of source.matchAll(/\bhref="\/([^"?#]*)/g)) {
    const target = match[1].replace(/\/$/, "");
    if (target.startsWith("public/") || target.startsWith("api/") || routes.has(target)) continue;
    add("warning", "view-link", lineOf(source, match.index), `Internal link /${target} has no matching view.`, "Create the view or verify that the server registers this route.");
  }
  return issues;
}

export async function inspectProject(config = {}, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const issues = [];
  const add = (severity, code, file, message, fix) => issues.push({ severity, code, file, line: 1, message, fix });
  for (const required of ["package.json", "noderyx.config.js", "public/cool.css"]) {
    if (!existsSync(join(root, required))) add("error", "missing-file", required, `Required file is missing: ${required}`, `Restore or create ${required}.`);
  }
  if (!existsSync(join(root, ".env"))) add("warning", "environment", ".env", "No local .env file was found.", "Copy .env.example to .env and generate APP_KEY.");

  const groups = [
    { kind: "web", directory: config.views ?? "resources/views", mobile: false },
    { kind: "native", directory: config.native?.views ?? "resources/mobile", mobile: true }
  ];
  const seen = new Set();
  let checkedFiles = 0;
  for (const group of groups) {
    const directory = resolve(root, group.directory);
    if (seen.has(directory)) continue;
    seen.add(directory);
    const files = await filesBelow(directory);
    if (!files.length) {
      add(group.mobile ? "warning" : "error", "missing-views", relative(root, directory), `No ${group.kind} views were found.`, `Add a .noderframe file under ${relative(root, directory)}.`);
      continue;
    }
    const routes = new Set(files.map((file) => routeFor(file, directory)));
    for (const file of files) {
      const display = relative(root, file).replaceAll("\\", "/");
      issues.push(...inspectMarkup(await readFile(file, "utf8"), display, routes, group.mobile));
      checkedFiles += 1;
    }
  }
  const counts = { errors: 0, warnings: 0 };
  for (const issue of issues) counts[issue.severity === "error" ? "errors" : "warnings"] += 1;
  return { ok: counts.errors === 0, root, checkedFiles, counts, issues };
}

export function formatQaReport(report) {
  const lines = [`Noderyx QA — ${report.checkedFiles} template${report.checkedFiles === 1 ? "" : "s"} checked`];
  if (!report.issues.length) lines.push("✓ No issues found.");
  for (const issue of report.issues) {
    const mark = issue.severity === "error" ? "✗" : "!";
    lines.push(`${mark} ${issue.severity.toUpperCase()} ${issue.code}  ${issue.file}:${issue.line}`);
    lines.push(`  ${issue.message}`);
    if (issue.fix) lines.push(`  Fix: ${issue.fix}`);
  }
  lines.push(`\nResult: ${report.counts.errors} error(s), ${report.counts.warnings} warning(s)`);
  return lines.join("\n");
}
