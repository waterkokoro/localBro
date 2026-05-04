/**
 * Anthropic Messages API adapter.
 *
 * The rest of LocalBro speaks OpenAI's Chat Completions shape
 * (`ChatMessage` + `tool_calls`). Rather than forking the agent loop,
 * we translate in one place here:
 *
 *   OpenAI ChatMessage[]  ───▶  Anthropic Messages request
 *   Anthropic response    ───▶  OpenAI ChatMessage (incl. tool_calls)
 *
 * Supported: text + tool_use + tool_result. Streaming is not used — the
 * agent drives one full request at a time, same as the OpenAI path.
 */

import type { AiConfig } from "./policy";
import type { OpenAiTool } from "./tools";
import type { ChatMessage, ToolCall } from "./client";
import { LlmError } from "./client";

// --- Anthropic request/response shapes (only fields we actually use) --

interface AnthTextBlock { type: "text"; text: string }
interface AnthToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
interface AnthToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
type AnthBlock = AnthTextBlock | AnthToolUseBlock | AnthToolResultBlock;

interface AnthMessage {
  role: "user" | "assistant";
  content: string | AnthBlock[];
}

interface AnthTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

interface AnthResponse {
  id: string;
  role: "assistant";
  content: AnthBlock[];
  stop_reason: string | null;
  usage?: { input_tokens: number; output_tokens: number };
}

// --- OpenAI ➜ Anthropic --------------------------------------------------

/** Split system messages from chat messages; Anthropic needs them apart. */
function splitSystem(messages: ChatMessage[]): { system: string; rest: ChatMessage[] } {
  const systems: string[] = [];
  const rest: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      if (typeof m.content === "string" && m.content) systems.push(m.content);
    } else {
      rest.push(m);
    }
  }
  return { system: systems.join("\n\n"), rest };
}

function toAnthropicMessages(messages: ChatMessage[]): AnthMessage[] {
  const out: AnthMessage[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      // OpenAI tool results become Anthropic user/tool_result blocks.
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.tool_call_id ?? "",
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
          },
        ],
      });
      continue;
    }
    if (m.role === "assistant") {
      const blocks: AnthBlock[] = [];
      if (typeof m.content === "string" && m.content) {
        blocks.push({ type: "text", text: m.content });
      }
      for (const c of m.tool_calls ?? []) {
        let input: Record<string, unknown> = {};
        try {
          input = c.function.arguments ? JSON.parse(c.function.arguments) : {};
        } catch {
          input = { _raw: c.function.arguments };
        }
        blocks.push({
          type: "tool_use",
          id: c.id,
          name: c.function.name,
          input,
        });
      }
      out.push({
        role: "assistant",
        content: blocks.length > 0 ? blocks : [{ type: "text", text: "" }],
      });
      continue;
    }
    // user (or anything else we don't explicitly handle).
    out.push({
      role: "user",
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
    });
  }
  return out;
}

function toAnthropicTools(tools: OpenAiTool[]): AnthTool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

// --- Anthropic ➜ OpenAI --------------------------------------------------

function toOpenAiMessage(resp: AnthResponse): ChatMessage {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const b of resp.content) {
    if (b.type === "text") textParts.push(b.text);
    else if (b.type === "tool_use") {
      toolCalls.push({
        id: b.id,
        type: "function",
        function: {
          name: b.name,
          arguments: JSON.stringify(b.input ?? {}),
        },
      });
    }
  }
  const msg: ChatMessage = {
    role: "assistant",
    content: textParts.length > 0 ? textParts.join("\n") : null,
  };
  if (toolCalls.length > 0) msg.tool_calls = toolCalls;
  return msg;
}

// --- Public API ---------------------------------------------------------

/**
 * POST {baseUrl}/v1/messages with translated payload, return a message
 * in OpenAI shape so the rest of the agent loop stays unchanged.
 */
export async function chatAnthropic(
  cfg: AiConfig,
  messages: ChatMessage[],
  tools: OpenAiTool[],
  signal?: AbortSignal,
): Promise<ChatMessage> {
  const base = cfg.baseUrl.trim().replace(/\/+$/, "");
  // Anthropic endpoints accept `/v1/messages`. Users pointing at a
  // proxy that already includes `/v1` still work — we only append
  // `/v1/messages` if the path doesn't already end in it.
  const url = /\/v1\/?$/.test(base)
    ? `${base.replace(/\/$/, "")}/messages`
    : `${base}/v1/messages`;
  const apiKey = cfg.apiKey.trim();

  const { system, rest } = splitSystem(messages);

  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: 4096,
    messages: toAnthropicMessages(rest),
  };
  if (system) body.system = system;
  if (tools.length > 0) body.tools = toAnthropicTools(tools);
  if (cfg.temperature !== null && cfg.temperature !== undefined) {
    body.temperature = cfg.temperature;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    ...(cfg.extraHeaders ?? {}),
  };
  if (apiKey) headers["x-api-key"] = apiKey;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new LlmError(
      `LLM request failed (${res.status}) at ${url}`,
      res.status,
      text,
    );
  }

  const json = (await res.json()) as AnthResponse;
  if (!json || !Array.isArray(json.content)) {
    throw new LlmError("Anthropic response had no content blocks");
  }
  return toOpenAiMessage(json);
}
