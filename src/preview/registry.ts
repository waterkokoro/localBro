/**
 * Preview adapter registry.
 *
 * An adapter declares which files it can render. The first adapter (by
 * priority descending) whose `match` returns true is used. Task 9's plugin
 * system will register additional adapters at runtime via `registerAdapter`.
 */

import type { ComponentType } from "react";
import type { FsEntry } from "../types";

export interface PreviewProps {
  entry: FsEntry;
}

export interface PreviewAdapter {
  /** Unique id, e.g. "builtin:image". */
  id: string;
  /** Display label shown in the preview header / debug info. */
  label: string;
  /** Higher runs first. Built-ins use 0..100; plugins typically 50. */
  priority: number;
  /** Return true if this adapter can render the entry. */
  match: (entry: FsEntry) => boolean;
  /** React component rendering the preview. */
  component: ComponentType<PreviewProps>;
}

const registry: PreviewAdapter[] = [];

export function registerAdapter(a: PreviewAdapter) {
  // Replace by id if re-registered (e.g. hot-reload or plugin update).
  const existing = registry.findIndex((x) => x.id === a.id);
  if (existing >= 0) registry[existing] = a;
  else registry.push(a);
  registry.sort((x, y) => y.priority - x.priority);
}

export function unregisterAdapter(id: string) {
  const idx = registry.findIndex((x) => x.id === id);
  if (idx >= 0) registry.splice(idx, 1);
}

export function resolveAdapter(entry: FsEntry): PreviewAdapter | null {
  for (const a of registry) {
    try {
      if (a.match(entry)) return a;
    } catch {
      /* ignore buggy adapter */
    }
  }
  return null;
}

export function listAdapters(): PreviewAdapter[] {
  return [...registry];
}
