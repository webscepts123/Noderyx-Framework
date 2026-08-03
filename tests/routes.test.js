import test from "node:test";
import assert from "node:assert/strict";
import { NoderyxApp } from "../framework/app.js";
import { registerRoutes } from "../routes/index.js";

test("the route hub registers web, API, and system routes", () => {
  const app = registerRoutes(new NoderyxApp({ pwa: false, security: { csrf: false, session: false } }));

  assert.ok(app.router.match("GET", "/"));
  assert.ok(app.router.match("GET", "/api/status"));
  assert.ok(app.router.match("GET", "/health"));
  assert.ok(app.router.match("GET", "/robots.txt"));
  assert.equal(app.router.match("GET", "/missing"), null);
});
