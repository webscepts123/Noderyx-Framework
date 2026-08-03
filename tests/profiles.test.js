import assert from "node:assert/strict";
import test from "node:test";
import { solutionProfile, solutionProfiles } from "../framework/profiles.js";

test("solution profiles cover the supported project types", () => {
  assert.deepEqual(solutionProfiles, ["saas", "trading", "blog", "ecommerce", "static", "enterprise"]);
  for (const name of solutionProfiles) {
    const profile = solutionProfile(name);
    assert.equal(profile.name, name);
    assert.ok(profile.cache.maxItems > 0);
    assert.ok(profile.security.bodyLimit > 0);
  }
});

test("solution profiles accept useful aliases and reject invalid names", () => {
  assert.equal(solutionProfile("e-commerce").name, "ecommerce");
  assert.equal(solutionProfile("shop").name, "ecommerce");
  assert.throws(() => solutionProfile("unknown"), /Choose: saas, trading, blog/);
});
