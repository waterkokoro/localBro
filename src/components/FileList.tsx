import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBrowser, sortEntries } from "../store";
import { useColumns, visibleColumns, type ColumnDef, type ColumnId } from "../columns";
import * as api from "../api";
import { formatDate, formatSize, iconFor } from "../utils";
import ContextMenu from "./ContextMenu";
import FolderActionsMenu from "./FolderActionsMenu";
import type { FsEntry, SortKey } from "../types";

/** Effective display size: for directories use the computed index value if any. */
function useSizeOf() {
  const dirSizes = useBrowser((s) => s.dirSizes);
  return (e: FsEntry): number | null => {
    if (e.kind === "directory") {
      return dirSizes[e.path] ?? null;
    }
    return e.size;
  };
}

function useSortedEntries(): FsEntry[] {
  const entries = useBrowser((s) => s.entries);
  const sortKey = useBrowser((s) => s.sortKey);
  const sortDir = useBrowser((s) => s.sortDir);
  return useMemo(() => sortEntries(entries, sortKey, sortDir), [entries, sortKey, sortDir]);
}

function useRowHandlers() {
  const navigate = useBrowser((s) => s.navigate);
  const toggleSelection = useBrowser((s) => s.toggleSelection);
  const refresh = useBrowser((s) => s.refresh);

  const onClick = (entry: FsEntry, e: React.MouseEvent) => {
    const additive = e.metaKey || e.ctrlKey;
    toggleSelection(entry.path, additive);
  };

  const onDoubleClick = async (entry: FsEntry) => {
    if (entry.kind === "directory") {
      navigate(entry.path);
      return;
    }
    // Archives: offer to extract next to the file. This matches the
    // Finder/Explorer mental model of "double-click to unpack".
    if (api.isArchivePath(entry.path)) {
      try {
        const dest = await api.defaultExtractDir(entry.path);
        const ok = window.confirm(
          `Extract "${entry.name}" to:\n\n${dest}\n\nPress OK to extract, Cancel to open instead.`,
        );
        if (ok) {
          await api.extractArchive(entry.path, dest);
          await refresh();
          navigate(dest);
          return;
        }
      } catch (err) {
        window.alert(`Extraction failed: ${err}`);
        return;
      }
    }
    // Default: hand the file off to the OS-default application, the
    // same as double-clicking in Finder / Explorer.
    try {
      await api.openWithDefault(entry.path);
    } catch (err) {
      window.alert(`Open failed: ${err}`);
    }
  };

  return { onClick, onDoubleClick };
}

export default function FileList() {
  const viewMode = useBrowser((s) => s.viewMode);
  const loading = useBrowser((s) => s.loading);
  const error = useBrowser((s) => s.error);
  const entries = useSortedEntries();
  const toggleSelection = useBrowser((s) => s.toggleSelection);
  const selection = useBrowser((s) => s.selection);
  const { t } = useTranslation();

  // Single owner of the context-menu state so both DetailsView and
  // GridView can open it via the same callback.
  const [menuState, setMenuState] = useState<{
    entry: FsEntry;
    x: number;
    y: number;
  } | null>(null);

  // Right-click on empty space (not on a row/cell) opens a folder-
  // level menu identical to the floating action button's menu.
  const [blankMenu, setBlankMenu] = useState<{ x: number; y: number } | null>(
    null,
  );

  const openContextMenu = (entry: FsEntry, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // If the right-clicked row isn't part of the current selection,
    // switch the selection to just this row — matches Finder/Explorer.
    if (!selection.has(entry.path)) {
      toggleSelection(entry.path, false);
    }
    setMenuState({ entry, x: e.clientX, y: e.clientY });
  };

  // Container-level context handler. Row/cell handlers already call
  // stopPropagation, so this only fires when the user right-clicks on
  // blank area (gutter, empty list, padding around the grid, etc.).
  const openBlankMenu = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && el.closest(".list-row, .grid-cell")) return;
    e.preventDefault();
    setBlankMenu({ x: e.clientX, y: e.clientY });
  };

  if (error) {
    return (
      <div className="main" onContextMenu={openBlankMenu}>
        <div className="error-state">{t("list.loadFailed", { error })}</div>
        {blankMenu && (
          <FolderActionsMenu
            anchor={{ x: blankMenu.x, y: blankMenu.y, placement: "point" }}
            onClose={() => setBlankMenu(null)}
          />
        )}
      </div>
    );
  }

  if (loading && entries.length === 0) {
    return (
      <div className="main" onContextMenu={openBlankMenu}>
        <div className="empty-state">{t("list.loading")}</div>
        {blankMenu && (
          <FolderActionsMenu
            anchor={{ x: blankMenu.x, y: blankMenu.y, placement: "point" }}
            onClose={() => setBlankMenu(null)}
          />
        )}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="main" onContextMenu={openBlankMenu}>
        <div className="empty-state">{t("list.empty")}</div>
        {blankMenu && (
          <FolderActionsMenu
            anchor={{ x: blankMenu.x, y: blankMenu.y, placement: "point" }}
            onClose={() => setBlankMenu(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="main" onContextMenu={openBlankMenu}>
      {viewMode === "grid" ? (
        <GridView entries={entries} onContextMenu={openContextMenu} />
      ) : (
        // List and Details share the same renderer so the column header
        // (sort + resize + ⋮ manage) is always visible. The only real
        // difference between the two used to be header presence; keeping
        // one path avoids the "I don't see columns" confusion.
        <DetailsView entries={entries} onContextMenu={openContextMenu} />
      )}
      {menuState && (
        <ContextMenu
          target={menuState.entry}
          x={menuState.x}
          y={menuState.y}
          onClose={() => setMenuState(null)}
        />
      )}
      {blankMenu && (
        <FolderActionsMenu
          anchor={{ x: blankMenu.x, y: blankMenu.y, placement: "point" }}
          onClose={() => setBlankMenu(null)}
        />
      )}
    </div>
  );
}

function DetailsView({
  entries,
  onContextMenu,
}: {
  entries: FsEntry[];
  onContextMenu: (e: FsEntry, ev: React.MouseEvent) => void;
}) {
  const selection = useBrowser((s) => s.selection);
  const sortKey = useBrowser((s) => s.sortKey);
  const sortDir = useBrowser((s) => s.sortDir);
  const setSort = useBrowser((s) => s.setSort);
  const columns = useColumns((s) => s.columns);
  const setVisible = useColumns((s) => s.setVisible);
  const setWidth = useColumns((s) => s.setWidth);
  const { onClick, onDoubleClick } = useRowHandlers();
  const sizeOf = useSizeOf();
  const { t } = useTranslation();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const visible = visibleColumns(columns);
  const sortableKeys: Record<ColumnId, SortKey | null> = {
    name: "name",
    size: "size",
    modified: "modified",
    kind: "kind",
    extension: null,
  };
  const indicator = (k: SortKey) =>
    sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const onResizeStart = (id: ColumnId, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = columns.find((c) => c.id === id)?.width ?? 80;
    const move = (ev: MouseEvent) => {
      setWidth(id, startW + (ev.clientX - startX));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <>
      <div className="details-header">
        {visible.map((col) => {
          const sk = sortableKeys[col.id];
          const style =
            col.id === "name" ? undefined : { width: `${col.width}px`, flex: "0 0 auto" as const };
          return (
            <span
              key={col.id}
              className={`col ${col.id}`}
              style={style}
              onClick={() => sk && setSort(sk)}
            >
              {t(col.labelKey)}
              {sk ? indicator(sk) : ""}
              {!col.required && (
                <span
                  className="col-resizer"
                  onMouseDown={(e) => onResizeStart(col.id, e)}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </span>
          );
        })}
        <div className="col-menu" ref={menuRef}>
          <button
            className="col-menu-btn"
            onClick={() => setMenuOpen((v) => !v)}
            title={t("list.manageColumns")}
          >
            ⋮
          </button>
          {menuOpen && (
            <div className="menu">
              {columns.map((c) => (
                <label key={c.id} className="menu-item col-toggle">
                  <input
                    type="checkbox"
                    checked={c.visible}
                    disabled={c.required}
                    onChange={(e) => setVisible(c.id, e.currentTarget.checked)}
                  />
                  <span className="label">{t(c.labelKey)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="list-view">
        {entries.map((e) => (
          <div
            key={e.path}
            className={`list-row ${selection.has(e.path) ? "selected" : ""}`}
            onClick={(ev) => onClick(e, ev)}
            onDoubleClick={() => onDoubleClick(e)}
            onContextMenu={(ev) => onContextMenu(e, ev)}
          >
            <span className="icon">{iconFor(e)}</span>
            {visible.map((col) => (
              <ColumnCell key={col.id} col={col} entry={e} sizeOf={sizeOf} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function ColumnCell({
  col,
  entry,
  sizeOf,
}: {
  col: ColumnDef;
  entry: FsEntry;
  sizeOf: (e: FsEntry) => number | null;
}) {
  const style =
    col.id === "name" ? undefined : { width: `${col.width}px`, flex: "0 0 auto" as const };
  switch (col.id) {
    case "name":
      return <span className="name" style={style}>{entry.name}</span>;
    case "size":
      return <span className="size" style={style}>{formatSize(sizeOf(entry))}</span>;
    case "modified":
      return <span className="date" style={style}>{formatDate(entry.modifiedMs)}</span>;
    case "kind":
      return (
        <span className="kind" style={style}>
          {entry.kind === "directory"
            ? "—"
            : (entry.extension ?? "").toUpperCase() || entry.kind}
        </span>
      );
    case "extension":
      return (
        <span className="ext" style={style}>
          {entry.extension ?? ""}
        </span>
      );
  }
}

function GridView({
  entries,
  onContextMenu,
}: {
  entries: FsEntry[];
  onContextMenu: (e: FsEntry, ev: React.MouseEvent) => void;
}) {
  const selection = useBrowser((s) => s.selection);
  const { onClick, onDoubleClick } = useRowHandlers();

  return (
    <div className="grid-view">
      {entries.map((e) => (
        <div
          key={e.path}
          className={`grid-cell ${selection.has(e.path) ? "selected" : ""}`}
          onClick={(ev) => onClick(e, ev)}
          onDoubleClick={() => onDoubleClick(e)}
          onContextMenu={(ev) => onContextMenu(e, ev)}
          title={e.name}
        >
          <div className="icon">{iconFor(e)}</div>
          <div className="name">{e.name}</div>
        </div>
      ))}
    </div>
  );
}
