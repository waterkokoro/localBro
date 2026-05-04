export type EntryKind = "file" | "directory" | "symlink" | "other";

export interface FsEntry {
  name: string;
  path: string;
  kind: EntryKind;
  size: number | null;
  modifiedMs: number | null;
  createdMs: number | null;
  hidden: boolean;
  readonly: boolean;
  extension: string | null;
}

export type ShortcutKind =
  | "home"
  | "desktop"
  | "documents"
  | "downloads"
  | "pictures"
  | "music"
  | "videos"
  | "volume"
  | "recent";

export interface Shortcut {
  id: string;
  label: string;
  path: string;
  kind: ShortcutKind;
}

export type ViewMode = "list" | "grid" | "details";

export type SortKey = "name" | "size" | "modified" | "kind";
export type SortDir = "asc" | "desc";
