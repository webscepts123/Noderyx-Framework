import assert from "node:assert/strict";
import test from "node:test";
import { connect } from "../framework/database.js";

function captureConsole() {
  const lines = [];
  const original = { warn: console.warn, error: console.error };
  console.warn = (...parts) => lines.push(parts.join(" "));
  console.error = (...parts) => lines.push(parts.join(" "));
  return {
    lines,
    restore() {
      console.warn = original.warn;
      console.error = original.error;
    }
  };
}

test("the driver never receives the key that selected it", async () => {
  // mysql2 warns on unknown connection options and has said it will throw on
  // them, so `type` has to stop at connect(). Creating a pool opens no socket,
  // which is why this runs without a database.
  const capture = captureConsole();
  let database;
  try {
    database = await connect({
      type: "mysql",
      host: "127.0.0.1",
      port: 3306,
      user: "root",
      password: "",
      database: "noderyx_probe",
      connectionLimit: 2
    });
  } finally {
    capture.restore();
  }

  try {
    assert.deepEqual(capture.lines, [], "the driver reported a configuration problem");
    assert.equal(database.kind, "mysql");
  } finally {
    await database.close().catch(() => {});
  }
});

test("connect refuses a database type it cannot drive", async () => {
  await assert.rejects(connect({ type: "sqlite", host: "127.0.0.1" }), /Unsupported database type: sqlite/);
});

test("connect names the field a driver is missing", async () => {
  await assert.rejects(connect({ type: "mysql", host: "127.0.0.1" }), /Missing database configuration: user/);
});
