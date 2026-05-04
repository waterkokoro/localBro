import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBrowser, isCollectionPath, collectionIdOf } from "../store";
import * as api from "../api";
import { pathSegments } from "../utils";
import SettingsDropdown from "./SettingsDropdown";
import InputPromptModal from "./InputPromptModal";
import type { ViewMode } from "../types";

/** Fire-and-forget helpers for top-right buttons. Avoids prop-drilling. */
function openAi() {
  window.dispatchEvent(new Event("lb:open-ai"));
}

/** Last component of a native path (handles both `/` and `\`). */
function baseName(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

/** Join `dir` and `name` using the separator already present in `dir`. */
function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

export default function Toolbar() {
  const { t } = useTranslation();
  const cwd = useBrowser((s) => s.cwd);
  const history = useBrowser((s) => s.history);
  const historyIdx = useBrowser((s) => s.historyIdx);
  const goBack = useBrowser((s) => s.goBack);
  const goForward = useBrowser((s) => s.goForward);
  const goUp = useBrowser((s) => s.goUp);
  const refresh = useBrowser((s) => s.refresh);
  const navigate = useBrowser((s) => s.navigate);
  const viewMode = useBrowser((s) => s.viewMode);
  const setViewMode = useBrowser((s) => s.setViewMode);
  const showHidden = useBrowser((s) => s.showHidden);
  const setShowHidden = useBrowser((s) => s.setShowHidden);
  const collections = useBrowser((s) => s.collections);
  const selection = useBrowser((s) => s.selection);
  const addToCollection = useBrowser((s) => s.addToCollection);
  const removeFromCollection = useBrowser((s) => s.removeFromCollection);
  const createCollection = useBrowser((s) => s.createCollection);

  const [addressEditing, setAddressEditing] = useState(false);
  const [addressValue, setAddressValue] = useState(cwd);
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newColPromptOpen, setNewColPromptOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const settingsWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAddressValue(cwd);
  }, [cwd]);

  // Close the "Add to" menu when clicking outside.
  useEffect(() => {
    if (!addOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [addOpen]);

  const canBack = historyIdx > 0;
  const canForward = historyIdx < history.length - 1;
  const viewingCollection = isCollectionPath(cwd);
  const currentCollectionId = viewingCollection ? collectionIdOf(cwd) : null;
  const currentCollection = currentCollectionId
    ? collections.find((c) => c.id === currentCollectionId) ?? null
    : null;

  const segments = viewingCollection ? [] : pathSegments(cwd);

  const views: { v: ViewMode; label: string; title: string }[] = [
    { v: "list", label: "☰", title: t("toolbar.viewList") },
    { v: "grid", label: "▦", title: t("toolbar.viewGrid") },
    { v: "details", label: "⋮", title: t("toolbar.viewDetails") },
  ];

  const submitAddress = async () => {
    setAddressEditing(false);
    if (addressValue && addressValue !== cwd) {
      await navigate(addressValue);
    }
  };

  const handleAddTo = async (colId: string) => {
    const paths = Array.from(selection);
    if (paths.length === 0) return;
    try {
      await addToCollection(colId, paths);
    } catch (e) {
      console.error("add to collection failed:", e);
    }
    setAddOpen(false);
  };

  const handleAddToNew = () => {
    if (selection.size === 0) return;
    // Tauri's WKWebView swallows window.prompt() on macOS, so we use
    // our own modal. Close the "Add to" dropdown first so the modal
    // isn't hidden behind an outside-click race.
    setAddOpen(false);
    setNewColPromptOpen(true);
  };

  const submitNewCollection = async (name: string) => {
    const paths = Array.from(selection);
    try {
      const c = await createCollection(name);
      if (paths.length > 0) {
        await addToCollection(c.id, paths);
      }
    } catch (e) {
      window.alert(`Create collection failed: ${e}`);
      return;
    }
    setNewColPromptOpen(false);
  };

  const handleRemoveFromCurrent = async () => {
    if (!currentCollectionId || selection.size === 0) return;
    try {
      await removeFromCollection(currentCollectionId, Array.from(selection));
    } catch (e) {
      console.error("remove from collection failed:", e);
    }
  };

  // --- Archive helpers --------------------------------------------------

  const selectedPaths = Array.from(selection);
  // Single-select archive unlocks the Extract shortcut.
  const singleArchive =
    selectedPaths.length === 1 && api.isArchivePath(selectedPaths[0])
      ? selectedPaths[0]
      : null;

  const handleCompress = async () => {
    if (viewingCollection) return;
    if (selectedPaths.length === 0) return;
    const defaultName =
      selectedPaths.length === 1
        ? `${baseName(selectedPaths[0])}.zip`
        : "archive.zip";
    const name = window.prompt("Create zip as:", defaultName);
    if (!name || !name.trim()) return;
    const finalName = name.trim().toLowerCase().endsWith(".zip")
      ? name.trim()
      : `${name.trim()}.zip`;
    const dest = joinPath(cwd, finalName);
    try {
      await api.createZip(selectedPaths, dest);
      await refresh();
    } catch (e) {
      window.alert(`Compress failed: ${e}`);
    }
  };

  const handleExtract = async () => {
    if (!singleArchive) return;
    try {
      const dest = await api.defaultExtractDir(singleArchive);
      await api.extractArchive(singleArchive, dest);
      await refresh();
      navigate(dest);
    } catch (e) {
      window.alert(`Extract failed: ${e}`);
    }
  };

  return (
    <div className="toolbar">
      <div className="nav-btns">
        <button onClick={goBack} disabled={!canBack} title={t("toolbar.back")}>←</button>
        <button onClick={goForward} disabled={!canForward} title={t("toolbar.forward")}>→</button>
        <button onClick={goUp} disabled={viewingCollection} title={t("toolbar.up")}>↑</button>
        <button onClick={refresh} title={t("toolbar.refresh")}>⟳</button>
      </div>

      <div
        className="crumbs"
        onDoubleClick={() => !viewingCollection && setAddressEditing(true)}
        title={viewingCollection ? "" : t("toolbar.editAddress")}
      >
        {viewingCollection ? (
          <>
            <span className="crumb">⭐ Collections</span>
            <span className="sep">/</span>
            <span className="crumb last">{currentCollection?.name ?? "Unknown"}</span>
          </>
        ) : addressEditing ? (
          <input
            type="text"
            autoFocus
            style={{ flex: 1, border: "none", background: "transparent", padding: 0 }}
            value={addressValue}
            onChange={(e) => setAddressValue(e.currentTarget.value)}
            onBlur={submitAddress}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitAddress();
              else if (e.key === "Escape") {
                setAddressValue(cwd);
                setAddressEditing(false);
              }
            }}
          />
        ) : (
          segments.map((seg, i) => (
            <span key={seg.path} style={{ display: "contents" }}>
              {i > 0 && <span className="sep">/</span>}
              <span
                className={`crumb ${i === segments.length - 1 ? "last" : ""}`}
                onClick={() => navigate(seg.path)}
              >
                {seg.label}
              </span>
            </span>
          ))
        )}
      </div>

      {/* Selection actions ------------------------------------------- */}
      {selection.size > 0 && (
        <div className="sel-actions" ref={addMenuRef}>
          <button
            onClick={() => setAddOpen((v) => !v)}
            title={t("toolbar.addToTitle")}
          >
            ⭐ {t("toolbar.addTo")} ({selection.size})
          </button>
          {addOpen && (
            <div className="menu">
              {collections.length === 0 && (
                <div className="menu-empty">{t("sidebar.noCollections")}</div>
              )}
              {collections.map((c) => (
                <button
                  key={c.id}
                  className="menu-item"
                  onClick={() => handleAddTo(c.id)}
                >
                  <span className="icon">{c.icon ?? "⭐"}</span>
                  <span className="label">{c.name}</span>
                  <span className="count">{c.items.length}</span>
                </button>
              ))}
              <div className="menu-sep" />
              <button className="menu-item" onClick={handleAddToNew}>
                ＋ {t("sidebar.newCollection")}…
              </button>
            </div>
          )}
          {viewingCollection && (
            <button onClick={handleRemoveFromCurrent} title={t("ctx.removeFromCollection")}>
              ✕ {t("toolbar.remove")}
            </button>
          )}
          {!viewingCollection && (
            <button onClick={handleCompress} title={t("toolbar.compressTitle")}>
              🗜 {t("toolbar.compress")}
            </button>
          )}
          {singleArchive && !viewingCollection && (
            <button onClick={handleExtract} title={t("ctx.extract")}>
              📦 {t("toolbar.extract")}
            </button>
          )}
        </div>
      )}

      <label title={t("toolbar.hidden")} style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="checkbox"
          checked={showHidden}
          disabled={viewingCollection}
          onChange={(e) => setShowHidden(e.currentTarget.checked)}
        />
        <span style={{ fontSize: "var(--lb-fs-sm)" }}>{t("toolbar.hidden")}</span>
      </label>

      <button
        className="tb-icon"
        onClick={openAi}
        title={t("toolbar.ai")}
      >
        🤖
      </button>

      <div className="view-switch">
        {views.map((v) => (
          <button
            key={v.v}
            className={viewMode === v.v ? "active" : ""}
            onClick={() => setViewMode(v.v)}
            title={v.title}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="settings-wrap" ref={settingsWrapRef}>
        <button
          className={`tb-icon${settingsOpen ? " active" : ""}`}
          onClick={() => setSettingsOpen((v) => !v)}
          title={t("toolbar.settings")}
          aria-haspopup="menu"
          aria-expanded={settingsOpen}
        >
          ⚙
        </button>
        {settingsOpen && (
          <SettingsDropdown onClose={() => setSettingsOpen(false)} />
        )}
      </div>
      {newColPromptOpen && (
        <InputPromptModal
          title={t("ctx.addToNew")}
          onSubmit={submitNewCollection}
          onClose={() => setNewColPromptOpen(false)}
          submitLabel={t("common.create")}
        />
      )}
    </div>
  );
}
