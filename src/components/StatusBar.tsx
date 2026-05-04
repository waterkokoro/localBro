import { useBrowser } from "../store";
import { formatSize } from "../utils";

export default function StatusBar() {
  const entries = useBrowser((s) => s.entries);
  const selection = useBrowser((s) => s.selection);
  const dirSizes = useBrowser((s) => s.dirSizes);

  const sizeOf = (e: typeof entries[number]) =>
    e.kind === "directory" ? dirSizes[e.path] ?? 0 : e.size ?? 0;

  const selectedEntries = entries.filter((e) => selection.has(e.path));
  const selectedSize = selectedEntries.reduce((sum, e) => sum + sizeOf(e), 0);
  const files = entries.filter((e) => e.kind !== "directory").length;
  const dirs = entries.length - files;
  const totalSize = entries.reduce((sum, e) => sum + sizeOf(e), 0);
  const pendingDirs = entries.filter(
    (e) => e.kind === "directory" && dirSizes[e.path] === undefined,
  ).length;

  return (
    <div className="statusbar">
      <span>
        {dirs} folders · {files} files
      </span>
      <span>
        Total: {formatSize(totalSize)}
        {pendingDirs > 0 && ` (+${pendingDirs} computing…)`}
      </span>
      {selection.size > 0 && (
        <span>
          {selection.size} selected · {formatSize(selectedSize)}
        </span>
      )}
    </div>
  );
}
