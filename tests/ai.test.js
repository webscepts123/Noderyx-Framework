import assert from "node:assert/strict";
import test from "node:test";
import { ai, AIError } from "../framework/index.js";

test("AI client creates a Responses API request and normalizes output", async () => {
  let request;
  const client = ai({ enabled: true, apiKey: "test-key", model: "gpt-test", fetch: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ id: "resp_1", model: "gpt-test", output_text: "A useful answer", usage: { total_tokens: 12 } }), { status: 200 });
  } });
  const result = await client.generate("Shape this idea", { previousResponseId: "resp_0" });
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.options.headers.authorization, "Bearer test-key");
  assert.equal(request.body.previous_response_id, "resp_0");
  assert.equal(request.body.store, false);
  assert.equal(result.text, "A useful answer");
});

test("AI client is safe when disabled and validates input locally", async () => {
  const client = ai({ enabled: false });
  await assert.rejects(client.generate("hello"), (error) => error instanceof AIError && error.code === "ai_disabled");
  await assert.rejects(client.generate("  "), (error) => error instanceof AIError && error.code === "empty_input");
});

test("AI client creates a Claude Messages request and normalizes output", async () => {
  let request;
  const client = ai({ provider: "claude", enabled: true, apiKey: "test-key", instructions: "Be honest.", fetch: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      id: "msg_1",
      model: "claude-opus-5",
      stop_reason: "end_turn",
      content: [{ type: "thinking", thinking: "" }, { type: "text", text: "A useful answer" }],
      usage: { input_tokens: 10, output_tokens: 4 }
    }), { status: 200 });
  } });
  const result = await client.generate("Shape this idea", { verbosity: "low", reasoningEffort: "high" });
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.options.headers["x-api-key"], "test-key");
  assert.equal(request.options.headers["anthropic-version"], "2023-06-01");
  assert.equal(request.body.model, "claude-opus-5");
  assert.deepEqual(request.body.messages, [{ role: "user", content: "Shape this idea" }]);
  assert.deepEqual(request.body.thinking, { type: "adaptive" });
  assert.deepEqual(request.body.output_config, { effort: "high" });
  assert.equal(request.body.fallbacks, "default");
  assert.match(request.body.system, /^Be honest\. /);
  assert.equal(result.text, "A useful answer");
  assert.equal(result.stopReason, "end_turn");
});

test("Claude requests disable thinking on effort none and reject OpenAI-only options", async () => {
  let body;
  const client = ai({ provider: "anthropic", enabled: true, apiKey: "test-key", reasoningEffort: "none", fallbacks: false, fetch: async (url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ id: "msg_2", content: [{ type: "text", text: "ok" }] }), { status: 200 });
  } });
  await client.generate("hello", { history: [{ role: "user", content: "earlier" }, { role: "assistant", content: "reply" }] });
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal("output_config" in body, false);
  assert.equal("fallbacks" in body, false);
  assert.equal(body.messages.length, 3);
  await assert.rejects(
    client.generate("hello", { previousResponseId: "msg_1" }),
    (error) => error instanceof AIError && error.code === "unsupported_option"
  );
});

test("Claude refusals and errors surface as AIError", async () => {
  const refusing = ai({ provider: "anthropic", enabled: true, apiKey: "test-key", fetch: async () => new Response(JSON.stringify({ id: "msg_3", stop_reason: "refusal", content: [] }), { status: 200 }) });
  await assert.rejects(refusing.generate("hello"), (error) => error instanceof AIError && error.code === "refusal");

  const failing = ai({ provider: "anthropic", enabled: true, apiKey: "never-show-this", fetch: async () => new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "Try later" } }), { status: 429 }) });
  await assert.rejects(failing.generate("hello"), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.code, "rate_limit_error");
    assert.equal(error.message.includes("never-show-this"), false);
    return true;
  });
});

test("AI client rejects an unknown provider before calling out", async () => {
  const client = ai({ provider: "gemini", enabled: true, apiKey: "test-key", fetch: async () => { throw new Error("must not be called"); } });
  await assert.rejects(client.generate("hello"), (error) => error instanceof AIError && error.code === "unsupported_provider");
});

test("AI client maps provider failures without exposing credentials", async () => {
  const client = ai({ enabled: true, apiKey: "never-show-this", fetch: async () => new Response(JSON.stringify({ error: { code: "rate_limit", message: "Try later" } }), { status: 429 }) });
  await assert.rejects(client.generate("hello"), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.code, "rate_limit");
    assert.equal(error.message.includes("never-show-this"), false);
    return true;
  });
});
