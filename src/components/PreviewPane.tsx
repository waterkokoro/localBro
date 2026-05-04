import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useBrowser } from "../store";
import { resolveAdapter } from "../preview/registry";
import { formatSize, iconFor } from "../utils";
import * as api from "../api";

interface Props {
  /**
   * Session-level dismiss callback fired when the user clicks the ✕
   * button. The pane intentionally does NOT toggle the persisted
   * `previewPaneEnabled` preference here — only the Settings dropdown
   * / modal can do that. See App.tsx for the dismissal state.
   */
  onDismiss: () => void;
}

/**
 * Right-side preview panel that follows the current selection. Unlike
 * PreviewModal (Space / QuickLook), this panel is always on when the
 * user has enabled it in Settings → General AND a single non-directory
 * file is selected. The parent (App) decides whether to mount it; this
 * component assumes it only renders when there's something to show.
 */
export default function PreviewPane({ onDismiss }: Props) {
  const entries = useBrowser((s) => s.entries);
  const selection = useBrowser((s) => s.selection);
  const { t } = useTranslation();

  // Parent guarantees a valid single-file selection, but we still
  // resolve defensively in case the entry list changes mid-render
  // (e.g. a background refresh while the user is still selecting).
  const entry = useMemo(() => {
    if (selection.size !== 1) return null;
    const only = [...selection][0];
    return entries.find((e) => e.path === only) ?? null;
  }, [entries, selection]);

  const adapter = entry ? resolveAdapter(entry) : null;
  const Body = adapter?.component;

  if (!entry || entry.kind === "directory") {
    // Defensive fallback: parent should have unmounted us already.
    return null;
  }

  return (
    <aside className="preview-pane" aria-label={t("preview.title")}>
      <header className="preview-pane-header">
        <span className="icon">{iconFor(entry)}</span>
        <span className="title" title={entry.path}>
          {entry.name}
        </span>
        <span className="muted">{formatSize(entry.size)}</span>
        <button
          className="close"
          onClick={onDismiss}
          title={t("preview.hide")}
          aria-label={t("preview.hide")}
        >
          ✕
        </button>
      </header>

      <div className="preview-pane-body">
        {Body ? (
          <Body entry={entry} />
        ) : (
          <div className="preview-pane-empty">{t("preview.noAdapter")}</div>
        )}
      </div>

      <footer className="preview-pane-footer">
        <button
          onClick={() => api.openWithDefault(entry.path).catch(() => {})}
          title={t("preview.openExternal")}
        >
          {t("preview.openExternal")}
        </button>
        <button
          onClick={() => api.revealInNative(entry.path).catch(() => {})}
          title={t("preview.revealInNative")}
        >
          {t("preview.revealInNative")}
        </button>
        {adapter && <span className="tag">{adapter.label}</span>}
      </footer>
    </aside>
  );
}
