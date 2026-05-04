/**
 * Minimal OpenAI-compatible Chat Completions client.
 * Intentionally plain `fetch` — compatible with any endpoint that
 * follows `POST {baseUrl}/chat/completions` with the standard schema.
 */

import type { AiConfig } from "./policy";
import type { OpenAiTool } from "./tools";

export type Role = "system" | "user" | "assistant" | "tool";

/** OpenAI ChatML message. `tool_calls` and `tool_call_id` appear for tool I/O. */
export interface ChatMessage {
  role: Role;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** Raw JSON string as returned by the model. */
    arguments: string;
  };
}

export interface ChatCompletion {
  id: string;
  choices: Array<{
    index: number;
    finish_reason: string | null;
    message: ChatMessage;
  }>;
}

export class LlmError extends Error {
  constructor(message: string, public status?: number, public body?: string) {
    super(message);
    this.name = "LlmError";
  }
}

/** POST /chat/completions and return the first choice's message. */
export async function chat(
  cfg: AiConfig,
  messages: ChatMessage[],
  tools: OpenAiTool[],
  signal?: AbortSignal,
): Promise<ChatMessage> {
  // Defer to the Anthropic adapter when the user's provider speaks the
  // Messages API. Imported lazily to avoid a circular-module hazard.
  if (cfg.protocol === "anthropic") {
    const { chatAnthropic } = await import("./anthropic");
    return chatAnthropic(cfg, messages, tools, signal);
  }

  const base = cfg.baseUrl.trim().replace(/\/+$/, "");
  const url = `${base}/chat/completions`;
  const apiKey = cfg.apiKey.trim();

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
  };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  if (cfg.temperature !== null && cfg.temperature !== undefined) {
    body.temperature = cfg.temperature;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(cfg.extraHeaders ?? {}),
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Surface the URL so users can eyeball typos / wrong preset.
    throw new LlmError(
      `LLM request failed (${res.status}) at ${url}`,
      res.status,
      text,
    );
  }

  const json = (await res.json()) as ChatCompletion;
  const msg = json.choices?.[0]?.message;
  if (!msg) throw new LlmError("LLM response had no choices");
  return msg;
}
