/**
 * AI tool registry — every callable the agent can invoke.
 *
 * Each tool is:
 *   * self-describing (OpenAI function-calling JSON schema)
 *   * classified as read / write (drives the "pending → Apply" UX)
 *   * bound to an executor that dispatches to existing `api.*` commands
 *
 * Safety invariants enforced here:
 *   * every `string` argument that smells like a path is scope-checked
 *   * writes are rejected when `policy.readonly` is set
 *   * tools not present in `policy.allowedTools` are hidden from the LLM
 *
 * Plugins will extend this registry via `contributes.aiTools` in their
 * Pack manifest — see PACKS.md.
 */

import * as api from "../api";
import type { AiPolicy } from "./policy";
import { isWithinScope } from "./policy";

// --- Types --------------------------------------------------------------

/** OpenAI-compatible tool definition (the `tools[]` entry sent to the LLM). */
export interface OpenAiTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type ToolKind = "read" | "write";

export interface ToolDef {
  name: string;
  kind: ToolKind;
  description: string;
  /** JSON Schema for arguments (OpenAI function params shape). */
  parameters: Record<string, unknown>;
  /** Paths inside `args` that must be scope-checked, via dot-paths. */
  pathFields: string[];
  /** Rough count of paths affected — used for confirmThreshold. */
  affectCount?: (args: any) => number;
  /** Human summary shown in the UI for each call card. */
  summary: (args: any) => string;
  /** Execute the tool. Returns JSON-serialisable data for the LLM. */
  execute: (args: any) => Promise<unknown>;
}

export interface ToolCallResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

// --- Helpers ------------------------------------------------------------

function getPath(obj: any, dot: string): unknown {
  return dot.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

/** Collect every string value at the given dot-path, descending into arrays. */
function collectStrings(obj: any, dot: string): string[] {
  const v = getPath(obj, dot);
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  return [];
}

/**
 * Validate a tool call against the current policy. Returns an error
 * string on failure; `null` when the call is allowed to proceed.
 */
export function validateCall(
  tool: ToolDef,
  args: any,
  policy: AiPolicy,
): string | null {
  if (policy.allowedTools && !policy.allowedTools.includes(tool.name)) {
    return `Tool '${tool.name}' is not in the allowed list.`;
  }
  if (policy.readonly && tool.kind === "write") {
    return `Tool '${tool.name}' is a write op and AI mode is readonly.`;
  }
  if (policy.scopeRoot) {
    for (const field of tool.pathFields) {
      for (const p of collectStrings(args, field)) {
        if (!isWithinScope(p, policy.scopeRoot)) {
          return `Path '${p}' is outside the AI scope (${policy.scopeRoot}).`;
        }
      }
    }
  }
  return null;
}

/** Same-dir helper: derive a destination path from a directory + name. */
function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

function baseName(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

// --- Tool list ----------------------------------------------------------

export const TOOLS: ToolDef[] = [
  // ----- Read -----
  {
    name: "list_dir",
    kind: "read",
    description: "List entries in a directory. Returns array of {name, path, kind, size, modified_ms, hidden}.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute directory path inside the AI scope." },
        show_hidden: { type: "boolean", default: false },
      },
      required: ["path"],
    },
    pathFields: ["path"],
    summary: (a) => `list_dir(${a.path})`,
    execute: async (a) => api.listDir(a.path, { showHidden: !!a.show_hidden }),
  },
  {
    name: "stat",
    kind: "read",
    description: "Return metadata for a single path.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    pathFields: ["path"],
    summary: (a) => `stat(${a.path})`,
    execute: async (a) => api.stat(a.path),
  },
  {
    name: "read_text_file",
    kind: "read",
    description: "Read up to max_bytes of a text file (UTF-8 lossy). Returns {content, truncated, total_bytes}.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        max_bytes: { type: "integer", default: 65536 },
      },
      required: ["path"],
    },
    pathFields: ["path"],
    summary: (a) => `read_text_file(${a.path})`,
    execute: async (a) => api.readTextFile(a.path, a.max_bytes ?? 65536),
  },
  {
    name: "list_collections",
    kind: "read",
    description: "List user collections (favourites). Returns array of {id, name, items, ...}.",
    parameters: { type: "object", properties: {} },
    pathFields: [],
    summary: () => `list_collections()`,
    execute: async () => api.listCollections(),
  },
  {
    name: "list_archive",
    kind: "read",
    description: "List the entries inside a zip/tar/tar.gz archive without extracting.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    pathFields: ["path"],
    summary: (a) => `list_archive(${a.path})`,
    execute: async (a) => api.listArchive(a.path),
  },

  // ----- Write -----
  {
    name: "rename",
    kind: "write",
    description: "Rename a file or directory in place (new_name is the final path component, no slashes).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        new_name: { type: "string" },
      },
      required: ["path", "new_name"],
    },
    pathFields: ["path"],
    affectCount: () => 1,
    summary: (a) => `rename(${a.path} -> ${a.new_name})`,
    execute: async (a) => {
      if (/[\\/]/.test(a.new_name)) {
        throw new Error("new_name must not contain path separators; use move_paths to relocate.");
      }
      return api.rename(a.path, a.new_name);
    },
  },
  {
    name: "move_paths",
    kind: "write",
    description: "Move one or more files/directories into dest_dir. Both sources and dest must be inside the AI scope.",
    parameters: {
      type: "object",
      properties: {
        sources: { type: "array", items: { type: "string" } },
        dest_dir: { type: "string" },
      },
      required: ["sources", "dest_dir"],
    },
    pathFields: ["sources", "dest_dir"],
    affectCount: (a) => (a.sources?.length ?? 0),
    summary: (a) => `move_paths(${a.sources?.length ?? 0} → ${a.dest_dir})`,
    execute: async (a) => {
      const results: Array<{ src: string; dst: string }> = [];
      for (const src of a.sources as string[]) {
        const dst = joinPath(a.dest_dir, baseName(src));
        await api.movePath(src, dst);
        results.push({ src, dst });
      }
      return { moved: results };
    },
  },
  {
    name: "copy_paths",
    kind: "write",
    description: "Copy files or directories (recursively) into dest_dir. Limited to 200 paths per call.",
    parameters: {
      type: "object",
      properties: {
        sources: { type: "array", items: { type: "string" }, maxItems: 200 },
        dest_dir: { type: "string" },
      },
      required: ["sources", "dest_dir"],
    },
    pathFields: ["sources", "dest_dir"],
    affectCount: (a) => (a.sources?.length ?? 0),
    summary: (a) => `copy_paths(${a.sources?.length ?? 0} → ${a.dest_dir})`,
    execute: async (a) => {
      if ((a.sources as string[]).length > 200) throw new Error("copy_paths: too many sources (>200)");
      const results: Array<{ src: string; dst: string }> = [];
      for (const src of a.sources as string[]) {
        const dst = joinPath(a.dest_dir, baseName(src));
        await api.copyPath(src, dst);
        results.push({ src, dst });
      }
      return { copied: results };
    },
  },
  {
    name: "create_directory",
    kind: "write",
    description: "Create a directory (recursive).",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    pathFields: ["path"],
    affectCount: () => 1,
    summary: (a) => `create_directory(${a.path})`,
    execute: async (a) => api.createDirectory(a.path),
  },
  {
    name: "create_file",
    kind: "write",
    description:
      "Create a single EMPTY file at `path`. Fails if the file already exists. For multiple files call this tool repeatedly. To write content use write_text_file instead.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute file path inside the AI scope." } },
      required: ["path"],
    },
    pathFields: ["path"],
    affectCount: () => 1,
    summary: (a) => `create_file(${a.path})`,
    execute: async (a) => {
      await api.createFile(a.path);
      return { created: a.path };
    },
  },
  {
    name: "create_files",
    kind: "write",
    description:
      "Create multiple empty files in one call. Each path must be absolute and inside the AI scope. Fails fast on the first path that already exists. Limited to 200 paths per call.",
    parameters: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          maxItems: 200,
          description: "Absolute file paths to create.",
        },
      },
      required: ["paths"],
    },
    pathFields: ["paths"],
    affectCount: (a) => (a.paths?.length ?? 0),
    summary: (a) => `create_files(${a.paths?.length ?? 0})`,
    execute: async (a) => {
      const paths = a.paths as string[];
      if (paths.length > 200) throw new Error("create_files: too many paths (>200)");
      const created: string[] = [];
      for (const p of paths) {
        await api.createFile(p);
        created.push(p);
      }
      return { created };
    },
  },
  {
    name: "write_text_file",
    kind: "write",
    description:
      "Write UTF-8 text `content` to `path`. Set `overwrite=true` to replace an existing file; otherwise the call fails when the file exists. Set `create_parents=true` to auto-create missing parent directories.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute file path inside the AI scope." },
        content: { type: "string", description: "Full file contents as UTF-8 text." },
        overwrite: { type: "boolean", default: false },
        create_parents: { type: "boolean", default: false },
      },
      required: ["path", "content"],
    },
    pathFields: ["path"],
    affectCount: () => 1,
    summary: (a) => {
      const len = typeof a.content === "string" ? a.content.length : 0;
      return `write_text_file(${a.path}, ${len} chars${a.overwrite ? ", overwrite" : ""})`;
    },
    execute: async (a) =>
      api.writeTextFile(a.path, a.content ?? "", {
        overwrite: !!a.overwrite,
        createParents: !!a.create_parents,
      }),
  },
  {
    name: "move_to_trash",
    kind: "write",
    description:
      "Send one or more files/directories to the OS trash/recycle bin (recoverable). Prefer this over delete_forever. Limited to 200 paths per call.",
    parameters: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, maxItems: 200 },
      },
      required: ["paths"],
    },
    pathFields: ["paths"],
    affectCount: (a) => (a.paths?.length ?? 0),
    summary: (a) => `move_to_trash(${a.paths?.length ?? 0})`,
    execute: async (a) => {
      const paths = a.paths as string[];
      if (paths.length > 200) throw new Error("move_to_trash: too many paths (>200)");
      const trashed: string[] = [];
      for (const p of paths) {
        await api.moveToTrash(p);
        trashed.push(p);
      }
      return { trashed };
    },
  },
  {
    name: "add_to_collection",
    kind: "write",
    description: "Add one or more paths to a collection (favourites). Use list_collections first to resolve the id.",
    parameters: {
      type: "object",
      properties: {
        collection_id: { type: "string" },
        paths: { type: "array", items: { type: "string" } },
      },
      required: ["collection_id", "paths"],
    },
    pathFields: ["paths"],
    affectCount: (a) => (a.paths?.length ?? 0),
    summary: (a) => `add_to_collection(${a.collection_id}, ${a.paths?.length ?? 0} items)`,
    execute: async (a) => api.addToCollection(a.collection_id, a.paths),
  },
  {
    name: "create_collection",
    kind: "write",
    description: "Create a new collection (favourites set). Returns the new collection.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    pathFields: [],
    affectCount: () => 1,
    summary: (a) => `create_collection(${a.name})`,
    execute: async (a) => api.createCollection(a.name),
  },
  {
    name: "extract_archive",
    kind: "write",
    description: "Extract a zip/tar/tar.gz archive into dest_dir (which must be inside the AI scope).",
    parameters: {
      type: "object",
      properties: {
        archive_path: { type: "string" },
        dest_dir: { type: "string" },
      },
      required: ["archive_path", "dest_dir"],
    },
    pathFields: ["archive_path", "dest_dir"],
    affectCount: () => 1,
    summary: (a) => `extract_archive(${a.archive_path} → ${a.dest_dir})`,
    execute: async (a) => api.extractArchive(a.archive_path, a.dest_dir),
  },
  {
    name: "create_zip",
    kind: "write",
    description: "Create a new .zip at dest_path containing the given sources.",
    parameters: {
      type: "object",
      properties: {
        sources: { type: "array", items: { type: "string" } },
        dest_path: { type: "string" },
      },
      required: ["sources", "dest_path"],
    },
    pathFields: ["sources", "dest_path"],
    affectCount: (a) => (a.sources?.length ?? 0),
    summary: (a) => `create_zip(${a.sources?.length ?? 0} → ${a.dest_path})`,
    execute: async (a) => api.createZip(a.sources, a.dest_path),
  },
];

/** Build the subset of tools advertised to the LLM under a given policy. */
export function buildToolList(policy: AiPolicy): OpenAiTool[] {
  return allTools().filter((t) => {
    if (policy.allowedTools && !policy.allowedTools.includes(t.name)) return false;
    // readonly hides every write tool entirely — safer than relying on
    // runtime validation (the LLM never sees it, so it can't hallucinate).
    // Except: readonly=false also includes write; readonly=true excludes them.
    if (policy.readonly && t.kind === "write") return false;
    return true;
  }).map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export function findTool(name: string): ToolDef | undefined {
  return allTools().find((t) => t.name === name);
}

// --- Plugin-contributed tools ------------------------------------------
//
// Plugins call `registerPluginTool` from their activate() function.
// The tool lives in the same registry the LLM sees and goes through the
// exact same scope/readonly/approval pipeline.

const pluginTools = new Map<string, ToolDef>(); // name -> def
const pluginOwners = new Map<string, string>(); // name -> plugin id

export function registerPluginTool(pluginId: string, def: ToolDef): void {
  if (TOOLS.some((t) => t.name === def.name)) {
    console.warn(`[plugin ${pluginId}] tool name clashes with built-in '${def.name}', skipped`);
    return;
  }
  if (pluginTools.has(def.name) && pluginOwners.get(def.name) !== pluginId) {
    console.warn(`[plugin ${pluginId}] tool name '${def.name}' taken by another plugin, skipped`);
    return;
  }
  pluginTools.set(def.name, def);
  pluginOwners.set(def.name, pluginId);
}

export function unregisterPluginTool(pluginId: string, name: string): void {
  if (pluginOwners.get(name) === pluginId) {
    pluginTools.delete(name);
    pluginOwners.delete(name);
  }
}

/** All tools currently visible to the agent (built-ins + enabled plugins). */
export function allTools(): ToolDef[] {
  return [...TOOLS, ...pluginTools.values()];
}

/**
 * Origin of a tool by name. Built-ins return "builtin"; plugin-
 * contributed tools return the owning plugin id; unknown tools return
 * undefined. Used by the Settings AI-tools tab to surface provenance.
 */
export function toolOwner(name: string): "builtin" | string | undefined {
  if (TOOLS.some((t) => t.name === name)) return "builtin";
  return pluginOwners.get(name);
}
