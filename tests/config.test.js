import test from "node:test";
import assert from "node:assert/strict";
import { envBoolean, envList, envNumber } from "../framework/config.js";

test("configuration helpers parse typed environment values", () => {
  process.env.NODERYX_TEST_BOOLEAN = "yes";
  process.env.NODERYX_TEST_NUMBER = "42";
  process.env.NODERYX_TEST_LIST = "one, two,three";
  try {
    assert.equal(envBoolean("NODERYX_TEST_BOOLEAN"), true);
    assert.equal(envNumber("NODERYX_TEST_NUMBER", 0), 42);
    assert.deepEqual(envList("NODERYX_TEST_LIST"), ["one", "two", "three"]);
  } finally {
    delete process.env.NODERYX_TEST_BOOLEAN;
    delete process.env.NODERYX_TEST_NUMBER;
    delete process.env.NODERYX_TEST_LIST;
  }
});

test("configuration helpers use defaults and reject invalid values", () => {
  assert.equal(envBoolean("NODERYX_TEST_MISSING", true), true);
  assert.equal(envNumber("NODERYX_TEST_MISSING", 3000), 3000);
  assert.deepEqual(envList("NODERYX_TEST_MISSING", ["default"]), ["default"]);
  process.env.NODERYX_TEST_INVALID = "sometimes";
  assert.throws(() => envBoolean("NODERYX_TEST_INVALID"), /true or false/);
  process.env.NODERYX_TEST_INVALID = "many";
  assert.throws(() => envNumber("NODERYX_TEST_INVALID", 0), /must be a number/);
  delete process.env.NODERYX_TEST_INVALID;
});
