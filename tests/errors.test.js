import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { noderyx } from "../framework/index.js";

test("renders custom status pages and classifies application and database errors", async (context) => {
  const app = noderyx({
    views: fileURLToPath(new URL("../resources/views", import.meta.url)),
    public: fileURLToPath(new URL("../public", import.meta.url))
  });
  app.get("/forbidden", ({ abort }) => abort(403, "Admins only"));
  app.get("/broken", () => { throw new Error("Function exploded"); });
  app.get("/database", () => {
    const error = new Error("Database connection failed");
    error.code = "ECONNREFUSED";
    throw error;
  });
  app.get("/api/data", ({ json }) => json({ framework: "Noderyx", healthy: true }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  for (const [path, status, text] of [
    ["/missing", 404, "Page not found"],
    ["/forbidden", 403, "Admins only"],
    ["/broken", 500, "Something went wrong"],
    ["/database", 502, "Service unavailable"]
  ]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, status);
    assert.match(await response.text(), new RegExp(text));
  }

  const browserResponse = await fetch(`${origin}/api/data`, {
    headers: { Accept: "text/html" }
  });
  assert.match(browserResponse.headers.get("content-type"), /^text\/html/);
  assert.match(await browserResponse.text(), /JSON Explorer/);

  const apiResponse = await fetch(`${origin}/api/data`, {
    headers: { Accept: "application/json" }
  });
  assert.match(apiResponse.headers.get("content-type"), /^application\/json/);
  assert.deepEqual(await apiResponse.json(), { framework: "Noderyx", healthy: true });
});

test("a required missing APP_KEY renders an actionable bootstrap error", async (context) => {
  const app = noderyx({
    requireAppKey: true,
    environment: "development",
    views: fileURLToPath(new URL("../resources/views", import.meta.url)),
    public: fileURLToPath(new URL("../public", import.meta.url)),
    security: { appKey: "" }
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  const html = await response.text();
  assert.equal(response.status, 500);
  assert.match(html, /No APP_KEY detected/);
  assert.match(html, /npx noderyx spark:key/);
  assert.match(html, /Copy command/);

  const css = await fetch(`http://127.0.0.1:${server.address().port}/public/cool.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /^text\/css/);
  assert.match(await css.text(), /\.ny-debug-body/);

  const script = await fetch(`http://127.0.0.1:${server.address().port}/public/error-debug.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /^text\/javascript/);
});

test("the error log names the request and keeps stacks for real failures", async (context) => {
  const app = noderyx({
    views: fileURLToPath(new URL("../resources/views", import.meta.url)),
    public: fileURLToPath(new URL("../public", import.meta.url))
  });
  app.get("/broken", () => { throw new Error("Function exploded"); });

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const lines = [];
  const original = console.error;
  console.error = (...parts) => lines.push(parts);
  try {
    await fetch(`${origin}/settings/profile`);
    await fetch(`${origin}/broken`);
  } finally {
    console.error = original;
  }

  // A 404 that says only "Page not found" leaves nobody able to act on it.
  const [notFound, failed] = lines;
  assert.equal(notFound.length, 1, "a deliberate 404 logs no stack trace");
  assert.match(notFound[0], /^\[Noderyx 404\] GET \/settings\/profile — Page not found$/);

  assert.match(failed[0], /^\[Noderyx 500\] GET \/broken$/);
  assert.equal(failed[1].message, "Function exploded");
});
