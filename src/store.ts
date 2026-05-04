import { create } from "zustand";
import type { FsEntry, Shortcut, SortDir, SortKey, ViewMode } from "./types";
import * as api from "./api";
import type { Collection } from "./api";

/**
 * `cwd` may be either a real filesystem path or a virtual path of the form
 * `collection:<id>`. Collection views navigate via a dedicated backend
 * command and cannot "go up"; back/forward still works normally.
 */
export const COLLECTION_SCHEME = "collection:";
export const isCollectionPath = (p: string) => p.startsWith(COLLECTION_SCHEME);
export const collectionIdOf = (p: string) =>
  p.startsWith(COLLECTION_SCHEME) ? p.slice(COLLECTION_SCHEME.length) : null;

// Persistent view prefs stored in the Tauri settings.json. Column
// config uses `list_columns` (see src/columns.ts); these two keys are
// the sibling entries for sort and preview-pane toggle.
const SORT_STORAGE_KEY = "list_sort";
const PREVIEW_PANE_STORAGE_KEY = "preview_pane_enabled";
const AI_PANEL_WIDTH_KEY = "ai_panel_width";

/** Width in px of the right-hand AI panel. User-resizable. */
const AI_PANEL_WIDTH_DEFAULT = 440;
const AI_PANEL_WIDTH_MIN = 320;
const AI_PANEL_WIDTH_MAX = 900;

interface BrowserState {
  cwd: string;
  entries: FsEntry[];
  loading: boolean;
  error: string | null;

  history: string[];
  historyIdx: number;

  shortcuts: Shortcut[];
  volumes: Shortcut[];
  collections: Collection[];

  selection: Set<string>; // paths

  /** Cached recursive sizes for directories, keyed by absolute path. */
  dirSizes: Record<string, number>;

  /** Path of the file currently shown in the preview modal (null = closed). */
  previewPath: string | null;

  /** When true, the right-hand preview pane follows the current selection. */
  previewPaneEnabled: boolean;

  /** Width of the AI panel in pixels when it is visible. */
  aiPanelWidth: number;

  showHidden: boolean;
  viewMode: ViewMode;
  sortKey: SortKey;
  sortDir: SortDir;

  // actions
  init: () => Promise<void>;
  navigate: (path: string, opts?: { replace?: boolean }) => Promise<void>;
  refresh: () => Promise<void>;
  goBack: () => void;
  goForward: () => void;
  goUp: () => Promise<void>;

  toggleSelection: (path: string, additive?: boolean) => void;
  clearSelection: () => void;
  selectAll: () => void;

  setShowHidden: (v: boolean) => void;
  setViewMode: (v: ViewMode) => void;
  setSort: (key: SortKey, dir?: SortDir) => void;
  setPreviewPaneEnabled: (v: boolean) => void;
  setAiPanelWidth: (px: number) => void;

  /** Called by the Tauri event listener when a size scan completes. */
  setDirSize: (path: string, bytes: number) => void;

  openPreview: (path: string) => void;
  closePreview: () => void;

  // Collections
  refreshCollections: () => Promise<void>;
  createCollection: (name: string) => Promise<Collection>;
  deleteCollection: (id: string) => Promise<void>;
  renameCollection: (id: string, name: string) => Promise<void>;
  addToCollection: (id: string, paths: string[]) => Promise<void>;
  removeFromCollection: (id: string, paths: string[]) => Promise<void>;
}

export const useBrowser = create<BrowserState>((set, get) => ({
  cwd: "",
  entries: [],
  loading: false,
  error: null,

  history: [],
  historyIdx: -1,

  shortcuts: [],
  volumes: [],
  collections: [],

  selection: new Set(),

  dirSizes: {},

  previewPath: null,
  previewPaneEnabled: true,
  aiPanelWidth: AI_PANEL_WIDTH_DEFAULT,

  showHidden: false,
  viewMode: "list",
  sortKey: "name",
  sortDir: "asc",

  init: async () => {
    try {
      const [home, shortcuts, volumes, collections, sortPref, panePref, aiWidthPref] =
        await Promise.all([
          api.homePath(),
          api.defaultShortcuts(),
          api.listVolumes().catch(() => []),
          api.listCollections().catch(() => [] as Collection[]),
          api
            .settingsGet<{ key: SortKey; dir: SortDir }>(SORT_STORAGE_KEY)
            .catch(() => null),
          api.settingsGet<boolean>(PREVIEW_PANE_STORAGE_KEY).catch(() => null),
          api.settingsGet<number>(AI_PANEL_WIDTH_KEY).catch(() => null),
        ]);
      const patch: Partial<BrowserState> = { shortcuts, volumes, collections };
      if (sortPref && typeof sortPref === "object") {
        if (sortPref.key) patch.sortKey = sortPref.key;
        if (sortPref.dir) patch.sortDir = sortPref.dir;
      }
      if (typeof panePref === "boolean") patch.previewPaneEnabled = panePref;
      if (typeof aiWidthPref === "number" && Number.isFinite(aiWidthPref)) {
        patch.aiPanelWidth = Math.min(
          AI_PANEL_WIDTH_MAX,
          Math.max(AI_PANEL_WIDTH_MIN, Math.round(aiWidthPref)),
        );
      }
      set(patch);
      await get().navigate(home);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  navigate: async (path, opts) => {
    const prev = get();
    set({ loading: true, error: null });
    try {
      const entries = isCollectionPath(path)
        ? await api.listCollectionEntries(collectionIdOf(path)!)
        : await api.listDir(path, { showHidden: prev.showHidden });
      let { history, historyIdx } = prev;
      if (!opts?.replace) {
        history = history.slice(0, historyIdx + 1);
        history.push(path);
        historyIdx = history.length - 1;
      }
      set({
        cwd: path,
        entries,
        selection: new Set(),
        history,
        historyIdx,
        loading: false,
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  refresh: async () => {
    const { cwd } = get();
    if (cwd) await get().navigate(cwd, { replace: true });
  },

  goBack: () => {
    const { history, historyIdx } = get();
    if (historyIdx > 0) {
      const idx = historyIdx - 1;
      const path = history[idx];
      set({ historyIdx: idx });
      replayNav(path, get().showHidden, set);
    }
  },

  goForward: () => {
    const { history, historyIdx } = get();
    if (historyIdx < history.length - 1) {
      const idx = historyIdx + 1;
      const path = history[idx];
      set({ historyIdx: idx });
      replayNav(path, get().showHidden, set);
    }
  },

  goUp: async () => {
    const { cwd } = get();
    if (!cwd || isCollectionPath(cwd)) return;
    const parent = await api.parentOf(cwd);
    if (parent && parent !== cwd) {
      await get().navigate(parent);
    }
  },

  toggleSelection: (path, additive) => {
    const sel = new Set(get().selection);
    if (additive) {
      if (sel.has(path)) sel.delete(path);
      else sel.add(path);
    } else {
      sel.clear();
      sel.add(path);
    }
    set({ selection: sel });
  },

  clearSelection: () => set({ selection: new Set() }),
  selectAll: () => set({ selection: new Set(get().entries.map((e) => e.path)) }),

  setShowHidden: (v) => {
    set({ showHidden: v });
    // immediately refresh listing
    const { cwd } = get();
    if (cwd && !isCollectionPath(cwd)) {
      api
        .listDir(cwd, { showHidden: v })
        .then((entries) => set({ entries, selection: new Set() }))
        .catch((e) => set({ error: String(e) }));
    }
  },
  setViewMode: (v) => set({ viewMode: v }),
  setSort: (key, dir) => {
    const s = get();
    const nextKey = key;
    const nextDir =
      dir ?? (s.sortKey === key && s.sortDir === "asc" ? "desc" : "asc");
    set({ sortKey: nextKey, sortDir: nextDir });
    api
      .settingsSet(SORT_STORAGE_KEY, { key: nextKey, dir: nextDir })
      .catch((err) => console.warn("[store] persist sort failed", err));
  },
  setPreviewPaneEnabled: (v) => {
    set({ previewPaneEnabled: v });
    api
      .settingsSet(PREVIEW_PANE_STORAGE_KEY, v)
      .catch((err) => console.warn("[store] persist preview pane failed", err));
  },
  setAiPanelWidth: (px) => {
    const clamped = Math.min(
      AI_PANEL_WIDTH_MAX,
      Math.max(AI_PANEL_WIDTH_MIN, Math.round(px)),
    );
    set({ aiPanelWidth: clamped });
    api
      .settingsSet(AI_PANEL_WIDTH_KEY, clamped)
      .catch((err) => console.warn("[store] persist ai panel width failed", err));
  },

  setDirSize: (path, bytes) =>
    set((s) => ({ dirSizes: { ...s.dirSizes, [path]: bytes } })),

  openPreview: (path) => set({ previewPath: path }),
  closePreview: () => set({ previewPath: null }),

  refreshCollections: async () => {
    const collections = await api.listCollections();
    set({ collections });
  },

  createCollection: async (name) => {
    const c = await api.createCollection(name);
    set((s) => ({ collections: [...s.collections, c] }));
    return c;
  },

  deleteCollection: async (id) => {
    await api.deleteCollection(id);
    set((s) => ({
      collections: s.collections.filter((c) => c.id !== id),
      // If we were viewing it, jump home.
      cwd: s.cwd === `${COLLECTION_SCHEME}${id}` ? s.cwd : s.cwd,
    }));
    // If we were viewing it, navigate home.
    if (get().cwd === `${COLLECTION_SCHEME}${id}`) {
      const home = await api.homePath();
      await get().navigate(home, { replace: true });
    }
  },

  renameCollection: async (id, name) => {
    const c = await api.updateCollection(id, { name });
    set((s) => ({
      collections: s.collections.map((x) => (x.id === c.id ? c : x)),
    }));
  },

  addToCollection: async (id, paths) => {
    const c = await api.addToCollection(id, paths);
    set((s) => ({
      collections: s.collections.map((x) => (x.id === c.id ? c : x)),
    }));
    // If currently viewing that collection, refresh.
    if (get().cwd === `${COLLECTION_SCHEME}${id}`) {
      await get().refresh();
    }
  },

  removeFromCollection: async (id, paths) => {
    const c = await api.removeFromCollection(id, paths);
    set((s) => ({
      collections: s.collections.map((x) => (x.id === c.id ? c : x)),
    }));
    if (get().cwd === `${COLLECTION_SCHEME}${id}`) {
      await get().refresh();
    }
  },
}));

function replayNav(
  path: string,
  showHidden: boolean,
  set: (partial: Partial<BrowserState>) => void,
) {
  const p = isCollectionPath(path)
    ? api.listCollectionEntries(collectionIdOf(path)!)
    : api.listDir(path, { showHidden });
  p.then((entries) => set({ cwd: path, entries, selection: new Set(), error: null })).catch(
    (e) => set({ error: String(e) }),
  );
}

export function sortEntries(
  list: FsEntry[],
  key: SortKey,
  dir: SortDir,
): FsEntry[] {
  const mult = dir === "asc" ? 1 : -1;
  const copy = [...list];
  copy.sort((a, b) => {
    // Directories always first, regardless of sort
    if (a.kind === "directory" && b.kind !== "directory") return -1;
    if (a.kind !== "directory" && b.kind === "directory") return 1;
    let cmp = 0;
    switch (key) {
      case "size":
        cmp = (a.size ?? 0) - (b.size ?? 0);
        break;
      case "modified":
        cmp = (a.modifiedMs ?? 0) - (b.modifiedMs ?? 0);
        break;
      case "kind":
        cmp = (a.extension ?? "").localeCompare(b.extension ?? "");
        break;
      case "name":
      default:
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true });
    }
    return cmp * mult;
  });
  return copy;
}
