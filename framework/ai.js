const PROVIDERS = {
  openai: { baseURL: "https://api.openai.com/v1", model: "gpt-5.6-sol", keyName: "OPENAI_API_KEY" },
  anthropic: { baseURL: "https://api.anthropic.com/v1", model: "claude-opus-5", keyName: "ANTHROPIC_API_KEY" }
};
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_FALLBACK_BETA = "server-side-fallback-2026-07-01";
const ALLOWED_REASONING = new Set(["none", "low", "medium", "high", "xhigh", "max"]);
const ALLOWED_VERBOSITY = new Set(["low", "medium", "high"]);
// Claude has no verbosity parameter, so it is expressed as a system instruction.
const VERBOSITY_HINTS = { low: "Answer in as few words as the question allows.", high: "Give a thorough answer with the relevant detail." };

export class AIError extends Error {
  constructor(message, { status = 500, code = "ai_error", cause } = {}) {
    super(message, { cause });
    this.name = "AIError";
    this.status = status;
    this.code = code;
  }
}

function normalizeProvider(value) {
  const name = String(value ?? "openai").trim().toLowerCase();
  return name === "claude" ? "anthropic" : name;
}

function outputText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  return (response?.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text).join("");
}

function messageText(response) {
  return (response?.content ?? [])
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text).join("");
}

function cleanBaseUrl(value, fallback) {
  return String(value ?? fallback).replace(/\/+$/, "");
}

/** A small, server-only client for OpenAI's Responses API and Anthropic's Messages API. */
export class AIClient {
  constructor(options = {}) {
    this.provider = normalizeProvider(options.provider);
    const defaults = PROVIDERS[this.provider] ?? PROVIDERS.openai;
    this.enabled = options.enabled ?? Boolean(options.apiKey);
    this.apiKey = options.apiKey;
    this.baseURL = cleanBaseUrl(options.baseURL, defaults.baseURL);
    this.model = options.model ?? defaults.model;
    this.reasoningEffort = options.reasoningEffort ?? "medium";
    this.verbosity = options.verbosity ?? "medium";
    this.maxOutputTokens = options.maxOutputTokens ?? 1200;
    this.inputLimit = options.inputLimit ?? 8000;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.store = options.store ?? false;
    this.fallbacks = options.fallbacks ?? true;
    this.instructions = options.instructions;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async generate(input, options = {}) {
    const prompt = String(input ?? "").trim();
    if (!prompt) throw new AIError("Write a message before asking AI.", { status: 422, code: "empty_input" });
    if (prompt.length > this.inputLimit) {
      throw new AIError(`AI input cannot exceed ${this.inputLimit} characters.`, { status: 422, code: "input_too_large" });
    }
    if (!this.enabled) throw new AIError("AI is not enabled for this application.", { status: 503, code: "ai_disabled" });
    const defaults = PROVIDERS[this.provider];
    if (!defaults) throw new AIError(`Unsupported AI provider: ${this.provider}`, { status: 500, code: "unsupported_provider" });
    if (!this.apiKey) throw new AIError(`The server is missing ${defaults.keyName}.`, { status: 503, code: "missing_api_key" });
    if (typeof this.fetch !== "function") throw new AIError("This runtime does not provide fetch.");

    const reasoning = options.reasoningEffort ?? this.reasoningEffort;
    const verbosity = options.verbosity ?? this.verbosity;
    if (!ALLOWED_REASONING.has(reasoning)) throw new TypeError(`Invalid reasoning effort: ${reasoning}`);
    if (!ALLOWED_VERBOSITY.has(verbosity)) throw new TypeError(`Invalid AI verbosity: ${verbosity}`);

    const request = this.provider === "anthropic"
      ? this.#anthropicRequest(prompt, options, reasoning, verbosity)
      : this.#openaiRequest(prompt, options, reasoning, verbosity);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);
    try {
      const response = await this.fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.payload),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new AIError(data?.error?.message ?? "The AI provider could not complete the request.", {
          status: response.status >= 500 ? 502 : response.status,
          code: data?.error?.code ?? data?.error?.type ?? "provider_error"
        });
      }
      if (data.stop_reason === "refusal") {
        throw new AIError("The AI provider declined this request.", { status: 422, code: "refusal" });
      }
      const text = this.provider === "anthropic" ? messageText(data) : outputText(data);
      return {
        id: data.id,
        text,
        model: data.model ?? request.payload.model,
        usage: data.usage ?? null,
        stopReason: data.stop_reason ?? null,
        raw: data
      };
    } catch (error) {
      if (error instanceof AIError) throw error;
      if (error?.name === "AbortError") throw new AIError("The AI request timed out.", { status: 504, code: "timeout", cause: error });
      throw new AIError("The AI provider is temporarily unavailable.", { status: 502, code: "network_error", cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

  #openaiRequest(prompt, options, reasoning, verbosity) {
    const payload = {
      model: options.model ?? this.model,
      input: prompt,
      instructions: options.instructions ?? this.instructions,
      reasoning: { effort: reasoning },
      text: { verbosity },
      max_output_tokens: options.maxOutputTokens ?? this.maxOutputTokens,
      store: options.store ?? this.store
    };
    if (options.previousResponseId) payload.previous_response_id = options.previousResponseId;
    if (options.safetyIdentifier) payload.safety_identifier = options.safetyIdentifier;
    for (const key of Object.keys(payload)) if (payload[key] == null) delete payload[key];
    return {
      url: `${this.baseURL}/responses`,
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      payload
    };
  }

  #anthropicRequest(prompt, options, reasoning, verbosity) {
    if (options.previousResponseId) {
      throw new AIError("Claude is stateless. Pass earlier turns as `history` instead of `previousResponseId`.", {
        status: 400,
        code: "unsupported_option"
      });
    }
    const system = [options.instructions ?? this.instructions, VERBOSITY_HINTS[verbosity]].filter(Boolean).join(" ");
    const payload = {
      model: options.model ?? this.model,
      max_tokens: options.maxOutputTokens ?? this.maxOutputTokens,
      messages: [...(options.history ?? []), { role: "user", content: prompt }]
    };
    if (system) payload.system = system;
    // Thinking tokens count toward max_tokens, so "none" keeps short answers affordable.
    if (reasoning === "none") payload.thinking = { type: "disabled" };
    else {
      payload.thinking = { type: "adaptive" };
      payload.output_config = { effort: reasoning };
    }
    if (options.safetyIdentifier) payload.metadata = { user_id: options.safetyIdentifier };
    const headers = {
      "x-api-key": this.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json"
    };
    // Safety classifiers can decline a request; a fallback model answers it instead.
    if (options.fallbacks ?? this.fallbacks) {
      payload.fallbacks = "default";
      headers["anthropic-beta"] = ANTHROPIC_FALLBACK_BETA;
    }
    return { url: `${this.baseURL}/messages`, headers, payload };
  }
}

export function ai(options) {
  return new AIClient(options);
}
