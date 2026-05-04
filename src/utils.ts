export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const SEP_RE = /[\\/]/;

export function basename(path: string): string {
  if (!path) return "";
  const parts = path.split(SEP_RE);
  return parts[parts.length - 1] || path;
}

export function pathSegments(path: string): { label: string; path: string }[] {
  if (!path) return [];
  const isWin = path.includes("\\") && !path.startsWith("/");
  const sep = isWin ? "\\" : "/";
  const segments = path.split(SEP_RE).filter(Boolean);
  const out: { label: string; path: string }[] = [];
  if (!isWin) {
    out.push({ label: "/", path: "/" });
    let cur = "";
    for (const s of segments) {
      cur += "/" + s;
      out.push({ label: s, path: cur });
    }
  } else {
    // Windows: first segment is drive like "C:"
    let cur = "";
    for (let i = 0; i < segments.length; i++) {
      cur = i === 0 ? segments[i] + sep : cur + segments[i] + (i === segments.length - 1 ? "" : sep);
      out.push({ label: segments[i], path: cur });
    }
  }
  return out;
}

export function iconFor(entry: { kind: string; extension: string | null }): string {
  if (entry.kind === "directory") return "📁";
  if (entry.kind === "symlink") return "🔗";
  const ext = entry.extension ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic", "avif", "bmp", "svg"].includes(ext)) return "🖼️";
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "🎞️";
  if (["mp3", "wav", "flac", "aac", "ogg", "m4a"].includes(ext)) return "🎵";
  if (["zip", "tar", "gz", "bz2", "xz", "7z", "rar"].includes(ext)) return "🗜️";
  if (["pdf"].includes(ext)) return "📕";
  if (["md", "txt", "log"].includes(ext)) return "📝";
  if (["js", "ts", "tsx", "jsx", "rs", "py", "go", "java", "c", "cpp", "h", "json"].includes(ext)) return "📄";
  return "📄";
}
