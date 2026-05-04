/**
 * Built-in preview adapters. Registered eagerly on module import.
 */

import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readTextFile, type TextFilePayload } from "../api";
import { formatSize } from "../utils";
import { registerAdapter, type PreviewAdapter, type PreviewProps } from "./registry";
import type { FsEntry } from "../types";

const ext = (e: FsEntry) => e.extension ?? "";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif"];
const VIDEO_EXTS = ["mp4", "webm", "mov", "mkv", "m4v"];
const AUDIO_EXTS = ["mp3", "wav", "flac", "aac", "ogg", "m4a"];
const TEXT_EXTS = [
  "txt", "log", "json", "yaml", "yml", "toml", "ini", "conf", "csv", "tsv",
  "md", "markdown", "js", "ts", "tsx", "jsx", "mjs", "cjs",
  "rs", "py", "go", "java", "kt", "swift", "c", "cc", "cpp", "h", "hpp",
  "rb", "php", "sh", "bash", "zsh", "sql", "html", "htm", "css", "scss",
  "xml", "svg", "vue", "gitignore", "env",
];

// --- Image adapter -------------------------------------------------------

function ImagePreview({ entry }: PreviewProps) {
  const src = convertFileSrc(entry.path);
  return (
    <div className="preview-image">
      <img src={src} alt={entry.name} />
    </div>
  );
}

// --- Video adapter -------------------------------------------------------

function VideoPreview({ entry }: PreviewProps) {
  const src = convertFileSrc(entry.path);
  return (
    <div className="preview-media">
      <video src={src} controls preload="metadata" />
    </div>
  );
}

// --- Audio adapter -------------------------------------------------------

function AudioPreview({ entry }: PreviewProps) {
  const src = convertFileSrc(entry.path);
  return (
    <div className="preview-audio">
      <div className="preview-audio-meta">
        <div className="icon">🎵</div>
        <div className="name">{entry.name}</div>
        <div className="muted">{formatSize(entry.size)}</div>
      </div>
      <audio src={src} controls preload="metadata" />
    </div>
  );
}

// --- PDF adapter ---------------------------------------------------------

function PdfPreview({ entry }: PreviewProps) {
  const src = convertFileSrc(entry.path);
  return (
    <div className="preview-pdf">
      <embed src={src} type="application/pdf" />
    </div>
  );
}

// --- Text / Markdown adapter --------------------------------------------

function TextPreview({ entry }: PreviewProps) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ok"; data: TextFilePayload }
    | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    readTextFile(entry.path, 1024 * 1024)
      .then((data) => {
        if (!cancelled) setState({ status: "ok", data });
      })
      .catch((e) => {
        if (!cancelled) setState({ status: "error", message: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [entry.path]);

  if (state.status === "loading") {
    return <div className="preview-empty">Loading…</div>;
  }
  if (state.status === "error") {
    return <div className="preview-empty error">Failed: {state.message}</div>;
  }
  return (
    <div className="preview-text">
      {state.data.truncated && (
        <div className="preview-banner">
          Showing first {formatSize(state.data.content.length)} of{" "}
          {formatSize(state.data.total_bytes)} (truncated)
        </div>
      )}
      <pre>{state.data.content}</pre>
    </div>
  );
}

// --- Fallback ------------------------------------------------------------

function FallbackPreview({ entry }: PreviewProps) {
  return (
    <div className="preview-fallback">
      <div className="icon">📄</div>
      <div className="name">{entry.name}</div>
      <dl>
        <dt>Path</dt>
        <dd>{entry.path}</dd>
        <dt>Size</dt>
        <dd>{formatSize(entry.size)}</dd>
        <dt>Kind</dt>
        <dd>{entry.extension ? `.${entry.extension}` : entry.kind}</dd>
      </dl>
      <p className="muted">
        No preview available for this file type. Install a plugin adapter to
        add support.
      </p>
    </div>
  );
}

const BUILTINS: PreviewAdapter[] = [
  {
    id: "builtin:image",
    label: "Image",
    priority: 90,
    match: (e) => e.kind === "file" && IMAGE_EXTS.includes(ext(e)),
    component: ImagePreview,
  },
  {
    id: "builtin:video",
    label: "Video",
    priority: 80,
    match: (e) => e.kind === "file" && VIDEO_EXTS.includes(ext(e)),
    component: VideoPreview,
  },
  {
    id: "builtin:audio",
    label: "Audio",
    priority: 80,
    match: (e) => e.kind === "file" && AUDIO_EXTS.includes(ext(e)),
    component: AudioPreview,
  },
  {
    id: "builtin:pdf",
    label: "PDF",
    priority: 70,
    match: (e) => e.kind === "file" && ext(e) === "pdf",
    component: PdfPreview,
  },
  {
    id: "builtin:text",
    label: "Text",
    priority: 10,
    match: (e) => e.kind === "file" && (TEXT_EXTS.includes(ext(e)) || e.extension == null),
    component: TextPreview,
  },
  {
    id: "builtin:fallback",
    label: "Info",
    priority: -1000,
    match: () => true,
    component: FallbackPreview,
  },
];

let installed = false;
export function installBuiltinAdapters() {
  if (installed) return;
  installed = true;
  for (const a of BUILTINS) registerAdapter(a);
}
