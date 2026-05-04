/**
 * Plugin runtime — loads Packs with `type: "plugin"` at startup, tracks
 * enabled state, and exposes a small `register` API to contributed
 * `previewAdapters` / `aiTools`.
 *
 * Security model (v0.3):
 * - Plugins run in the same renderer as the host (no iframe/Worker).
 * - The `api` object passed to each plugin is a whitelist filtered by
 *   the permissions declared in its manifest. Anything not declared
 *   returns a rejected Promise.
 * - Destructive filesystem operations (move/trash/delete) are never
 *   exposed to plugins regardless of declared permissions.
 */

import * as api from "../api";
import type { PackInfo } from "../api";
import { convertFileSrc } from "@tauri-apps/api/core";
import { registerAdapter, unregisterAdapter } from "../preview/registry";
import type { PreviewAdapter } from "../preview/registry";
import { registerPluginTool, unregisterPluginTool } from "../ai/tools";
import type { ToolDef } from "../ai/tools";

export const ENABLED_KEY = "plugins.enabled";

/** A live plugin instance — what we bookkeep per installed & enabled pack. */
interface LoadedPlugin {
  id: string;
  manifest: PackInfo;
  /** Contribution ids so we can tear them down on disable/reload. */
  contributedPreview: string[];
  contributedAiTools: string[];
}

const loaded = new Map<string, LoadedPlugin>();

/** Returns the user-enabled set from settings (default: none). */
export async function getEnabledPlugins(): Promise<string[]> {
  const raw = await api.settingsGet<string[]>(ENABLED_KEY);
  return Array.isArray(raw) ? raw : [];
}

export async function setPluginEnabled(id: string, on: boolean): Promise<void> {
  const current = new Set(await getEnabledPlugins());
  if (on) current.add(id);
  else current.delete(id);
  await api.settingsSet(ENABLED_KEY, Array.from(current));
}

/**
 * Build the whitelisted API surface for a plugin based on its declared
 * permissions. Anything not declared throws at call time.
 */
function buildPluginApi(permissions: string[]) {
  const has = (p: string) => permissions.includes(p);
  const denied = (p: string) =>
    Promise.reject(new Error(`plugin lacks permission: ${p}`));
  return {
    listDir: has("list_dir") ? api.listDir : (() => denied("list_dir")),
    stat: has("list_dir") ? api.stat : (() => denied("list_dir")),
    readTextFile: has("read_text") ? api.readTextFile : (() => denied("read_text")),
    listArchive: has("read_file") ? api.listArchive : (() => denied("read_file")),
    // Network/sidecar capabilities will live here once Task 9 hits v1.
  };
}

/**
 * Load a single plugin pack. Errors are swallowed and logged — a bad
 * plugin must not crash the host.
 */
async function loadPlugin(manifest: PackInfo): Promise<void> {
  if (!manifest.plugin) return;
  const entry = manifest.plugin.entry;
  if (!entry) return;

  const abs = `${manifest.install_path.replace(/[\\/]+$/, "")}/${entry}`;
  const url = convertFileSrc(abs);

  const contributedPreview: string[] = [];
  const contributedAiTools: string[] = [];

  try {
    // Vite-ignore so Rollup doesn't try to resolve this at build time.
    const mod: any = await import(/* @vite-ignore */ url);
    const fn = mod?.default ?? mod?.activate;
    if (typeof fn !== "function") {
      console.warn(`[plugin ${manifest.id}] entry missing default/activate export`);
      return;
    }

    const ctx = {
      api: buildPluginApi(manifest.plugin.permissions ?? []),
      register: {
        previewAdapter: (a: PreviewAdapter) => {
          const id = `${manifest.id}:${a.id}`;
          registerAdapter({ ...a, id });
          contributedPreview.push(id);
        },
        aiTool: (t: ToolDef) => {
          registerPluginTool(manifest.id, t);
          contributedAiTools.push(t.name);
        },
      },
      manifest,
    };

    await fn(ctx);

    loaded.set(manifest.id, {
      id: manifest.id,
      manifest,
      contributedPreview,
      contributedAiTools,
    });
  } catch (e) {
    console.error(`[plugin ${manifest.id}] failed to load:`, e);
    // Best-effort cleanup in case it registered things before throwing.
    contributedPreview.forEach(unregisterAdapter);
    contributedAiTools.forEach((n) => unregisterPluginTool(manifest.id, n));
  }
}

function unloadPlugin(id: string) {
  const p = loaded.get(id);
  if (!p) return;
  p.contributedPreview.forEach(unregisterAdapter);
  p.contributedAiTools.forEach((n) => unregisterPluginTool(id, n));
  loaded.delete(id);
}

/** Load all enabled plugins (idempotent — safely re-loads if called twice). */
export async function initPlugins(): Promise<void> {
  const [all, enabledList] = await Promise.all([
    api.listPacks("plugin").catch(() => [] as PackInfo[]),
    getEnabledPlugins().catch(() => [] as string[]),
  ]);
  const enabled = new Set(enabledList);
  const targets = all.filter((p) => enabled.has(p.id));

  // Unload anything previously loaded that is no longer enabled.
  for (const id of Array.from(loaded.keys())) {
    if (!enabled.has(id)) unloadPlugin(id);
  }

  for (const p of targets) {
    if (!loaded.has(p.id)) await loadPlugin(p);
  }
}

/** Full teardown + reload — called after toggling the enabled set. */
export async function reloadPlugins(): Promise<void> {
  for (const id of Array.from(loaded.keys())) unloadPlugin(id);
  await initPlugins();
}

export function listLoaded(): string[] {
  return Array.from(loaded.keys());
}
