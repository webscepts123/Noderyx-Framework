import test from "node:test";
import assert from "node:assert/strict";
import { compile } from "../framework/compiler.js";

test("compiles nested Untitled markup and interpolates escaped data", () => {
  const html = compile(`html
  body
    h1.title "Hello {{user.name}}"
    input type="email"`, { user: { name: "<Ada>" } });

  assert.match(html, /<h1 class="title">Hello &lt;Ada&gt;<\/h1>/);
  assert.match(html, /<input type="email">/);
  assert.match(html, /<\/body>/);
});

test("rejects invalid indentation", () => {
  assert.throws(() => compile("html\n   body"), /indentation/);
});
