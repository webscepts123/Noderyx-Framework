# AI in Noderyx

Noderyx includes an optional, dependency-free AI client for server-side features. It talks to OpenAI's Responses API or Anthropic's Messages API (Claude), keeps credentials out of browser code, and is disabled until you opt in.

## Setup

Copy `.env.example` to `.env`, then set one provider block.

OpenAI:

```env
AI_ENABLED=true
AI_PROVIDER=openai
OPENAI_API_KEY=your_server_key
OPENAI_MODEL=gpt-5.6-sol
```

Claude:

```env
AI_ENABLED=true
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_server_key
ANTHROPIC_MODEL=claude-opus-5
AI_MAX_OUTPUT_TOKENS=4000
```

`AI_PROVIDER=claude` is accepted as an alias for `anthropic`. Restart the server after changing `.env`. Never commit `.env`, print the key, put it in a view, or prefix it with a browser-exposed variable name.

The welcome page includes an AI idea studio at `/#ai-studio`. With AI disabled it remains visible and explains that setup is needed; with AI enabled it calls `POST /api/ai/ideas` through your own server.

## Environment reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_ENABLED` | `false` | Explicit feature switch. |
| `AI_PROVIDER` | `openai` | Provider adapter: `openai` or `anthropic` (`claude`). |
| `AI_REASONING_EFFORT` | `medium` | `none`, `low`, `medium`, `high`, `xhigh`, or `max`. |
| `AI_VERBOSITY` | `medium` | `low`, `medium`, or `high`. |
| `AI_MAX_OUTPUT_TOKENS` | `1200` (`4000` for Claude) | Output ceiling for cost and latency control. |
| `AI_INPUT_LIMIT` | `8000` | Maximum prompt characters accepted by the client. |
| `AI_TIMEOUT_MS` | `30000` (`60000` for Claude) | Provider request timeout. |
| `AI_STORE` | `false` | Whether the provider may retain Responses API state. OpenAI only. |
| `AI_INSTRUCTIONS` | concise default | Application-wide behavior instructions. |

Used when `AI_PROVIDER=openai`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | empty | Secret server credential. |
| `OPENAI_MODEL` | `gpt-5.6-sol` | Model used by default. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | API base URL, useful for compatible gateways. |

Used when `AI_PROVIDER=anthropic`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | empty | Secret server credential, sent as `x-api-key`. |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Model used by default. |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com/v1` | API base URL. |
| `ANTHROPIC_FALLBACKS` | `true` | Let Anthropic answer a declined request on a fallback model instead of returning a refusal. |

## Choosing a model

`gpt-5.6-sol` is the OpenAI flagship default. Consider `gpt-5.6-terra` when cost and intelligence need a more balanced tradeoff, or `gpt-5.6-luna` for high-volume, cost-sensitive work.

`claude-opus-5` is the Claude default and the strongest option for coding and long-running agentic work. Use `claude-sonnet-5` when you want near-Opus quality at lower cost, or `claude-haiku-4-5` for high-volume, latency-sensitive work. Model IDs are complete as written — never append a date suffix.

## Provider differences to know

- **Thinking counts against the output budget.** Claude thinks by default, and those tokens come out of `AI_MAX_OUTPUT_TOKENS`. A budget tuned for OpenAI can truncate a Claude answer mid-sentence. Raise it, or set `AI_REASONING_EFFORT=none` to turn thinking off for short answers.
- **`AI_REASONING_EFFORT` maps to Claude's effort levels.** `none` disables thinking; every other value is passed through as the effort level with adaptive thinking on. Effort is the main quality/cost dial — `low` and `medium` are strong on Claude, and `xhigh` suits hard coding work.
- **`AI_VERBOSITY` becomes a system instruction on Claude**, which has no verbosity parameter. `low` and `high` append a length hint to `AI_INSTRUCTIONS`; `medium` adds nothing.
- **Claude is stateless.** `previousResponseId` is an OpenAI feature and throws an `unsupported_option` error on Claude. Pass earlier turns as `history` instead.
- **`AI_STORE` is ignored on Claude.** There is no server-side response state to retain.
- **`safetyIdentifier` still works** — it is sent as `safety_identifier` on OpenAI and `metadata.user_id` on Claude.
- **A declined request raises `AIError` with code `refusal`.** With `ANTHROPIC_FALLBACKS=true` (the default) Anthropic first retries the request on a fallback model, so a refusal reaching your code means the whole chain declined.

## Use AI in a route

```js
app.post("/api/summarize", async ({ body, service, json }) => {
  const result = await service("ai").generate(body.text, {
    instructions: "Summarize this text in three plain-language bullets.",
    reasoningEffort: "low",
    verbosity: "low"
  });
  return json({ summary: result.text, responseId: result.id });
});
```

In a controller, use `this.service("ai")`. Continue a conversation by passing `{ previousResponseId: first.id }` on OpenAI, or the prior turns on Claude:

```js
const second = await service("ai").generate("And in one sentence?", {
  history: [
    { role: "user", content: "Explain event loops." },
    { role: "assistant", content: first.text }
  ]
});
```

## Production checklist

- Keep the API key on the server and rotate it if exposed.
- Authenticate AI routes and add a tighter per-user rate limit for expensive actions.
- Validate input, cap input/output sizes, and set timeouts.
- Tell users when content is AI-generated and provide a way to correct it.
- Require confirmation before AI performs destructive or external actions.
- Pass a stable pseudonymous `safetyIdentifier` for signed-in users, never a direct personal identifier.
- Use mocked `fetch` in tests. The Noderyx test suite never calls a live provider.

Official references: OpenAI — [latest model guidance](https://developers.openai.com/api/docs/guides/latest-model), [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), and [model catalog](https://developers.openai.com/api/docs/models). Anthropic — [Messages API](https://platform.claude.com/docs/en/api/messages), [model overview](https://platform.claude.com/docs/en/about-claude/models/overview), and [effort](https://platform.claude.com/docs/en/build-with-claude/effort).
