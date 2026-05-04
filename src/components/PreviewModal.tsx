import { useEffect, useMemo } from "react";
import { useBrowser, sortEntries } from "../store";
import { resolveAdapter } from "../preview/registry";
import { formatSize, iconFor } from "../utils";
import type { FsEntry } from "../types";

interface Props {
  entry: FsEntry;
  onClose: () => void;
  onNavigate: (entry: FsEntry) => void;
}

export default function PreviewModal({ entry, onClose, onNavigate }: Props) {
  const entries = useBrowser((s) => s.entries);
  const sortKey = useBrowser((s) => s.sortKey);
  const sortDir = useBrowser((s) => s.sortDir);

  // Navigate through siblings with arrow keys.
  const { prev, next } = useMemo(() => {
    const sorted = sortEntries(entries, sortKey, sortDir).filter((e) => e.kind !== "directory");
    const idx = sorted.findIndex((e) => e.path === entry.path);
    return {
      prev: idx > 0 ? sorted[idx - 1] : null,
      next: idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null,
    };
  }, [entries, sortKey, sortDir, entry.path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === " ") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight" && next) {
        e.preventDefault();
        onNavigate(next);
      } else if (e.key === "ArrowLeft" && prev) {
        e.preventDefault();
        onNavigate(prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onNavigate, prev, next]);

  const adapter = resolveAdapter(entry);
  const Body = adapter?.component;

  return (
    <div className="preview-backdrop" onClick={onClose}>
      <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
        <header className="preview-header">
          <span className="icon">{iconFor(entry)}</span>
          <span className="name" title={entry.path}>{entry.name}</span>
          <span className="muted">{formatSize(entry.size)}</span>
          {adapter && <span className="tag">{adapter.label}</span>}
          <div className="spacer" />
          <button
            className="nav"
            disabled={!prev}
            onClick={() => prev && onNavigate(prev)}
            title="Previous"
          >
            ←
          </button>
          <button
            className="nav"
            disabled={!next}
            onClick={() => next && onNavigate(next)}
            title="Next"
          >
            →
          </button>
          <button onClick={onClose} title="Close (Esc)">✕</button>
        </header>

        <div className="preview-body">
          {Body ? <Body entry={entry} /> : <div className="preview-empty">No preview.</div>}
        </div>
      </div>
    </div>
  );
}
