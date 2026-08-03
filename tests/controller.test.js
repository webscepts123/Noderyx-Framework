import test from "node:test";
import assert from "node:assert/strict";
import { Controller } from "../framework/controller.js";

test("controller handle executes a Node.js controller action", async () => {
  class StatusController extends Controller {
    async show() {
      return this.json({ id: this.params.id });
    }
  }

  let response;
  const handler = StatusController.handle("show");
  await handler({
    params: { id: "42" },
    json: (data, status) => {
      response = { data, status };
    }
  });

  assert.deepEqual(response, { data: { id: "42" }, status: 200 });
});
