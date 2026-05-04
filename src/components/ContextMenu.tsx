import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import {
  useBrowser,
  isCollectionPath,
  collectionIdOf,
  COLLECTION_SCHEME,
} from "../store";
import { basename, formatDate, formatSize } from "../utils";
import type { FsEntry } from "../types";

/**
 * A right-click context menu item. `divider: true` renders a separator
 * and ignores `onClick`; items with `hidden: true` are filtered out so
 * callers can keep a flat declarative array.
 */
interface MenuItem {
  key: string;
  label?: string;
  icon?: string;
  onClick?: () => void | Promise<void>;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  divider?: boolean;
}

interface Props {
  /** The entry the user right-clicked on (primary target). */
  target: FsEntry;
  /** Viewport-space coordinates of the click. */
  x: number;
  y: number;
  onClose: () => void;
}

/**
 * Right-click menu shown over a file list row. Inspired by Finder /
 * Windows Explorer, but deliberately limited to the operations we can
 * execute end-to-end (no empty submenus or placeholder commands).
 *
 * Clipboard-style cut/copy/paste is not yet implemented because the
 * copy_path/move_path backend commands take a concrete destination,
 * and a proper clipboard would need its own store state.
 */
export default function ContextMenu({ target, x, y, onClose }: Props) {
  const { t } = useTranslation();
  const cwd = useBrowser((s) => s.cwd);
  const selection = useBrowser((s) => s.selection);
  const collections = useBrowser((s) => s.collections);
  const addToCollection = useBrowser((s) => s.addToCollection);
  const removeFromCollection = useBrowser((s) => s.removeFromCollection);
  const createCollection = useBrowser((s) => s.createCollection);
  const refresh = useBrowser((s) => s.refresh);
  const navigate = useBrowser((s) => s.navigate);
  const openPreview = useBrowser((s) => s.openPreview);

  // If the user right-clicked on something that's already in the multi-
  // selection we operate on the whole selection; otherwise only on the
  // click target (matching Finder/Explorer behaviour).
  const paths = selection.has(target.path)
    ? Array.from(selection)
    : [target.path];
  const multi = paths.length > 1;

  const viewingCollection = isCollectionPath(cwd);
  const currentCollectionId = viewingCollection ? collectionIdOf(cwd) : null;

  // Reposition so the menu never spills off-screen. We run in a layout
  // effect so the user never sees a pre-adjustment flash.
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (x + r.width > vw - 8) nx = Math.max(8, vw - r.width - 8);
    if (y + r.height > vh - 8) ny = Math.max(8, vh - r.height - 8);
    setPos({ x: nx, y: ny });
  }, [x, y]);

  // Dismiss on outside click / Escape.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // --- Action handlers ---------------------------------------------------

  const run = (fn: () => void | Promise<void>) => async () => {
    try {
      await fn();
    } finally {
      onClose();
    }
  };

  const doOpen = async () => {
    if (target.kind === "directory") {
      await navigate(target.path);
    } else {
      await api.openWithDefault(target.path).catch((e) =>
        window.alert(`Open failed: ${e}`),
      );
    }
  };

  const doPreview = () => openPreview(target.path);

  const doReveal = async () => {
    await api.revealInNative(target.path).catch((e) =>
      window.alert(`Reveal failed: ${e}`),
    );
  };

  const doRename = async () => {
    if (multi) return;
    const next = window.prompt(t("ctx.promptNewName"), target.name);
    if (!next || !next.trim() || next === target.name) return;
    try {
      await api.rename(target.path, next.trim());
      await refresh();
    } catch (e) {
      window.alert(`Rename failed: ${e}`);
    }
  };

  const doCopyPath = async () => {
    await navigator.clipboard.writeText(paths.join("\n")).catch(() => {});
  };

  const doCopyName = async () => {
    const names = paths.map((p) => basename(p)).join("\n");
    await navigator.clipboard.writeText(names).catch(() => {});
  };

  const doCompress = async () => {
    if (viewingCollection) return;
    const def =
      paths.length === 1 ? `${basename(paths[0])}.zip` : "archive.zip";
    const name = window.prompt(t("ctx.promptZipName"), def);
    if (!name || !name.trim()) return;
    const finalName = name.trim().toLowerCase().endsWith(".zip")
      ? name.trim()
      : `${name.trim()}.zip`;
    const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
    const dest = cwd.endsWith(sep) ? `${cwd}${finalName}` : `${cwd}${sep}${finalName}`;
    try {
      await api.createZip(paths, dest);
      await refresh();
    } catch (e) {
      window.alert(`Compress failed: ${e}`);
    }
  };

  const doExtract = async () => {
    if (multi) return;
    try {
      const dest = await api.defaultExtractDir(target.path);
      await api.extractArchive(target.path, dest);
      await refresh();
      await navigate(dest);
    } catch (e) {
      window.alert(`Extract failed: ${e}`);
    }
  };

  const doAddTo = async (colId: string) => {
    await addToCollection(colId, paths);
  };

  const doAddToNew = async () => {
    const name = window.prompt(t("ctx.addToNew"));
    if (!name || !name.trim()) return;
    try {
      const c = await createCollection(name.trim());
      await addToCollection(c.id, paths);
    } catch (e) {
      window.alert(`Create collection failed: ${e}`);
    }
  };

  const doRemoveFromCurrent = async () => {
    if (!currentCollectionId) return;
    await removeFromCollection(currentCollectionId, paths);
  };

  const doTrash = async () => {
    try {
      for (const p of paths) await api.moveToTrash(p);
      await refresh();
    } catch (e) {
      window.alert(`Move to trash failed: ${e}`);
    }
  };

  const doDelete = async () => {
    const label = multi ? `${paths.length} items` : target.name;
    if (!window.confirm(t("ctx.confirmDelete", { name: label }))) return;
    try {
      for (const p of paths) await api.deleteForever(p);
      await refresh();
    } catch (e) {
      window.alert(`Delete failed: ${e}`);
    }
  };

  const doProperties = async () => {
    try {
      const info = await api.stat(target.path);
      const lines = [
        `${info.name}`,
        `${info.path}`,
        "",
        `${t("list.column.kind")}: ${info.kind}${info.extension ? ` (.${info.extension})` : ""}`,
        `${t("list.column.size")}: ${formatSize(info.size)}`,
        `${t("list.column.modified")}: ${formatDate(info.modifiedMs)}`,
        `${t("list.column.created")}: ${formatDate(info.createdMs)}`,
      ];
      window.alert(lines.join("\n"));
    } catch (e) {
      window.alert(`Stat failed: ${e}`);
    }
  };

  const isArchive = !multi && api.isArchivePath(target.path);
  const isDir = target.kind === "directory";

  // Declarative item list — easier to tweak ordering than nested JSX.
  const items: MenuItem[] = [
    {
      key: "open",
      icon: isDir ? "📂" : "🚀",
      label: isDir ? t("ctx.open") : t("ctx.openExternal"),
      onClick: run(doOpen),
      disabled: multi,
    },
    {
      key: "preview",
      icon: "👁",
      label: t("ctx.preview"),
      onClick: run(doPreview),
      hidden: isDir,
      disabled: multi,
    },
    {
      key: "reveal",
      icon: "🗂",
      label: t("ctx.reveal"),
      onClick: run(doReveal),
      disabled: multi,
    },
    { key: "d1", divider: true },
    {
      key: "rename",
      icon: "✏️",
      label: t("ctx.rename"),
      onClick: run(doRename),
      disabled: multi || viewingCollection,
    },
    {
      key: "copyPath",
      icon: "📋",
      label: t("ctx.copyPath"),
      onClick: run(doCopyPath),
    },
    {
      key: "copyName",
      icon: "🔤",
      label: t("ctx.copyName"),
      onClick: run(doCopyName),
    },
    { key: "d2", divider: true },
    {
      key: "compress",
      icon: "🗜",
      label: t("ctx.compress"),
      onClick: run(doCompress),
      hidden: viewingCollection,
    },
    {
      key: "extract",
      icon: "📦",
      label: t("ctx.extract"),
      onClick: run(doExtract),
      hidden: !isArchive,
    },
    { key: "d3", divider: true, hidden: collections.length === 0 && !viewingCollection },
    ...collections.map<MenuItem>((c) => ({
      key: `col-${c.id}`,
      icon: c.icon ?? "⭐",
      label: `${t("ctx.addTo")}: ${c.name}`,
      onClick: run(() => doAddTo(c.id)),
      hidden: viewingCollection && `${COLLECTION_SCHEME}${c.id}` === cwd,
    })),
    {
      key: "addNew",
      icon: "＋",
      label: t("ctx.addToNew"),
      onClick: run(doAddToNew),
      hidden: viewingCollection,
    },
    {
      key: "removeCol",
      icon: "➖",
      label: t("ctx.removeFromCollection"),
      onClick: run(doRemoveFromCurrent),
      hidden: !viewingCollection,
    },
    { key: "d4", divider: true },
    {
      key: "trash",
      icon: "🗑",
      label: t("ctx.trash"),
      onClick: run(doTrash),
      danger: true,
      disabled: viewingCollection,
    },
    {
      key: "delete",
      icon: "⛔",
      label: t("ctx.deleteForever"),
      onClick: run(doDelete),
      danger: true,
      disabled: viewingCollection,
    },
    { key: "d5", divider: true, hidden: multi },
    {
      key: "props",
      icon: "ℹ️",
      label: t("ctx.properties"),
      onClick: run(doProperties),
      hidden: multi,
    },
  ];

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
    >
      {items
        .filter((it) => !it.hidden)
        .map((it) =>
          it.divider ? (
            <div key={it.key} className="context-menu-sep" />
          ) : (
            <button
              key={it.key}
              className={`context-menu-item${it.danger ? " danger" : ""}`}
              onClick={it.onClick}
              disabled={it.disabled}
              role="menuitem"
            >
              <span className="icon">{it.icon}</span>
              <span className="label">{it.label}</span>
            </button>
          ),
        )}
    </div>
  );
}
