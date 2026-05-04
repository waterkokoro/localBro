import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api";
import { useBrowser, isCollectionPath } from "../store";
import InputPromptModal from "./InputPromptModal";

/**
 * "Current folder" action menu, shared by the floating action button
 * and the right-click-on-empty-space handler inside the file list.
 * All actions operate on the current working directory — they don't
 * read `selection`, so the menu behaves the same no matter where it
 * was opened from.
 *
 * `anchor.placement`:
 *   - "point": menu top-left snaps to (x, y) (classic right-click)
 *   - "above": menu bottom-right snaps to (x, y) (FAB-style popup)
 * Both modes clamp to the viewport.
 */

interface Anchor {
  x: number;
  y: number;
  placement: "point" | "above";
}

interface Props {
  anchor: Anchor;
  onClose: () => void;
}

interface MenuItem {
  key: string;
  label?: string;
  icon?: string;
  onClick?: () => void | Promise<void>;
  divider?: boolean;
  hidden?: boolean;
  disabled?: boolean;
}

export default function FolderActionsMenu({ anchor, onClose }: Props) {
  const { t } = useTranslation();
  const cwd = useBrowser((s) => s.cwd);
  const viewMode = useBrowser((s) => s.viewMode);
  const setViewMode = useBrowser((s) => s.setViewMode);
  const showHidden = useBrowser((s) => s.showHidden);
  const setShowHidden = useBrowser((s) => s.setShowHidden);
  const refresh = useBrowser((s) => s.refresh);

  const viewingCollection = isCollectionPath(cwd);

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y });
  const [promptFor, setPromptFor] = useState<"folder" | "file" | null>(null);

  // Reposition so the menu never spills off-screen. For "above" we
  // anchor the bottom-right corner; for "point" we anchor the
  // top-left corner.
  useLayoutEffect(() => {
    if (promptFor) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.placement === "above" ? anchor.x - r.width : anchor.x;
    let top = anchor.placement === "above" ? anchor.y - r.height : anchor.y;
    left = Math.max(8, Math.min(vw - r.width - 8, left));
    top = Math.max(8, Math.min(vh - r.height - 8, top));
    setPos({ x: left, y: top });
  }, [anchor.x, anchor.y, anchor.placement, promptFor]);

  // Dismiss on outside click / Escape — suspend while the input
  // prompt is open so clicking inside the modal doesn't close us.
  useEffect(() => {
    if (promptFor) return;
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
  }, [onClose, promptFor]);

  // --- Actions ---------------------------------------------------------

  const joinHere = (name: string): string => {
    const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
    return cwd.endsWith(sep) ? `${cwd}${name}` : `${cwd}${sep}${name}`;
  };

  const close = () => onClose();
  const run = (fn: () => void | Promise<void>) => async () => {
    try {
      await fn();
    } finally {
      close();
    }
  };

  const doCreate = async (name: string) => {
    try {
      if (promptFor === "folder") {
        await api.createDirectory(joinHere(name));
      } else if (promptFor === "file") {
        await api.createFile(joinHere(name));
      }
      await refresh();
    } catch (e) {
      window.alert(`Create failed: ${e}`);
      return;
    }
    setPromptFor(null);
    onClose();
  };

  // Render the input prompt instead of the menu when a "new …" was
  // chosen. Cancelling the prompt returns to the caller (menu closes).
  if (promptFor) {
    return (
      <InputPromptModal
        title={
          promptFor === "folder" ? t("fab.newFolder") : t("fab.newFile")
        }
        message={
          promptFor === "folder"
            ? t("fab.promptNewFolder")
            : t("fab.promptNewFile")
        }
        submitLabel={t("common.create")}
        onSubmit={doCreate}
        onClose={() => {
          setPromptFor(null);
          onClose();
        }}
      />
    );
  }

  const items: MenuItem[] = [
    {
      key: "newFolder",
      icon: "📁",
      label: t("fab.newFolder"),
      onClick: () => setPromptFor("folder"),
      disabled: viewingCollection,
    },
    {
      key: "newFile",
      icon: "📄",
      label: t("fab.newFile"),
      onClick: () => setPromptFor("file"),
      disabled: viewingCollection,
    },
    {
      key: "refresh",
      icon: "⟳",
      label: t("toolbar.refresh"),
      onClick: run(async () => {
        await refresh();
      }),
    },
    { key: "d1", divider: true },
    {
      key: "hidden",
      icon: showHidden ? "☑" : "☐",
      label: t("toolbar.hidden"),
      onClick: run(() => setShowHidden(!showHidden)),
    },
    {
      key: "viewList",
      icon: viewMode === "list" ? "●" : "○",
      label: t("toolbar.viewList"),
      onClick: run(() => setViewMode("list")),
    },
    {
      key: "viewGrid",
      icon: viewMode === "grid" ? "●" : "○",
      label: t("toolbar.viewGrid"),
      onClick: run(() => setViewMode("grid")),
    },
    {
      key: "viewDetails",
      icon: viewMode === "details" ? "●" : "○",
      label: t("toolbar.viewDetails"),
      onClick: run(() => setViewMode("details")),
    },
    { key: "d2", divider: true, hidden: viewingCollection },
    {
      key: "reveal",
      icon: "🗂",
      label: t("fab.revealHere"),
      onClick: run(() => api.revealInNative(cwd).catch(() => {})),
      hidden: viewingCollection,
    },
    {
      key: "openHere",
      icon: "🚀",
      label: t("fab.openHere"),
      onClick: run(() => api.openWithDefault(cwd).catch(() => {})),
      hidden: viewingCollection,
    },
    { key: "d3", divider: true },
    {
      key: "settings",
      icon: "⚙",
      label: t("toolbar.settings"),
      onClick: run(() => {
        window.dispatchEvent(new CustomEvent("lb:open-settings"));
      }),
    },
  ];

  return (
    <div
      ref={ref}
      className="context-menu fab-menu"
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
              className="context-menu-item"
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
