/**
 * Open Hax provider extension for eta-mu.
 *
 * This registers the open-hax family of providers for use with the
 * eta-mu GitHub bot. It uses environment variables for configuration.
 *
 * Required env vars:
 * - OPEN_HAX_OPENAI_PROXY_URL: Base URL for Open Hax proxy (default: http://127.0.0.1:8789)
 * - OPEN_HAX_OPENAI_PROXY_AUTH_TOKEN: Auth token for Open Hax proxy
 *
 * Providers registered:
 * - open-hax: OpenAI Responses API compatible
 * - open-hax-responses: OpenAI Responses API compatible
 * - open-hax-completions: OpenAI Completions API compatible (includes glm-5)
 * - open-hax-compat: OpenAI Completions API compatible (compat models)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const GLM_5_MODEL = {
  id: "glm-5",
  name: "GLM 5",
  reasoning: false,
  input: ["text"] as ("text" | "image")[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 131072,
  maxTokens: 16384,
};

const GPT_5_MODELS = [
  {
    id: "gpt-5.4",
    name: "GPT 5.4",
    reasoning: true,
    input: ["text", "image"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 800000,
    maxTokens: 128000,
  },
  {
    id: "gpt-5.2",
    name: "GPT 5.2",
    reasoning: true,
    input: ["text", "image"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272000,
    maxTokens: 128000,
  },
];

export default function (pi: ExtensionAPI): void {
  const baseUrl = (
    process.env.OPEN_HAX_OPENAI_PROXY_URL ??
    process.env.OPEN_HAX_PROXY_URL ??
    "http://127.0.0.1:8789"
  ).replace(/\/+$/u, "");

  const apiBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;

  const authToken =
    process.env.OPEN_HAX_OPENAI_PROXY_AUTH_TOKEN ??
    process.env.OPEN_HAX_PROXY_AUTH_TOKEN ??
    process.env.OPEN_HAX_AUTH_TOKEN ??
    "";

  if (!authToken) {
    console.warn("[open-hax-provider] No auth token configured. Set OPEN_HAX_OPENAI_PROXY_AUTH_TOKEN.");
  }

  // Primary provider - OpenAI Completions API (includes glm-5 for compatibility)
  pi.registerProvider("open-hax", {
    baseUrl: apiBaseUrl,
    apiKey: authToken,
    api: "openai-completions",
    models: [...GPT_5_MODELS, GLM_5_MODEL],
  });

  // Completions API variant (includes glm-5)
  pi.registerProvider("open-hax-completions", {
    baseUrl: apiBaseUrl,
    apiKey: authToken,
    api: "openai-completions",
    models: [...GPT_5_MODELS, GLM_5_MODEL],
  });

  // Compat variant for models like glm-5, gemini, etc.
  pi.registerProvider("open-hax-compat", {
    baseUrl: apiBaseUrl,
    apiKey: authToken,
    api: "openai-completions",
    models: [
      GLM_5_MODEL,
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        reasoning: false,
        input: ["text", "image"] as ("text" | "image")[],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1048576,
        maxTokens: 65536,
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        reasoning: false,
        input: ["text", "image"] as ("text" | "image")[],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1048576,
        maxTokens: 65536,
      },
    ],
  });

  // Responses API variant
  pi.registerProvider("open-hax-responses", {
    baseUrl: apiBaseUrl,
    apiKey: authToken,
    api: "openai-responses",
    models: [...GPT_5_MODELS],
  });
}