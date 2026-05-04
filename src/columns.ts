/**
 * Column configuration for the Details / List views.
 *
 * The column set is intentionally small — the file manager is not a
 * spreadsheet. We support showing/hiding optional columns and resizing
 * their width with a mouse-drag handle. The whole configuration is
 * persisted to `settings.json` under `list_columns` and loaded at
 * startup so the user's choice sticks between sessions.
 */

import { create } from "zustand";
import * as api from "./api";

export type ColumnId = "name" | "size" | "modified" | "kind" | "extension";

export interface ColumnDef {
  id: ColumnId;
  /** Visible label i18n key under `list.column.*`. */
  labelKey: string;
  /** In pixels. `name` is flex-1 and ignores this value. */
  width: number;
  visible: boolean;
  /** `name` cannot be hidden — it's the primary identifier. */
  required?: boolean;
}

export const DEFAULT_COLUMNS: ColumnDef[] = [
  { id: "name", labelKey: "list.column.name", width: 0, visible: true, required: true },
  { id: "size", labelKey: "list.column.size", width: 80, visible: true },
  { id: "modified", labelKey: "list.column.modified", width: 140, visible: true },
  { id: "kind", labelKey: "list.column.kind", width: 100, visible: false },
  { id: "extension", labelKey: "list.column.extension", width: 80, visible: false },
];

const STORAGE_KEY = "list_columns";

interface Persisted {
  id: ColumnId;
  width: number;
  visible: boolean;
}

interface ColumnState {
  columns: ColumnDef[];
  loaded: boolean;
  load: () => Promise<void>;
  setVisible: (id: ColumnId, v: boolean) => void;
  setWidth: (id: ColumnId, w: number) => void;
  resetDefaults: () => void;
}

/** Write-through persistence. Fire-and-forget; errors are logged. */
function persist(columns: ColumnDef[]): void {
  const payload: Persisted[] = columns.map((c) => ({
    id: c.id,
    width: c.width,
    visible: c.visible,
  }));
  api.settingsSet(STORAGE_KEY, payload).catch((err) => {
    console.warn("[columns] failed to persist", err);
  });
}

function mergeDefaults(saved: Persisted[] | null): ColumnDef[] {
  if (!saved || !Array.isArray(saved)) return DEFAULT_COLUMNS.map((c) => ({ ...c }));
  // Start from defaults so newly-added columns (after an app upgrade)
  // show up with their default visibility; apply saved width/visible
  // where present.
  return DEFAULT_COLUMNS.map((def) => {
    const s = saved.find((x) => x.id === def.id);
    if (!s) return { ...def };
    return {
      ...def,
      width: typeof s.width === "number" && s.width > 0 ? s.width : def.width,
      visible: def.required ? true : Boolean(s.visible),
    };
  });
}

export const useColumns = create<ColumnState>((set, get) => ({
  columns: DEFAULT_COLUMNS.map((c) => ({ ...c })),
  loaded: false,

  load: async () => {
    try {
      const saved = await api.settingsGet<Persisted[]>(STORAGE_KEY);
      set({ columns: mergeDefaults(saved), loaded: true });
    } catch (err) {
      console.warn("[columns] failed to load", err);
      set({ loaded: true });
    }
  },

  setVisible: (id, v) => {
    const next = get().columns.map((c) =>
      c.id === id ? { ...c, visible: c.required ? true : v } : c,
    );
    set({ columns: next });
    persist(next);
  },

  setWidth: (id, w) => {
    const clamped = Math.max(40, Math.min(600, Math.round(w)));
    const next = get().columns.map((c) => (c.id === id ? { ...c, width: clamped } : c));
    set({ columns: next });
    persist(next);
  },

  resetDefaults: () => {
    const next = DEFAULT_COLUMNS.map((c) => ({ ...c }));
    set({ columns: next });
    persist(next);
  },
}));

/** Convenience helper for components that only need the visible set. */
export function visibleColumns(cols: ColumnDef[]): ColumnDef[] {
  return cols.filter((c) => c.visible);
}
