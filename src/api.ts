import { invoke } from "@tauri-apps/api/core";
import type { FsEntry, Shortcut } from "./types";

// Rust uses snake_case in serde output by default for fields, so we translate
// at the boundary to keep the rest of the TS code camelCase.
interface RawEntry {
  name: string;
  path: string;
  kind: FsEntry["kind"];
  size: number | null;
  modified_ms: number | null;
  created_ms: number | null;
  hidden: boolean;
  readonly: boolean;
  extension: string | null;
}

function normalize(raw: RawEntry): FsEntry {
  return {
    name: raw.name,
    path: raw.path,
    kind: raw.kind,
    size: raw.size,
    modifiedMs: raw.modified_ms,
    createdMs: raw.created_ms,
    hidden: raw.hidden,
    readonly: raw.readonly,
    extension: raw.extension,
  };
}

export interface ListOptions {
  showHidden?: boolean;
  followSymlinks?: boolean;
}

export async function listDir(path: string, options?: ListOptions): Promise<FsEntry[]> {
  const raw = await invoke<RawEntry[]>("list_dir", {
    path,
    options: options
      ? {
          show_hidden: !!options.showHidden,
          follow_symlinks: !!options.followSymlinks,
        }
      : null,
  });
  return raw.map(normalize);
}

export async function stat(path: string): Promise<FsEntry> {
  const raw = await invoke<RawEntry>("stat", { path });
  return normalize(raw);
}

export function parentOf(path: string): Promise<string> {
  return invoke<string>("parent_of", { path });
}

export function homePath(): Promise<string> {
  return invoke<string>("home_path");
}

export function defaultShortcuts(): Promise<Shortcut[]> {
  return invoke<Shortcut[]>("default_shortcuts");
}

export function listVolumes(): Promise<Shortcut[]> {
  return invoke<Shortcut[]>("list_volumes");
}

export function createDirectory(path: string): Promise<void> {
  return invoke("create_directory", { path });
}

export function createFile(path: string): Promise<void> {
  return invoke("create_file", { path });
}

/**
 * Write UTF-8 `content` to `path`.
 * Returns the number of bytes written.
 * When `overwrite` is omitted or false, an existing file will cause
 * an AlreadyExists error — callers must opt in to clobbering data.
 * When `createParents` is true, missing intermediate directories are
 * created before the write (like `mkdir -p` + write).
 */
export function writeTextFile(
  path: string,
  content: string,
  options?: { overwrite?: boolean; createParents?: boolean },
): Promise<number> {
  return invoke("write_text_file", {
    path,
    content,
    overwrite: options?.overwrite ?? false,
    createParents: options?.createParents ?? false,
  });
}

export function rename(path: string, newName: string): Promise<string> {
  return invoke<string>("rename", { path, newName });
}

export function moveToTrash(path: string): Promise<void> {
  return invoke("move_to_trash", { path });
}

export function deleteForever(path: string): Promise<void> {
  return invoke("delete_forever", { path });
}

export function copyPath(src: string, dst: string): Promise<void> {
  return invoke("copy_path", { src, dst });
}

export function movePath(src: string, dst: string): Promise<void> {
  return invoke("move_path", { src, dst });
}

export function revealInNative(path: string): Promise<void> {
  return invoke("reveal_in_native", { path });
}

/** Open `path` with the OS-default application (double-click behavior). */
export function openWithDefault(path: string): Promise<void> {
  return invoke("open_with_default", { path });
}

// --- Directory size index ------------------------------------------------

export interface SizeInfo {
  bytes: number;
  file_count: number;
  computed_ms: number;
}

export function dirSizeCached(path: string): Promise<SizeInfo | null> {
  return invoke<SizeInfo | null>("dir_size_cached", { path });
}

export function requestDirSize(path: string): Promise<SizeInfo | null> {
  return invoke<SizeInfo | null>("request_dir_size", { path });
}

export function invalidateDirSize(path: string): Promise<void> {
  return invoke("invalidate_dir_size", { path });
}

// --- Text file preview ---------------------------------------------------

export interface TextFilePayload {
  content: string;
  truncated: boolean;
  total_bytes: number;
}

export function readTextFile(path: string, maxBytes?: number): Promise<TextFilePayload> {
  return invoke<TextFilePayload>("read_text_file", {
    path,
    maxBytes: maxBytes ?? null,
  });
}

// --- Collections ---------------------------------------------------------

export interface Collection {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  created_ms: number;
  updated_ms: number;
  items: string[];
}

export function listCollections(): Promise<Collection[]> {
  return invoke<Collection[]>("list_collections");
}

export function createCollection(
  name: string,
  color?: string | null,
  icon?: string | null,
): Promise<Collection> {
  return invoke<Collection>("create_collection", {
    name,
    color: color ?? null,
    icon: icon ?? null,
  });
}

export function updateCollection(
  id: string,
  patch: { name?: string; color?: string | null; icon?: string | null },
): Promise<Collection> {
  return invoke<Collection>("update_collection", {
    id,
    name: patch.name ?? null,
    // `Option<Option<String>>` — outer Some means "set", inner None means "clear".
    color: "color" in patch ? patch.color : null,
    icon: "icon" in patch ? patch.icon : null,
  });
}

export function deleteCollection(id: string): Promise<void> {
  return invoke("delete_collection", { id });
}

export function addToCollection(id: string, paths: string[]): Promise<Collection> {
  return invoke<Collection>("add_to_collection", { id, paths });
}

export function removeFromCollection(id: string, paths: string[]): Promise<Collection> {
  return invoke<Collection>("remove_from_collection", { id, paths });
}

export async function listCollectionEntries(id: string): Promise<FsEntry[]> {
  const raw = await invoke<RawEntry[]>("list_collection_entries", { id });
  return raw.map(normalize);
}

// --- Packs (skins & plugins) ---------------------------------------------

export type PackKind = "skin" | "plugin";

export interface AuthorInfo {
  name?: string | null;
  url?: string | null;
  email?: string | null;
}

export interface EngineRequirement {
  localbro?: string | null;
}

export interface SkinManifest {
  base?: string | null;
  tokens: string;
  overrides?: string | null;
  preview?: string | null;
}

export interface PluginManifest {
  entry: string;
  contributes: Record<string, unknown>;
  permissions: string[];
}

export interface PackManifest {
  manifestVersion: number;
  id: string;
  type: PackKind;
  name: string;
  version: string;
  description?: string | null;
  author?: AuthorInfo | null;
  homepage?: string | null;
  license?: string | null;
  icon?: string | null;
  engine?: EngineRequirement | null;
  skin?: SkinManifest | null;
  plugin?: PluginManifest | null;
}

export interface PackInfo extends PackManifest {
  install_path: string;
}

export function listPacks(kind: PackKind): Promise<PackInfo[]> {
  return invoke<PackInfo[]>("list_packs", { kind });
}

export function readPackText(kind: PackKind, id: string, path: string): Promise<string> {
  return invoke<string>("read_pack_text", { kind, id, path });
}

export function readPackAsset(kind: PackKind, id: string, path: string): Promise<number[]> {
  return invoke<number[]>("read_pack_asset", { kind, id, path });
}

export function installPackFromFolder(src: string): Promise<PackInfo> {
  return invoke<PackInfo>("install_pack_from_folder", { src });
}

export function uninstallPack(kind: PackKind, id: string): Promise<void> {
  return invoke("uninstall_pack", { kind, id });
}

export function packDir(kind: PackKind): Promise<string> {
  return invoke<string>("pack_dir", { kind });
}

// --- Settings ------------------------------------------------------------

export function settingsGet<T = unknown>(key: string): Promise<T | null> {
  return invoke<T | null>("settings_get", { key });
}

export function settingsGetAll(): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("settings_get_all");
}

export function settingsSet(key: string, value: unknown): Promise<void> {
  return invoke("settings_set", { key, value });
}

// --- Archives ------------------------------------------------------------

export interface ArchiveEntry {
  path: string;
  size: number;
  is_dir: boolean;
}

export interface ExtractResult {
  dest: string;
  entries: number;
}

export function listArchive(path: string): Promise<ArchiveEntry[]> {
  return invoke<ArchiveEntry[]>("list_archive", { path });
}

export function extractArchive(archivePath: string, destDir: string): Promise<ExtractResult> {
  return invoke<ExtractResult>("extract_archive", { archivePath, destDir });
}

export function defaultExtractDir(archivePath: string): Promise<string> {
  return invoke<string>("default_extract_dir", { archivePath });
}

export function createZip(sources: string[], destPath: string): Promise<number> {
  return invoke<number>("create_zip", { sources, destPath });
}

const ARCHIVE_SUFFIXES = [".zip", ".tar.gz", ".tgz", ".tar"];

/** True if `path` looks like a supported archive (zip / tar / tar.gz). */
export function isArchivePath(path: string): boolean {
  const lower = path.toLowerCase();
  return ARCHIVE_SUFFIXES.some((s) => lower.endsWith(s));
}

// --- AI guard ------------------------------------------------------------

export function aiSetReadonly(on: boolean): Promise<void> {
  return invoke("ai_set_readonly", { on });
}

export function aiGetReadonly(): Promise<boolean> {
  return invoke<boolean>("ai_get_readonly");
}
