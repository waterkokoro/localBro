/**
 * Agent loop — orchestrates a single conversation turn:
 *
 *   user prompt ──▶ LLM ──▶ (tool_calls?) ──▶ execute / ask ──▶ LLM ──▶ …
 *
 * Key properties:
 *   * Writes are "pending by default": the agent emits a `pending` event
 *     and waits for the UI to resolve it with `approve(callId)` or
 *     `reject(callId, reason)`. Small reads run unattended.
 *   * Scope + policy checks happen BEFORE execution (tools.ts).
 *   * An `AbortSignal` lets the UI cancel a runaway session.
 *   * `maxIterations` bounds runaway loops regardless of LLM behaviour.
 */
import type { AiConfig, AiPolicy } from "./policy";
import { chat, LlmError } from "./client";
import type { ChatMessage, ToolCall } from "./client";
import { buildToolList, findTool, validateCall } from "./tools";

export type CallStatus = "pending" | "running" | "done" | "error" | "rejected";

export interface CallRecord {
  id: string;
  name: string;
  args: any;
  summary: string;
  status: CallStatus;
  /** Result data when `done`, error string when `error`, rejection reason when `rejected`. */
  detail?: string;
  /** Set when the call needed user approval — used by UI to render Apply/Reject buttons. */
  awaitingApproval?: boolean;
}

export type AgentEvent =
  | { type: "assistant"; content: string }
  | { type: "tool"; call: CallRecord }
  | { type: "tool_update"; call: CallRecord }
  | { type: "done" }
  | { type: "error"; error: string };

type Resolver = (reason?: string) => void;

export interface AgentHandle {
  abort: () => void;
  approve: (callId: string) => void;
  reject: (callId: string, reason?: string) => void;
}

interface RunOptions {
  config: AiConfig;
  policy: AiPolicy;
  messages: ChatMessage[];
  emit: (evt: AgentEvent) => void;
  /** Called at the start so callers can capture the handle synchronously. */
  onHandle?: (h: AgentHandle) => void;
}

/**
 * Drive one full turn. Returns the updated message list including
 * assistant/tool messages so callers can persist it.
 */
export async function runTurn(opts: RunOptions): Promise<ChatMessage[]> {
  const ctrl = new AbortController();
  const approvals = new Map<string, Resolver>();
  const handle: AgentHandle = {
    abort: () => ctrl.abort(),
    approve: (id) => approvals.get(id)?.(undefined),
    reject: (id, reason) => approvals.get(id)?.(reason ?? "rejected by user"),
  };
  opts.onHandle?.(handle);

  const messages = [...opts.messages];
  const tools = buildToolList(opts.policy);

  for (let iter = 0; iter < opts.policy.maxIterations; iter++) {
    let response: ChatMessage;
    try {
      response = await chat(opts.config, messages, tools, ctrl.signal);
    } catch (e) {
      const msg = e instanceof LlmError ? `${e.message}${e.body ? `: ${e.body}` : ""}` : String(e);
      opts.emit({ type: "error", error: msg });
      return messages;
    }
    messages.push(response);

    if (response.content) {
      opts.emit({ type: "assistant", content: response.content });
    }

    const calls = response.tool_calls ?? [];
    if (calls.length === 0) {
      opts.emit({ type: "done" });
      return messages;
    }

    // Execute every tool call in the order the LLM emitted them. They are
    // always sequential here — if a tool needs concurrency, the LLM can
    // batch via the tool's own arguments instead.
    for (const call of calls) {
      const rec = await dispatch(call, opts, approvals, ctrl.signal);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(rec.status === "done" ? rec.detail ?? "ok" : { error: rec.detail }),
      });
      if (ctrl.signal.aborted) {
        opts.emit({ type: "error", error: "aborted" });
        return messages;
      }
    }
  }

  opts.emit({ type: "error", error: `Exceeded maxIterations (${opts.policy.maxIterations}).` });
  return messages;
}

async function dispatch(
  call: ToolCall,
  opts: RunOptions,
  approvals: Map<string, Resolver>,
  signal: AbortSignal,
): Promise<CallRecord> {
  const tool = findTool(call.function.name);
  let args: any = {};
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch (e) {
    const rec: CallRecord = {
      id: call.id,
      name: call.function.name,
      args: call.function.arguments,
      summary: `${call.function.name}(<malformed args>)`,
      status: "error",
      detail: `Arguments are not valid JSON: ${e}`,
    };
    opts.emit({ type: "tool", call: rec });
    return rec;
  }

  if (!tool) {
    const rec: CallRecord = {
      id: call.id,
      name: call.function.name,
      args,
      summary: `${call.function.name}(…)`,
      status: "error",
      detail: `Unknown tool '${call.function.name}'.`,
    };
    opts.emit({ type: "tool", call: rec });
    return rec;
  }

  const validation = validateCall(tool, args, opts.policy);
  if (validation) {
    const rec: CallRecord = {
      id: call.id,
      name: tool.name,
      args,
      summary: tool.summary(args),
      status: "rejected",
      detail: validation,
    };
    opts.emit({ type: "tool", call: rec });
    return rec;
  }

  const impact = tool.affectCount?.(args) ?? 0;
  const needsApproval =
    tool.kind === "write" &&
    (opts.policy.confirmAllWrites || impact >= opts.policy.confirmThreshold);

  const rec: CallRecord = {
    id: call.id,
    name: tool.name,
    args,
    summary: tool.summary(args),
    status: needsApproval ? "pending" : "running",
    awaitingApproval: needsApproval,
  };
  opts.emit({ type: "tool", call: rec });

  if (needsApproval) {
    const reason = await new Promise<string | undefined>((resolve) => {
      approvals.set(call.id, resolve);
      // Surface an abort as an implicit rejection so the Promise settles.
      signal.addEventListener(
        "abort",
        () => resolve("aborted"),
        { once: true },
      );
    });
    approvals.delete(call.id);
    if (reason !== undefined) {
      rec.status = "rejected";
      rec.detail = reason;
      rec.awaitingApproval = false;
      opts.emit({ type: "tool_update", call: rec });
      return rec;
    }
    rec.status = "running";
    rec.awaitingApproval = false;
    opts.emit({ type: "tool_update", call: rec });
  }

  try {
    const data = await tool.execute(args);
    rec.status = "done";
    rec.detail = typeof data === "string" ? data : JSON.stringify(data);
    opts.emit({ type: "tool_update", call: rec });
  } catch (e) {
    rec.status = "error";
    rec.detail = String(e);
    opts.emit({ type: "tool_update", call: rec });
  }
  return rec;
}

/** Seed system prompt — tells the LLM who it's talking to and where the scope is. */
export function buildSystemPrompt(policy: AiPolicy, cwd: string): string {
  const lines = [
    "You are LocalBro's built-in file assistant.",
    "Call the provided tools to read and manipulate files on the user's disk.",
    `The user is currently viewing: ${cwd || "<none>"}.`,
  ];
  if (policy.scopeRoot) {
    lines.push(
      `IMPORTANT: your AI scope is restricted to paths inside '${policy.scopeRoot}'.`,
      "Any tool call with a path outside this subtree will be rejected.",
    );
  }
  if (policy.readonly) {
    lines.push(
      "AI mode is set to READONLY: no write tools are available, and the",
      "app will refuse to delete or trash files even if you request it.",
    );
  } else {
    lines.push(
      "Write tools are available but large operations require the user to",
      "click Apply before running. Explain your plan briefly before calling them.",
    );
  }
  lines.push(
    "Never fabricate paths; always ground them in tool results from list_dir/stat.",
    "Keep responses concise.",
  );
  return lines.join("\n");
}
