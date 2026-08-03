import test from "node:test";
import assert from "node:assert/strict";
import { Model } from "../framework/model.js";

class User extends Model {
  static table = "users";
  static fillable = ["name", "email"];
}

test("model creates records using fillable fields", async () => {
  const calls = [];
  User.use({
    kind: "mysql",
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { insertId: 7 };
    }
  });

  const user = await User.create({
    name: "Ada",
    email: "ada@example.com",
    admin: true
  });

  assert.deepEqual(user, { name: "Ada", email: "ada@example.com", id: 7 });
  assert.match(calls[0].sql, /^INSERT INTO users \(name, email\)/);
  assert.deepEqual(calls[0].values, ["Ada", "ada@example.com"]);
});

test("model rejects unsafe table identifiers", () => {
  class Unsafe extends Model {
    static table = "users; DROP TABLE users";
  }
  assert.throws(() => Unsafe.tableName, /Unsafe database identifier/);
});
