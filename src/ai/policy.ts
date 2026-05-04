/**
 * AI policy — user-configurable safety/behaviour settings for the
 * agent. Persisted to the Rust settings store under key `ai.policy`.
 */

import * as api from "../api";
import type { Protocol } from "./providers";

export const POLICY_KEY = "ai.policy";
export const CONFIG_KEY = "ai.config";

/** Per-session constraints evaluated on every tool call. */
export interface AiPolicy {
  /** Master switch: while true, destructive commands are blocked globally (Rust guard). */
  readonly: boolean;
  /** Absolute path; tool calls operating outside this subtree are rejected. */
  scopeRoot: string | null;
  /** Above this many affected paths, auto-apply is disabled and UI asks the user. */
  confirmThreshold: number;
  /** If true, the agent pauses before EVERY write, not just large batches. */
  confirmAllWrites: boolean;
  /** Subset of tool ids the agent is allowed to call. `null` = allow all non-destructive. */
  allowedTools: string[] | null;
  /** Max tool calls per user turn (prevents runaway loops). */
  maxIterations: number;
}

export const DEFAULT_POLICY: AiPolicy = {
  readonly: false,
  scopeRoot: null,
  confirmThreshold: 10,
  confirmAllWrites: false,
  allowedTools: null,
  maxIterations: 16,
};

/** Endpoint configuration — kept separately from policy since it's rarely changed. */
export interface AiConfig {
  /**
   * Provider preset id (e.g. "openai", "anthropic", "deepseek").
   * Purely a UI hint so the Settings dropdown can light up; the actual
   * behaviour is driven by `baseUrl` + `protocol`.
   */
  provider?: string;
  /** Wire protocol. `openai` = Chat Completions, `anthropic` = Messages API. */
  protocol?: Protocol;
  /** OpenAI-compatible base URL (e.g. https://api.openai.com/v1). */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Optional extra headers (e.g. for OpenRouter / custom gateways). */
  extraHeaders?: Record<string, string>;
  /** Temperature; `null` omits the field entirely. */
  temperature?: number | null;
}

export const DEFAULT_CONFIG: AiConfig = {
  provider: "openai",
  protocol: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0.2,
};

export async function loadPolicy(): Promise<AiPolicy> {
  const raw = await api.settingsGet<Partial<AiPolicy>>(POLICY_KEY);
  return { ...DEFAULT_POLICY, ...(raw ?? {}) };
}

export async function savePolicy(p: AiPolicy): Promise<void> {
  await api.settingsSet(POLICY_KEY, p);
}

export async function loadConfig(): Promise<AiConfig> {
  const raw = await api.settingsGet<Partial<AiConfig>>(CONFIG_KEY);
  return { ...DEFAULT_CONFIG, ...(raw ?? {}) };
}

export async function saveConfig(c: AiConfig): Promise<void> {
  // Trim text fields so stray whitespace / newlines from copy-paste
  // don't silently break auth (upstream providers usually reject
  // "Bearer sk-xxx\n" with a generic 401, which is painful to debug).
  const cleaned: AiConfig = {
    ...c,
    baseUrl: c.baseUrl.trim(),
    apiKey: c.apiKey.trim(),
    model: c.model.trim(),
  };
  await api.settingsSet(CONFIG_KEY, cleaned);
}

/** Normalize a path for prefix-comparison (OS-aware, case-insensitive on Windows). */
function normalize(p: string): string {
  const unified = p.replace(/\\/g, "/").replace(/\/+$/, "");
  // Heuristic: Windows absolute paths start with `X:`; compare case-insensitively
  // there. On POSIX, filesystems may still be case-insensitive (macOS HFS+/APFS
  // default), so we err on the side of being permissive here.
  return /^[a-zA-Z]:/.test(unified) ? unified.toLowerCase() : unified;
}

/**
 * Is `candidate` inside `root` (same dir or descendant)? Returns true when
 * `root` is null (no scope set).
 */
export function isWithinScope(candidate: string, root: string | null): boolean {
  if (!root) return true;
  const r = normalize(root);
  const c = normalize(candidate);
  return c === r || c.startsWith(r + "/");
}
