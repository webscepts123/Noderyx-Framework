import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { parseMNodeFrame } from "./mnoderframe.js";

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function nodeSource(node) {
  if (typeof node === "string") return node;
  const attrs = Object.entries(node.attrs ?? {})
    .map(([name, value]) => ` ${name}="${String(value).replaceAll('"', "&quot;")}"`)
    .join("");
  const children = (node.children ?? []).map(nodeSource).join("");
  return `<${node.tag}${attrs}>${children}</${node.tag}>`;
}

/** Load, validate, and execute a compiled .mnoderframe document. */
export async function loadMNodeFrame(file) {
  const payload = parseMNodeFrame(await readFile(file, "utf8"));
  return {
    ...payload,
    render: () => payload.document.map(nodeSource).join("")
  };
}

function safeFile(root, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes("\0")) return null;
  const target = resolve(root, `.${sep}${decoded.replace(/^\/+/, "")}`);
  return target === root || !relative(root, target).startsWith("..") ? target : null;
}

/** Run a .mnoderframe entry through Noderyx's lightweight local runtime. */
export function runMNodeFrame(entry, { port = 4173, host = "127.0.0.1" } = {}) {
  const entryFile = resolve(entry);
  const root = resolve(entryFile, "..");
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${host}:${port}`);
      let requested = url.pathname === "/" ? entryFile : safeFile(root, url.pathname);
      if (requested && !extname(requested) && !(await stat(requested).catch(() => null))?.isFile()) {
        requested = `${requested}.mnoderframe`;
      }
      if (!requested || !(await stat(requested).catch(() => null))?.isFile()) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        return response.end("404 Not found");
      }
      if (extname(requested) === ".mnoderframe") {
        const page = await loadMNodeFrame(requested);
        const output = page.render();
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-cache",
          "x-noderyx-format": "mnoderframe/1"
        });
        return response.end(output);
      }
      const body = await readFile(requested);
      response.writeHead(200, {
        "content-type": TYPES[extname(requested)] ?? "application/octet-stream",
        "content-length": body.length
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(`Invalid .mnoderframe: ${error.message}`);
    }
  });
  server.listen(port, host);
  return server;
}
