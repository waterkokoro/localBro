import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import Sidebar from "./components/Sidebar";
import Toolbar from "./components/Toolbar";
import FileList from "./components/FileList";
import StatusBar from "./components/StatusBar";
import PreviewModal from "./components/PreviewModal";
import PreviewPane from "./components/PreviewPane";
import AiPanel from "./components/AiPanel";
import SettingsModal from "./components/SettingsModal";
import type { Tab as SettingsTab } from "./components/SettingsModal";
import FloatingActions from "./components/FloatingActions";
import { useBrowser } from "./store";
import { useColumns } from "./columns";
import * as api from "./api";
import { installBuiltinAdapters } from "./preview/builtins";
import { initSkins } from "./skins/manager";
import { initPlugins } from "./plugins/runtime";

// Register built-in preview adapters once at module load. Plugin adapters
// (Task 9) will register themselves on top of these at runtime.
installBuiltinAdapters();

// Apply the persisted skin as early as possible so there's no light-flash
// before a dark skin takes effect. This fire-and-forgets; failures are
// logged inside the manager.
initSkins();

// Load enabled plugins at module load so their preview adapters / AI
// tools are registered before any render needing them.
initPlugins();

// Load persisted column config (width + visibility) before the file
// list paints so the user doesn't see a flicker on first render.
useColumns.getState().load();

interface SizeUpdatedPayload {
  path: string;
  bytes: number;
  file_count: number;
}

/** Concurrency-limited queue for kicking off directory-size scans. */
function useDirSizeQueue() {
  const entries = useBrowser((s) => s.entries);
  const dirSizes = useBrowser((s) => s.dirSizes);
  const setDirSize = useBrowser((s) => s.setDirSize);

  useEffect(() => {
    let cancelled = false;
    const CONCURRENCY = 4;
    const queue = entries
      .filter((e) => e.kind === "directory" && dirSizes[e.path] === undefined)
      .map((e) => e.path);

    let active = 0;
    let idx = 0;

    const pump = () => {
      while (!cancelled && active < CONCURRENCY && idx < queue.length) {
        const path = queue[idx++];
        active++;
        api
          .requestDirSize(path)
          .then((info) => {
            if (cancelled) return;
            if (info) setDirSize(path, info.bytes);
          })
          .catch(() => {
            /* ignore per-path errors */
          })
          .finally(() => {
            active--;
            pump();
          });
      }
    };
    pump();

    return () => {
      cancelled = true;
    };
  }, [entries, dirSizes, setDirSize]);
}

/** Space key opens/closes the QuickLook-style preview for the focused item. */
function usePreviewHotkey() {
  const entries = useBrowser((s) => s.entries);
  const selection = useBrowser((s) => s.selection);
  const previewPath = useBrowser((s) => s.previewPath);
  const openPreview = useBrowser((s) => s.openPreview);
  const closePreview = useBrowser((s) => s.closePreview);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      if (previewPath) {
        // PreviewModal handles its own space-to-close.
        return;
      }

      // Space opens the first selected file (or the first file in the list).
      const selectedFile = entries.find(
        (x) => selection.has(x.path) && x.kind !== "directory",
      );
      const fallback = entries.find((x) => x.kind !== "directory");
      const target2 = selectedFile ?? fallback;
      if (target2) {
        e.preventDefault();
        openPreview(target2.path);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entries, selection, previewPath, openPreview, closePreview]);
}

export default function App() {
  const init = useBrowser((s) => s.init);
  const setDirSize = useBrowser((s) => s.setDirSize);
  const entries = useBrowser((s) => s.entries);
  const selection = useBrowser((s) => s.selection);
  const previewPath = useBrowser((s) => s.previewPath);
  const openPreview = useBrowser((s) => s.openPreview);
  const closePreview = useBrowser((s) => s.closePreview);
  const previewPaneEnabled = useBrowser((s) => s.previewPaneEnabled);
  const aiPanelWidth = useBrowser((s) => s.aiPanelWidth);
  const [aiOpen, setAiOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined);
  // Session-only dismissal for the preview pane. The ✕ button on the
  // pane hides it until the selection changes (or the user re-enables
  // it from Settings) — it must NOT flip the persisted preference.
  const [paneDismissed, setPaneDismissed] = useState(false);

  useEffect(() => {
    init();
    const unlistenPromise = listen<SizeUpdatedPayload>("size-updated", (e) => {
      setDirSize(e.payload.path, e.payload.bytes);
    });
    // Custom event dispatched by the Sidebar button.
    const openAi = () => setAiOpen(true);
    const openSettings = (ev: Event) => {
      const detail = (ev as CustomEvent<{ tab?: SettingsTab }>).detail;
      setSettingsTab(detail?.tab);
      setSettingsOpen(true);
    };
    window.addEventListener("lb:open-ai", openAi);
    window.addEventListener("lb:open-settings", openSettings as EventListener);
    return () => {
      unlistenPromise.then((un) => un());
      window.removeEventListener("lb:open-ai", openAi);
      window.removeEventListener("lb:open-settings", openSettings as EventListener);
    };
  }, [init, setDirSize]);

  useDirSizeQueue();
  usePreviewHotkey();

  const previewEntry =
    previewPath != null ? entries.find((e) => e.path === previewPath) ?? null : null;

  // The pane only makes sense when exactly one non-directory file is
  // selected. Multi-selections, directory selections, and empty
  // selections all skip rendering so the layout doesn't show an idle
  // placeholder column.
  const hasPreviewTarget = useMemo(() => {
    if (selection.size !== 1) return false;
    const only = [...selection][0];
    const entry = entries.find((e) => e.path === only);
    return !!entry && entry.kind !== "directory";
  }, [selection, entries]);

  // A fresh selection re-arms the pane after a manual ✕ dismiss.
  useEffect(() => {
    setPaneDismissed(false);
  }, [selection]);

  // AI panel wins over the preview pane when both would be visible, so
  // they never fight for the 380px column simultaneously.
  const showPreviewPane =
    !aiOpen && previewPaneEnabled && hasPreviewTarget && !paneDismissed;
  const rightClass = aiOpen
    ? "with-ai"
    : showPreviewPane
      ? "with-preview"
      : "";

  return (
    <div
      className={`app ${rightClass}`}
      style={{ ["--lb-ai-width" as string]: `${aiPanelWidth}px` }}
    >
      <Sidebar />
      <Toolbar />
      <FileList />
      <StatusBar />
      {aiOpen && <AiPanel onClose={() => setAiOpen(false)} />}
      {showPreviewPane && (
        <PreviewPane onDismiss={() => setPaneDismissed(true)} />
      )}
      <FloatingActions />
      {settingsOpen && (
        <SettingsModal
          onClose={() => {
            setSettingsOpen(false);
            setSettingsTab(undefined);
          }}
          initialTab={settingsTab}
        />
      )}
      {previewEntry && (
        <PreviewModal
          entry={previewEntry}
          onClose={closePreview}
          onNavigate={(e) => openPreview(e.path)}
        />
      )}
    </div>
  );
}
