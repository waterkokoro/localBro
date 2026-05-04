/**
 * Preset list of AI providers / endpoints / models.
 *
 * The UI uses these to populate "Provider" and "Model" dropdowns in
 * Settings → AI. Selecting a provider fills in `baseUrl`, `protocol`
 * and a sensible default `model`, but every field remains freely
 * editable so users can point at self-hosted / gateway endpoints.
 */

export type Protocol = "openai" | "anthropic";

export interface ProviderPreset {
  /** Stable id persisted to settings (e.g. "deepseek"). */
  id: string;
  /** Display name (not translated; these are brand names). */
  label: string;
  /** Default base URL. */
  baseUrl: string;
  /** Wire protocol. `openai` = Chat Completions, `anthropic` = Messages API. */
  protocol: Protocol;
  /** Known model ids; first is the default. Users may type any string. */
  models: string[];
  /** Short free-text note surfaced in the Settings hint line. */
  note?: string;
}

/**
 * Provider catalogue. Ordered by expected popularity — the first entry
 * is OpenAI because it's still the de-facto default for OpenAI-compat
 * clients.
 */
export const PROVIDERS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    protocol: "openai",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o3-mini"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    protocol: "anthropic",
    models: [
      "claude-3-5-sonnet-latest",
      "claude-3-5-haiku-latest",
      "claude-3-opus-latest",
      "claude-sonnet-4-20250514",
    ],
    note: "Uses the native Messages API (x-api-key header).",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    protocol: "openai",
    models: [
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "deepseek-chat",
      "deepseek-reasoner",
    ],
    note: "Switch to the Anthropic endpoint below if your agent speaks Messages API.",
  },
  {
    id: "deepseek-anthropic",
    label: "DeepSeek (Anthropic)",
    baseUrl: "https://api.deepseek.com/anthropic",
    protocol: "anthropic",
    models: [
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "deepseek-chat",
      "deepseek-reasoner",
    ],
  },
  {
    id: "qwen",
    label: "Qwen (DashScope)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    protocol: "openai",
    models: [
      "qwen-plus",
      "qwen-turbo",
      "qwen-max",
      "qwen2.5-72b-instruct",
      "qwen2.5-coder-32b-instruct",
    ],
  },
  {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    baseUrl: "https://api.moonshot.cn/v1",
    protocol: "openai",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  },
  {
    id: "zhipu",
    label: "Zhipu GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    protocol: "openai",
    models: ["glm-4-plus", "glm-4-air", "glm-4-flash"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    protocol: "openai",
    models: [
      "openai/gpt-4o-mini",
      "anthropic/claude-3.5-sonnet",
      "deepseek/deepseek-chat",
      "qwen/qwen-2.5-72b-instruct",
    ],
    note: "Unified gateway — pick any upstream model using its slug.",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    protocol: "openai",
    models: ["llama3.1:8b", "qwen2.5:7b", "qwen2.5-coder:7b"],
    note: "Runs locally. Leave API key blank.",
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    baseUrl: "http://localhost:1234/v1",
    protocol: "openai",
    models: ["local-model"],
    note: "Runs locally. Model id can be any name LM Studio is serving.",
  },
  {
    id: "custom",
    label: "Custom",
    baseUrl: "",
    protocol: "openai",
    models: [],
    note: "Any OpenAI-compatible endpoint. Set the URL + model yourself.",
  },
];

export function findProvider(id: string | undefined | null): ProviderPreset | null {
  if (!id) return null;
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/** Best-effort guess when a user's saved config has no provider id
 * (e.g. upgraded from an earlier version). Matches on baseUrl prefix. */
export function guessProvider(baseUrl: string): ProviderPreset {
  const normalized = baseUrl.replace(/\/+$/, "");
  for (const p of PROVIDERS) {
    if (p.id === "custom") continue;
    if (p.baseUrl.replace(/\/+$/, "") === normalized) return p;
  }
  return PROVIDERS.find((p) => p.id === "custom")!;
}
